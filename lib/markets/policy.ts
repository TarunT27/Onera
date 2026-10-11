/**
 * Deterministic order policy. Pure function: same inputs, same decision.
 * Model or agent output never feeds into it — only stored records, simulated
 * quotes and user controls.
 */
import type { Account } from "@/lib/types";
import { shares, usd, valueCents } from "./math";
import type {
  Instrument,
  OrderCreator,
  OrderHoldReason,
  OrderPolicyCheck,
  OrderPolicyResult,
  OrderSide,
  Quote,
  TradingControls,
} from "./types";
import { msg } from "@/lib/i18n/msg";

export interface OrderTerms {
  accountId: string;
  symbol: string;
  side: OrderSide;
  quantityMicros: number | null;
  notionalCents: number | null;
  /** Bound captured for this version (null before the first evaluation). */
  priceBoundCents: number | null;
  createdBy: OrderCreator;
  mandateId: string | null;
}

export interface MandateTerms {
  id: string;
  agentId: string;
  accountId: string;
  symbols: string[];
  side: "buy";
  maxOrderCents: number;
  maxDailyCents: number;
  expiresAt: string;
  revokedAt: string | null;
}

export interface OrderPolicyInput {
  order: OrderTerms;
  account: Account;
  instrument: Instrument | null;
  quote: Quote | null;
  heldQuantityMicros: number;
  /** Global pause from core user_controls. */
  paused: boolean;
  tradingControls: TradingControls;
  /** Gross value of this user's orders executed in the current UTC day. */
  executedTodayCents: number;
  /** The order's mandate loaded for this user, or null (missing, or the order has none). */
  mandate: MandateTerms | null;
  mandateUsedTodayCents: number;
  now: Date;
}

/**
 * Value counted against limits, cash and mandate budgets.
 * Buy by notional: the notional. Buy by quantity: quantity × price bound (worst case).
 * Sell: quantity × current quote.
 */
export function estimatedOrderValueCents(
  order: Pick<OrderTerms, "side" | "quantityMicros" | "notionalCents" | "priceBoundCents">,
  quotePriceCents: number | null,
): number {
  if (order.notionalCents !== null) return order.notionalCents;
  const qty = order.quantityMicros ?? 0;
  if (order.side === "buy") {
    const price = order.priceBoundCents ?? quotePriceCents;
    return price === null ? 0 : valueCents(qty, price, "ceil");
  }
  const price = quotePriceCents ?? order.priceBoundCents;
  return price === null ? 0 : valueCents(qty, price, "floor");
}

export function isTradableAccount(account: Pick<Account, "paper" | "capabilities" | "type">): boolean {
  return account.paper && account.type === "brokerage" && account.capabilities.includes("trade");
}

export function evaluateOrderPolicy(input: OrderPolicyInput): OrderPolicyResult {
  const { order, account, instrument, quote, tradingControls: limits } = input;
  const checks: OrderPolicyCheck[] = [];
  const add = (id: string, label: string, passed: boolean, detail: string, reason: OrderHoldReason) =>
    checks.push({ id, label, passed, detail, ...(passed ? {} : { reason }) });

  const value = estimatedOrderValueCents(order, quote?.priceCents ?? null);
  const sizeText = order.notionalCents !== null ? usd(order.notionalCents) : `${shares(order.quantityMicros ?? 0)} sh`;

  const tradable = isTradableAccount(account);
  add("tradable_account", msg("Paper trading account"), tradable,
    tradable
      ? `${account.name} ••${account.mask} is a paper account (simulated money).`
      : `${account.name} ••${account.mask} is view-only. Orders can only execute in a paper trading account.`,
    "NOT_TRADABLE");

  const allowed = instrument !== null && (instrument.type === "stock" || instrument.type === "etf");
  add("instrument_allowed", msg("Supported stock or ETF"), allowed,
    allowed
      ? `${instrument!.symbol} (${instrument!.type.toUpperCase()}) is supported. No options, margin, leverage or shorting.`
      : `${order.symbol} is not on the supported list of stocks and ETFs.`,
    "INSTRUMENT_NOT_ALLOWED");

  add("quote_available", msg("Simulated quote available"), quote !== null,
    quote ? `${quote.symbol} at ${usd(quote.priceCents)} (simulated, as of ${quote.asOf}).` : `No simulated quote for ${order.symbol}.`,
    "QUOTE_UNAVAILABLE");

  if (quote) {
    const bound = order.priceBoundCents;
    const within = bound !== null && (order.side === "buy" ? quote.priceCents <= bound : quote.priceCents >= bound);
    add("price_within_bound", order.side === "buy" ? msg("Price at or below your maximum") : msg("Price at or above your minimum"),
      within,
      bound === null
        ? msg("No price bound was captured for this version.")
        : `Current ${usd(quote.priceCents)} vs ${order.side === "buy" ? "max" : "min"} ${usd(bound)}.`,
      "PRICE_OUT_OF_BOUND");
  }

  add("per_order_limit", msg("Per-order limit"), value <= limits.perOrderLimitCents,
    `${usd(value)} vs limit ${usd(limits.perOrderLimitCents)}.`, "ORDER_LIMIT_EXCEEDED");

  const dailyAfter = input.executedTodayCents + value;
  add("daily_order_limit", msg("Daily order limit"), dailyAfter <= limits.dailyOrderLimitCents,
    `${usd(input.executedTodayCents)} traded today + ${usd(value)} = ${usd(dailyAfter)} vs limit ${usd(limits.dailyOrderLimitCents)}.`,
    "DAILY_ORDER_LIMIT_EXCEEDED");

  if (order.side === "buy") {
    add("available_cash", msg("Paper cash available"), value <= account.availableCents,
      `${sizeText} needs up to ${usd(value)}; ${usd(account.availableCents)} available in ${account.name}.`,
      "INSUFFICIENT_CASH");
  } else {
    const qty = order.quantityMicros ?? 0;
    add("shares_held", msg("Shares held (no shorting)"), qty <= input.heldQuantityMicros,
      `Selling ${shares(qty)} ${order.symbol}; ${shares(input.heldQuantityMicros)} held in ${account.name}.`,
      "INSUFFICIENT_SHARES");
  }

  add("not_paused", msg("Execution not paused"), !input.paused,
    input.paused ? msg("You paused execution in Control. Orders and mandate trades are blocked.") : msg("Execution is enabled."),
    "PAUSED");

  if (order.mandateId !== null) {
    const problems = mandateProblems(order, input.mandate, value, input.mandateUsedTodayCents, input.now);
    add("mandate_valid", msg("Agent mandate covers this order"), problems.length === 0,
      problems.length === 0
        ? `Mandate ${order.mandateId} covers ${order.side} ${order.symbol} up to ${usd(input.mandate!.maxOrderCents)} per order.`
        : problems.join(" "),
      "MANDATE_INVALID");
  }

  const reasons = [...new Set(checks.filter((c) => !c.passed).map((c) => c.reason!))];
  return {
    decision: reasons.length === 0 ? "ALLOW" : "HOLD",
    reasons,
    checks,
    quotePriceCents: quote?.priceCents ?? null,
    estimatedValueCents: value,
    evaluatedAt: input.now.toISOString(),
  };
}

function mandateProblems(
  order: OrderTerms,
  mandate: MandateTerms | null,
  value: number,
  usedTodayCents: number,
  now: Date,
): string[] {
  if (!mandate) return [msg("Mandate not found.")];
  const problems: string[] = [];
  if (mandate.revokedAt !== null) problems.push(`Mandate was revoked at ${mandate.revokedAt}.`);
  if (new Date(mandate.expiresAt).getTime() <= now.getTime()) problems.push(`Mandate expired at ${mandate.expiresAt}.`);
  if (order.createdBy !== `agent:${mandate.agentId}`) {
    problems.push(`Mandate belongs to agent ${mandate.agentId}; this order was proposed by ${order.createdBy}.`);
  }
  if (order.accountId !== mandate.accountId) problems.push(msg("Mandate covers a different account."));
  if (order.side !== mandate.side) problems.push(`Mandate allows ${mandate.side} orders only.`);
  if (!mandate.symbols.includes(order.symbol)) {
    problems.push(`Mandate covers ${mandate.symbols.join(", ")}, not ${order.symbol}.`);
  }
  if (value > mandate.maxOrderCents) {
    problems.push(`${usd(value)} exceeds the mandate's ${usd(mandate.maxOrderCents)} per-order cap.`);
  }
  if (usedTodayCents + value > mandate.maxDailyCents) {
    problems.push(`${usd(usedTodayCents)} used today + ${usd(value)} exceeds the mandate's ${usd(mandate.maxDailyCents)} daily budget.`);
  }
  return problems;
}
