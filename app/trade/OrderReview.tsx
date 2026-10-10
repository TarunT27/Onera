"use client";

import { useState } from "react";
import { CheckCircle, LockSimple, X, XCircle } from "@phosphor-icons/react";
import type { ExecuteOrderResult, PaperOrder } from "@/lib/markets";
import { api } from "../components/api";
import { Badge } from "../components/Badge";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents } from "../components/format";
import { HoldButton } from "./HoldButton";
import { formatShares } from "./shares";

const STATE_LABEL: Record<PaperOrder["state"], { label: string; tone: "gray" | "red" | "blue" | "indigo" | "green" }> = {
  PROPOSED: { label: "Proposed", tone: "gray" },
  HELD: { label: "Held", tone: "red" },
  AWAITING_APPROVAL: { label: "Awaiting your approval", tone: "blue" },
  APPROVED: { label: "Approved", tone: "indigo" },
  EXECUTED: { label: "Executed", tone: "green" },
  FAILED: { label: "Failed", tone: "red" },
};

export function orderTitle(o: PaperOrder): string {
  const verb = o.side === "buy" ? "Buy" : "Sell";
  if (o.notionalCents !== null) return `${verb} ${formatCents(o.notionalCents)} of ${o.symbol}`;
  return `${verb} ${formatShares(o.quantityMicros ?? 0)} sh ${o.symbol}`;
}

export function creatorLabel(o: PaperOrder): string {
  return o.createdBy === "assistant" ? "Trade drafter" : o.createdBy === "user" ? "You" : "Agent (mandate)";
}

export function OrderStateBadge({ state }: { state: PaperOrder["state"] }) {
  const s = STATE_LABEL[state];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Review one paper order: policy checks, hold-to-approve the exact version, then execute. */
export function OrderReview({
  order,
  onChange,
  onClose,
}: {
  order: PaperOrder;
  onChange: (order: PaperOrder) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "execute" | "evaluate" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState(false);

  async function run(kind: "approve" | "execute" | "evaluate") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "execute") {
        const res = await api.post<ExecuteOrderResult>(`/api/orders/${encodeURIComponent(order.id)}/execute`);
        setDuplicate(res.duplicate);
        onChange(res.order);
      } else {
        const res = await api.post<{ order: PaperOrder }>(
          `/api/orders/${encodeURIComponent(order.id)}/${kind}`,
          kind === "approve" ? { version: order.version } : undefined,
        );
        onChange(res.order);
      }
    } catch (err) {
      setError(err);
      // The server may have re-evaluated (and held) the order; show its current state.
      try {
        const res = await api.get<{ order: PaperOrder }>(`/api/orders/${encodeURIComponent(order.id)}`);
        onChange(res.order);
      } catch {
        /* keep the error shown above */
      }
    } finally {
      setBusy(null);
    }
  }

  const bound = order.priceBoundCents;
  const fill = order.fill;
  return (
    <section className="tile glass review" aria-label="Order review">
      <header className="review-head">
        <Badge tone="violet">{creatorLabel(order)}</Badge>
        <OrderStateBadge state={order.state} />
        <span className="review-version">v{order.version}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Close order review">
          <X size={16} aria-hidden />
        </button>
      </header>

      <h2 className="review-title">{orderTitle(order)}</h2>
      <p className="row-meta">
        {bound !== null
          ? order.side === "buy"
            ? `Fills only at or below ${formatCents(bound)} per share`
            : `Fills only at or above ${formatCents(bound)} per share`
          : "No price lock yet"}
        {order.quotePriceCents !== null ? ` · quoted ${formatCents(order.quotePriceCents)}` : ""}
      </p>

      {order.policy && (
        <ul className="review-checks" aria-label="Policy checks">
          {order.policy.checks.map((c) => (
            <li key={c.id} className={c.passed ? undefined : "failed"}>
              {c.passed ? (
                <CheckCircle size={18} weight="fill" aria-label="Passed" />
              ) : (
                <XCircle size={18} weight="fill" aria-label="Failed" />
              )}
              <span>
                <strong>{c.label}</strong>
                <small>{c.detail}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {order.state !== "EXECUTED" && order.state !== "FAILED" && (
        <p className="review-lock">
          <LockSimple size={16} aria-hidden />
          Approval binds to version {order.version}. Any edit clears it, and execution re-checks every rule first.
        </p>
      )}

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      {order.state === "AWAITING_APPROVAL" && (
        <HoldButton
          label={`Hold to approve version ${order.version}`}
          busyLabel="Approving…"
          busy={busy === "approve"}
          onConfirm={() => void run("approve")}
        />
      )}
      {order.state === "APPROVED" && (
        <button type="button" className="pill review-execute" disabled={busy !== null} onClick={() => void run("execute")}>
          {busy === "execute" ? "Executing…" : "Execute paper order"}
        </button>
      )}
      {order.state === "HELD" && (
        <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("evaluate")}>
          {busy === "evaluate" ? "Re-checking…" : "Re-check at current price"}
        </button>
      )}
      {fill && (
        <div className="review-fill" role="status">
          <strong>Executed · simulated fill{duplicate ? " (already executed)" : ""}</strong>
          <span>
            {fill.side === "buy" ? "Bought" : "Sold"} {formatShares(fill.quantityMicros)} sh {fill.symbol} at{" "}
            {formatCents(fill.priceCents)} for {formatCents(fill.grossCents)}. Paper money only, not counted in net worth.
          </span>
        </div>
      )}
      {order.state === "FAILED" && order.failureReason && <p className="ticket-error">{order.failureReason}</p>}
    </section>
  );
}
