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
import { useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import { identityT, type Translate } from "@/lib/i18n/translate";

const STATE_LABEL: Record<PaperOrder["state"], { label: string; tone: "gray" | "red" | "blue" | "indigo" | "green" }> = {
  PROPOSED: { label: msg("Proposed"), tone: "gray" },
  HELD: { label: msg("Held"), tone: "red" },
  AWAITING_APPROVAL: { label: msg("Awaiting your approval"), tone: "blue" },
  APPROVED: { label: msg("Approved"), tone: "indigo" },
  SUBMITTING: { label: msg("Sending to Alpaca"), tone: "indigo" },
  SUBMITTED: { label: msg("Open at Alpaca"), tone: "blue" },
  EXECUTED: { label: msg("Executed"), tone: "green" },
  CANCELED: { label: msg("Canceled"), tone: "gray" },
  FAILED: { label: msg("Failed"), tone: "red" },
};

const OPEN_AT_BROKER: PaperOrder["state"][] = ["SUBMITTING", "SUBMITTED"];
const FINAL: PaperOrder["state"][] = ["EXECUTED", "CANCELED", "FAILED"];

function placeLabel(o: PaperOrder, t: Translate = identityT): string {
  if (o.venue === "alpaca_live") return t("Submit LIVE order (real money)");
  if (o.venue === "alpaca_paper") return t("Submit to Alpaca paper");
  return t("Execute paper order");
}

/** Alpaca's raw status in words. */
function brokerStatusText(status: string | null, t: Translate = identityT): string {
  switch (status) {
    case null: return t("Waiting for Alpaca to confirm");
    case "new":
    case "accepted":
    case "pending_new": return t("Working at Alpaca");
    case "partially_filled": return t("Partially filled, still working");
    case "pending_cancel": return t("Cancel requested");
    case "done_for_day": return t("Done for the day");
    default: return t("Alpaca status: {status}", { status: status.replace(/_/g, " ") });
  }
}

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

function limitSentence(o: PaperOrder, quantityMicros: number | null, bound: number | null, t: Translate): string {
  const price = bound !== null ? formatCents(bound) : "—";
  const buy = o.side === "buy";
  if (quantityMicros !== null) {
    const vars = { shares: formatShares(quantityMicros), symbol: o.symbol, price };
    return buy ? t("Limit buy {shares} sh {symbol} at {price}, day order.", vars) : t("Limit sell {shares} sh {symbol} at {price}, day order.", vars);
  }
  const vars = { symbol: o.symbol, price };
  return buy ? t("Limit buy {symbol} at {price}, day order.", vars) : t("Limit sell {symbol} at {price}, day order.", vars);
}

function fillSentence(fill: NonNullable<PaperOrder["fill"]>, t: Translate): string {
  const vars = { shares: formatShares(fill.quantityMicros), symbol: fill.symbol, price: formatCents(fill.priceCents), gross: formatCents(fill.grossCents) };
  const buy = fill.side === "buy";
  if (fill.simulated) {
    return buy ? t("Bought {shares} sh {symbol} at {price} for {gross}.", vars) : t("Sold {shares} sh {symbol} at {price} for {gross}.", vars);
  }
  return buy
    ? t("Bought {shares} sh {symbol} at an average of {price} for {gross}.", vars)
    : t("Sold {shares} sh {symbol} at an average of {price} for {gross}.", vars);
}

export function OrderStateBadge({ state }: { state: PaperOrder["state"] }) {
  const t = useT();
  const s = STATE_LABEL[state];
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
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
  const t = useT();
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
    const timer = setInterval(() => {
      api.get<{ order: PaperOrder }>(`/api/orders/${encodeURIComponent(order.id)}`)
        .then((res) => onChangeRef.current(res.order))
        .catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
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
    <section className="tile glass review" aria-label={t("Order review")}>
      <header className="review-head">
        <Badge tone="violet">{creatorLabel(order, t)}</Badge>
        {order.venue === "alpaca_paper" && <Badge tone="brand" title={t("Alpaca paper trading: real prices, paper money")}>{t("Alpaca paper")}</Badge>}
        {order.venue === "alpaca_live" && <Badge tone="red" title={t("Alpaca live account: real money")}>{t("LIVE · real money")}</Badge>}
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

      {!FINAL.includes(order.state) && !open && (
        <p className="review-lock">
          <LockSimple size={16} aria-hidden />
          {t("Approval binds to version {version}. Any edit clears it, and execution re-checks every rule first.", { version: order.version })}
          {order.venue !== "onera_paper" && bound !== null
            ? ` ${t("Alpaca receives a limit order at {price}, so it can't fill at a worse price.", { price: formatCents(bound) })}`
            : ""}
        </p>
      )}

      {open && broker && (
        <div className="review-fill" role="status">
          <strong>{order.state === "SUBMITTING" ? t("Sending to Alpaca…") : brokerStatusText(broker.status, t)}</strong>
          <span>
            {limitSentence(order, broker.quantityMicros, bound, t)}
            {broker.filledQuantityMicros > 0 ? ` ${t("{shares} sh filled so far.", { shares: formatShares(broker.filledQuantityMicros) })}` : ""}
            {!marketOpen ? ` ${t("The market is closed, so it is queued until the next open.")}` : ""}
            {broker.cancelRequestedAt ? ` ${t("Cancel requested; waiting for Alpaca to confirm.")}` : ""}
          </span>
        </div>
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
            {busy === "execute" ? (order.venue === "onera_paper" ? t("Executing…") : t("Submitting…")) : placeLabel(order, t)}
          </button>
        )}
        {order.state === "SUBMITTED" && !broker?.cancelRequestedAt && (
          <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("cancel")}>
            {busy === "cancel" ? t("Canceling…") : t("Cancel order")}
          </button>
        )}
        {order.state === "HELD" && (
          <button type="button" className="pill secondary review-execute" disabled={busy !== null} onClick={() => void run("evaluate")}>
            {busy === "evaluate" ? t("Re-checking…") : t("Re-check at current price")}
          </button>
        )}
        {fill && (
          <div className="review-fill" role="status">
            <strong>
              {fill.simulated ? t("Executed · simulated fill") : fill.partial ? t("Filled at Alpaca · partial") : t("Filled at Alpaca")}
              {duplicate ? ` ${t("(already executed)")}` : ""}
            </strong>
            <span>
              {fillSentence(fill, t)}{" "}
              {fill.paper ? t("Paper money only, not counted in net worth.") : t("Real money.")}
            </span>
          </div>
        )}
        {order.state === "CANCELED" && (
          <p className="row-meta">
            {order.failureReason ? t(order.failureReason) : t("Canceled at Alpaca before anything filled. Nothing was traded.")}
          </p>
        )}
      </div>
      {order.state === "FAILED" && order.failureReason && <p className="ticket-error">{t(order.failureReason)}</p>}
    </section>
  );
}
