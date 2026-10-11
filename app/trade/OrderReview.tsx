"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, LockSimple, X, XCircle } from "@phosphor-icons/react";
import type { PaperOrder, PlaceOrderResult } from "@/lib/markets";
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
  SUBMITTING: { label: "Sending to Alpaca", tone: "indigo" },
  SUBMITTED: { label: "Open at Alpaca", tone: "blue" },
  EXECUTED: { label: "Executed", tone: "green" },
  CANCELED: { label: "Canceled", tone: "gray" },
  FAILED: { label: "Failed", tone: "red" },
};

const OPEN_AT_BROKER: PaperOrder["state"][] = ["SUBMITTING", "SUBMITTED"];
const FINAL: PaperOrder["state"][] = ["EXECUTED", "CANCELED", "FAILED"];

function placeLabel(o: PaperOrder): string {
  if (o.venue === "alpaca_live") return "Submit LIVE order (real money)";
  if (o.venue === "alpaca_paper") return "Submit to Alpaca paper";
  return "Execute paper order";
}

/** Alpaca's raw status in words. */
function brokerStatusText(status: string | null): string {
  switch (status) {
    case null: return "Waiting for Alpaca to confirm";
    case "new":
    case "accepted":
    case "pending_new": return "Working at Alpaca";
    case "partially_filled": return "Partially filled, still working";
    case "pending_cancel": return "Cancel requested";
    case "done_for_day": return "Done for the day";
    default: return `Alpaca status: ${status.replace(/_/g, " ")}`;
  }
}

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

/**
 * Review one order: policy checks, hold-to-approve the exact version, then execute (Onera
 * paper) or submit to Alpaca. Open Alpaca orders refresh every few seconds and can be canceled.
 */
export function OrderReview({
  order,
  marketOpen = true,
  onChange,
  onClose,
}: {
  order: PaperOrder;
  /** False when the US market is closed (Alpaca clock): open day orders wait for the next session. */
  marketOpen?: boolean;
  onChange: (order: PaperOrder) => void;
  onClose: () => void;
}) {
  const [busy, setBusy] = useState<"approve" | "execute" | "evaluate" | "cancel" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState(false);

  // Poll open Alpaca orders until they settle. The server syncs with Alpaca on each read.
  const open = OPEN_AT_BROKER.includes(order.state);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    if (!open) return;
    const t = setInterval(() => {
      api.get<{ order: PaperOrder }>(`/api/orders/${encodeURIComponent(order.id)}`)
        .then((res) => onChangeRef.current(res.order))
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(t);
  }, [open, order.id]);

  async function run(kind: "approve" | "execute" | "evaluate" | "cancel") {
    setBusy(kind);
    setError(null);
    try {
      if (kind === "execute") {
        const res = await api.post<PlaceOrderResult>(`/api/orders/${encodeURIComponent(order.id)}/execute`);
        setDuplicate(res.duplicate);
        onChange(res.order);
      } else if (kind === "cancel") {
        const res = await api.post<{ order: PaperOrder }>(`/api/orders/${encodeURIComponent(order.id)}/cancel`);
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
  const broker = order.broker;
  return (
    <section className="tile glass review" aria-label="Order review">
      <header className="review-head">
        <Badge tone="violet">{creatorLabel(order)}</Badge>
        {order.venue === "alpaca_paper" && <Badge tone="brand" title="Alpaca paper trading: real prices, paper money">Alpaca paper</Badge>}
        {order.venue === "alpaca_live" && <Badge tone="red" title="Alpaca live account: real money">LIVE · real money</Badge>}
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

      {!FINAL.includes(order.state) && !open && (
        <p className="review-lock">
          <LockSimple size={16} aria-hidden />
          Approval binds to version {order.version}. Any edit clears it, and execution re-checks every rule first.
          {order.venue !== "onera_paper" && bound !== null
            ? ` Alpaca receives a limit order at ${formatCents(bound)}, so it can't fill at a worse price.`
            : ""}
        </p>
      )}

      {open && broker && (
        <div className="review-fill" role="status">
          <strong>{order.state === "SUBMITTING" ? "Sending to Alpaca…" : brokerStatusText(broker.status)}</strong>
          <span>
            Limit {order.side} {broker.quantityMicros !== null ? `${formatShares(broker.quantityMicros)} sh ` : ""}
            {order.symbol} at {bound !== null ? formatCents(bound) : "—"}, day order.
            {broker.filledQuantityMicros > 0 ? ` ${formatShares(broker.filledQuantityMicros)} sh filled so far.` : ""}
            {!marketOpen ? " The market is closed, so it is queued until the next open." : ""}
            {broker.cancelRequestedAt ? " Cancel requested; waiting for Alpaca to confirm." : ""}
          </span>
        </div>
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
          {busy === "execute" ? (order.venue === "onera_paper" ? "Executing…" : "Submitting…") : placeLabel(order)}
        </button>
      )}
      {order.state === "SUBMITTED" && !broker?.cancelRequestedAt && (
        <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("cancel")}>
          {busy === "cancel" ? "Canceling…" : "Cancel order"}
        </button>
      )}
      {order.state === "HELD" && (
        <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("evaluate")}>
          {busy === "evaluate" ? "Re-checking…" : "Re-check at current price"}
        </button>
      )}
      {fill && (
        <div className="review-fill" role="status">
          <strong>
            {fill.simulated ? "Executed · simulated fill" : `Filled at Alpaca${fill.partial ? " · partial" : ""}`}
            {duplicate ? " (already executed)" : ""}
          </strong>
          <span>
            {fill.side === "buy" ? "Bought" : "Sold"} {formatShares(fill.quantityMicros)} sh {fill.symbol} at{" "}
            {fill.simulated ? "" : "an average of "}
            {formatCents(fill.priceCents)} for {formatCents(fill.grossCents)}.{" "}
            {fill.paper ? "Paper money only, not counted in net worth." : "Real money."}
          </span>
        </div>
      )}
      {order.state === "CANCELED" && (
        <p className="row-meta">{order.failureReason ?? "Canceled at Alpaca before anything filled. Nothing was traded."}</p>
      )}
      {order.state === "FAILED" && order.failureReason && <p className="ticket-error">{order.failureReason}</p>}
    </section>
  );
}
