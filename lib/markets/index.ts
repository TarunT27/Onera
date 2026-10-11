/**
 * Public surface of the markets module (quotes, portfolio, paper trading,
 * Alpaca brokerage, mandates). Other modules import only from "@/lib/markets".
 *
 * Prices are simulated ("Simulated prices — not real market data") unless
 * Alpaca keys are configured, in which case they are real Alpaca market data
 * (refreshMarketData() fills the cache the synchronous readers use). Orders
 * execute in Onera paper accounts or a connected Alpaca account, always
 * through propose → deterministic policy → exact-version user approval (or,
 * Onera paper only, a valid mandate) → atomic single execution / submission
 * → fill + audit.
 *
 * Must not import lib/finance/accounts or lib/actions: lib/finance/accounts
 * imports getPortfolio from here.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { instrumentFor, refreshAssets, searchInstruments } from "./assets";
import { catalogInstruments, findInstrument } from "./instruments";
import { listWatchlist } from "./watchlist";
import { historyFor, marketStatusFor, quoteFor } from "./marketdata";
import { computePortfolio } from "./portfolio";
import type { Instrument, InstrumentSearchResult, MarketStatus, Portfolio, PriceHistory, Quote } from "./types";

export type * from "./types";
export {
  ALPACA_PRICES_DISCLAIMER,
  ORDER_HOLD_REASONS,
  SIMULATED_MARKET_STATUS,
  SIMULATED_PRICES_DISCLAIMER,
} from "./types";

// --- Frozen contract ----------------------------------------------------------

export function listInstruments(): Instrument[] {
  return catalogInstruments();
}

/**
 * Current quote. Pass `db` everywhere outside tests: in Alpaca mode quotes come from the
 * market-data cache in the database (null without it, or when the cache is stale).
 */
export function getQuote(symbol: string, now: Date = new Date(), db?: DB): Quote | null {
  return quoteFor(db, symbol, now);
}

export function getPortfolio(db: DB, userId: UserId, now: Date = new Date()): Portfolio {
  return computePortfolio(db, userId, now);
}

// --- Market data ------------------------------------------------------------------

export { findInstrument } from "./instruments";
export { addToWatchlist, listWatchlist, MAX_WATCHLIST, removeFromWatchlist, watchlistInstruments } from "./watchlist";

/** Catalog symbol, or (Alpaca mode) any tradable US stock/ETF Alpaca lists. */
export function getInstrument(symbol: string, db?: DB): Instrument | null {
  return instrumentFor(db, symbol);
}

/**
 * Searches stocks and ETFs by ticker or name. Simulated mode searches the built-in catalog;
 * Alpaca mode searches every tradable US equity (the asset list is fetched about once a day).
 */
export async function searchMarket(db: DB, userId: UserId, query: string): Promise<InstrumentSearchResult[]> {
  await refreshAssets(db).catch((err: unknown) =>
    console.warn("[clearfi] Alpaca assets:", err instanceof Error ? err.message : err));
  const watched = new Set(listWatchlist(db, userId));
  return searchInstruments(db, query).map((i) => ({
    ...i,
    builtIn: findInstrument(i.symbol) !== null,
    inWatchlist: watched.has(i.symbol),
  }));
}
export { MAX_HISTORY_DAYS } from "./simulator";
export { pricesDisclaimer, quoteSource } from "./marketdata";

/**
 * Quotes for the given symbols (all instruments when omitted). Symbols without a quote
 * (unknown, or no fresh Alpaca data) are listed separately.
 */
export function getQuotes(
  symbols?: string[],
  now: Date = new Date(),
  db?: DB,
): { quotes: Quote[]; unknown: string[] } {
  const wanted = symbols && symbols.length > 0 ? symbols : catalogInstruments().map((i) => i.symbol);
  const quotes: Quote[] = [];
  const unknown: string[] = [];
  for (const s of [...new Set(wanted.map((x) => x.trim().toUpperCase()).filter(Boolean))]) {
    const q = quoteFor(db, s, now);
    if (q) quotes.push(q);
    else unknown.push(s);
  }
  return { quotes, unknown };
}

/** Daily closes for the last `days` days plus the current price, or null for unknown symbols. */
export function getPriceHistory(symbol: string, days = 30, now: Date = new Date(), db?: DB): PriceHistory | null {
  return historyFor(db, symbol, days, now);
}

/** Simulated (always open) or the real US market clock from Alpaca. */
export function getMarketStatus(db?: DB, now: Date = new Date()): MarketStatus {
  return marketStatusFor(db, now);
}

// --- Paper trading -----------------------------------------------------------------

export { approveOrder, createOrder, editOrder, evaluateOrder, getOrder, listOrders } from "./orders";
// executeOrder runs as the signed-in user only. The mandate execution path
// (broker.executeMandateOrder) and createOrderInternal are deliberately NOT
// exported: proposeMandateOrder is the only way an agent's order executes.
// Write functions take no `now`: they read the real clock.
export { executeOrder } from "./broker";

// --- Alpaca brokerage ------------------------------------------------------------
// placeOrder / cancelOrder / connectAlpaca run as the signed-in user only (user routes).
// refreshMarketData / syncOrders only read from Alpaca and apply what it reports.

export { alpacaStatus } from "./alpaca";
export {
  cancelOrder,
  connectAlpaca,
  getBrokerConnection,
  placeOrder,
  refreshMarketData,
  startBrokerOrderSync,
  syncOrders,
} from "./brokerage";
export type { MarketRefreshReport } from "./brokerage";
export { evaluateOrderPolicy, estimatedOrderValueCents, isTradableAccount } from "./policy";
export type { BrokerTerms, MandateTerms, OrderPolicyInput, OrderTerms } from "./policy";
export { orderApprovalHash } from "./approval";
export { priceBoundFor } from "./math";
export { getTradingControls, updateTradingControls } from "./controls";
export { ordersExecutedTodayCents } from "./store";

// --- Mandates (autonomous paper trading, user-granted) --------------------------

export { createMandate, getMandate, listMandates, proposeMandateOrder, revokeMandate } from "./mandates";
