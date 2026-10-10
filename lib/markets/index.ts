/**
 * Public surface of the markets module (simulated quotes, portfolio, paper
 * trading, mandates). Other modules import only from "@/lib/markets".
 *
 * All prices are simulated ("Simulated prices — not real market data"). Orders
 * only execute in paper accounts, through propose → deterministic policy →
 * exact-version user approval (or a valid mandate) → atomic single execution
 * → fill + audit.
 *
 * Must not import lib/finance/accounts or lib/actions: lib/finance/accounts
 * imports getPortfolio from here.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { catalogInstruments } from "./instruments";
import { computePortfolio } from "./portfolio";
import { simulateHistory, simulateQuote } from "./simulator";
import type { Instrument, Portfolio, PriceHistory, Quote } from "./types";

export type * from "./types";
export { ORDER_HOLD_REASONS, SIMULATED_MARKET_STATUS, SIMULATED_PRICES_DISCLAIMER } from "./types";

// --- Frozen contract ----------------------------------------------------------

export function listInstruments(): Instrument[] {
  return catalogInstruments();
}

export function getQuote(symbol: string, now: Date = new Date()): Quote | null {
  return simulateQuote(symbol, now);
}

export function getPortfolio(db: DB, userId: UserId, now: Date = new Date()): Portfolio {
  return computePortfolio(db, userId, now);
}

// --- Market data ------------------------------------------------------------------

export { findInstrument } from "./instruments";
export { MAX_HISTORY_DAYS } from "./simulator";

/** Simulated quotes for the given symbols (all instruments when omitted). Unknown symbols are listed separately. */
export function getQuotes(symbols?: string[], now: Date = new Date()): { quotes: Quote[]; unknown: string[] } {
  const wanted = symbols && symbols.length > 0 ? symbols : catalogInstruments().map((i) => i.symbol);
  const quotes: Quote[] = [];
  const unknown: string[] = [];
  for (const s of [...new Set(wanted.map((x) => x.trim().toUpperCase()).filter(Boolean))]) {
    const q = simulateQuote(s, now);
    if (q) quotes.push(q);
    else unknown.push(s);
  }
  return { quotes, unknown };
}

/** Daily simulated closes for the last `days` days plus the current price, or null for unknown symbols. */
export function getPriceHistory(symbol: string, days = 30, now: Date = new Date()): PriceHistory | null {
  return simulateHistory(symbol, days, now);
}

// --- Paper trading -----------------------------------------------------------------

export { approveOrder, createOrder, editOrder, evaluateOrder, getOrder, listOrders } from "./orders";
export { executeOrder, type ExecuteOrderOptions } from "./broker";
export { evaluateOrderPolicy, estimatedOrderValueCents, isTradableAccount } from "./policy";
export type { MandateTerms, OrderPolicyInput, OrderTerms } from "./policy";
export { orderApprovalHash } from "./approval";
export { priceBoundFor } from "./math";
export { getTradingControls, updateTradingControls } from "./controls";
export { ordersExecutedTodayCents } from "./store";

// --- Mandates (autonomous paper trading, user-granted) --------------------------

export { createMandate, getMandate, listMandates, proposeMandateOrder, revokeMandate } from "./mandates";
