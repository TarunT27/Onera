"use client";

import { useState } from "react";
import { CheckCircle, LockSimple, X, XCircle } from "@phosphor-icons/react";
import type { ExecuteOrderResult, PaperOrder } from "@/lib/markets";
import { api } from "../components/api";
import { Badge } from "../components/Badge";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents } from "../components/format";
import { useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import { identityT, type Translate } from "@/lib/i18n/translate";
import { HoldButton } from "./HoldButton";
import { formatShares } from "./shares";

const STATE_LABEL: Record<PaperOrder["state"], { label: string; tone: "gray" | "red" | "blue" | "indigo" | "green" }> = {
  PROPOSED: { label: msg("Proposed"), tone: "gray" },
  HELD: { label: msg("Held"), tone: "red" },
  AWAITING_APPROVAL: { label: msg("Awaiting your approval"), tone: "blue" },
  APPROVED: { label: msg("Approved"), tone: "indigo" },
  EXECUTED: { label: msg("Executed"), tone: "green" },
  FAILED: { label: msg("Failed"), tone: "red" },
};

export function orderTitle(o: PaperOrder, t: Translate = identityT): string {
  const buy = o.side === "buy";
  if (o.notionalCents !== null) {
    const vars = { amount: formatCents(o.notionalCents), symbol: o.symbol };
    return buy ? t("Buy {amount} of {symbol}", vars) : t("Sell {amount} of {symbol}", vars);
  }
  const vars = { shares: formatShares(o.quantityMicros ?? 0), symbol: o.symbol };
  return buy ? t("Buy {shares} sh {symbol}", vars) : t("Sell {shares} sh {symbol}", vars);
}

export function creatorLabel(o: PaperOrder, t: Translate = identityT): string {
  return o.createdBy === "assistant" ? t("Trade drafter") : o.createdBy === "user" ? t("You") : t("Agent (mandate)");
}

export function OrderStateBadge({ state }: { state: PaperOrder["state"] }) {
  const t = useT();
  const s = STATE_LABEL[state];
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
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
  const t = useT();
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
    <section className="tile glass review" aria-label={t("Order review")}>
      <header className="review-head">
        <Badge tone="violet">{creatorLabel(order, t)}</Badge>
        <OrderStateBadge state={order.state} />
        <span className="review-version">v{order.version}</span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label={t("Close order review")}>
          <X size={16} aria-hidden />
        </button>
      </header>

      <h2 className="review-title">{orderTitle(order, t)}</h2>
      <p className="row-meta">
        {bound !== null
          ? order.side === "buy"
            ? t("Fills only at or below {price} per share", { price: formatCents(bound) })
            : t("Fills only at or above {price} per share", { price: formatCents(bound) })
          : t("No price lock yet")}
        {order.quotePriceCents !== null ? ` · ${t("quoted {price}", { price: formatCents(order.quotePriceCents) })}` : ""}
      </p>

      {order.policy && (
        <ul className="review-checks" aria-label={t("Policy checks")}>
          {order.policy.checks.map((c) => (
            <li key={c.id} className={c.passed ? undefined : "failed"}>
              {c.passed ? (
                <CheckCircle size={18} weight="fill" aria-label={t("Passed")} />
              ) : (
                <XCircle size={18} weight="fill" aria-label={t("Failed")} />
              )}
              <span>
                <strong>{t(c.label)}</strong>
                <small>{t(c.detail)}</small>
              </span>
            </li>
          ))}
        </ul>
      )}

      {order.state !== "EXECUTED" && order.state !== "FAILED" && (
        <p className="review-lock">
          <LockSimple size={16} aria-hidden />
          {t("Approval binds to version {version}. Any edit clears it, and execution re-checks every rule first.", { version: order.version })}
        </p>
      )}

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      {/* Actions stay pinned to the bottom of the pane, so approval never needs a page scroll. */}
      <div className="review-actions">
        {order.state === "AWAITING_APPROVAL" && (
          <HoldButton
            label={t("Hold to approve version {version}", { version: order.version })}
            busyLabel={t("Approving…")}
            busy={busy === "approve"}
            onConfirm={() => void run("approve")}
          />
        )}
        {order.state === "APPROVED" && (
          <button type="button" className="pill review-execute" disabled={busy !== null} onClick={() => void run("execute")}>
            {busy === "execute" ? t("Executing…") : t("Execute paper order")}
          </button>
        )}
        {order.state === "HELD" && (
          <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("evaluate")}>
            {busy === "evaluate" ? t("Re-checking…") : t("Re-check at current price")}
          </button>
        )}
        {fill && (
          <div className="review-fill" role="status">
            <strong>{t("Executed · simulated fill")}{duplicate ? ` ${t("(already executed)")}` : ""}</strong>
            <span>
              {fill.side === "buy"
                ? t("Bought {shares} sh {symbol} at {price} for {gross}.", { shares: formatShares(fill.quantityMicros), symbol: fill.symbol, price: formatCents(fill.priceCents), gross: formatCents(fill.grossCents) })
                : t("Sold {shares} sh {symbol} at {price} for {gross}.", { shares: formatShares(fill.quantityMicros), symbol: fill.symbol, price: formatCents(fill.priceCents), gross: formatCents(fill.grossCents) })}{" "}
              {t("Paper money only, not counted in net worth.")}
            </span>
          </div>
        )}
      </div>
      {order.state === "FAILED" && order.failureReason && <p className="ticket-error">{t(order.failureReason)}</p>}
    </section>
  );
}
