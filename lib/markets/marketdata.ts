/**
 * Market data source for the whole process, fixed by configuration:
 *  - Alpaca keys configured → real prices from Alpaca (IEX feed by default),
 *    cached in markets-owned tables so the web server, the worker and every
 *    route bundle share one view;
 *  - otherwise → the deterministic simulator (labeled "simulated").
 *
 * The markets services are synchronous (better-sqlite3 transactions), so the
 * async refreshers run first (routes, chat turns, the background poller) and the
 * sync readers below only read the cache. In Alpaca mode a missing or stale
 * quote is null — never a simulated price — so policy holds the order with
 * QUOTE_UNAVAILABLE instead of turning a made-up price into a real limit price.
 */
import type { DB } from "@/lib/db";
import { alpacaConfigured, getClock, getDailyBars, getSnapshots, type AlpacaClock } from "./alpaca";
import { instrumentFor } from "./assets";
import { catalogInstruments, findInstrument, normalizeSymbol } from "./instruments";
import { decimalToCents } from "./math";
import { MAX_HISTORY_DAYS, simulateHistory, simulateQuote } from "./simulator";
import {
  ALPACA_PRICES_DISCLAIMER,
  SIMULATED_MARKET_STATUS,
  SIMULATED_PRICES_DISCLAIMER,
  type MarketStatus,
  type PriceHistory,
  type PricePoint,
  type Quote,
  type QuoteSource,
} from "./types";
import { msg } from "@/lib/i18n/msg";

/** Quotes older than this are treated as unavailable. */
export const QUOTE_MAX_AGE_MS = 60_000;
/** Refreshers skip the network when the cache is newer than this. */
const QUOTE_REFRESH_MS = 15_000;
const CLOCK_REFRESH_MS = 60_000;
const BARS_REFRESH_MS = 60 * 60_000;
const DAY_MS = 86_400_000;

export function quoteSource(): QuoteSource {
  return alpacaConfigured() ? "alpaca_iex" : "simulated";
}

export function pricesDisclaimer(): string {
  return quoteSource() === "simulated" ? SIMULATED_PRICES_DISCLAIMER : ALPACA_PRICES_DISCLAIMER;
}

// --- Sync readers --------------------------------------------------------------

interface QuoteRow {
  symbol: string;
  price_cents: number;
  prev_close_cents: number;
  as_of: string;
  fetched_at: string;
}

function toQuote(r: QuoteRow): Quote {
  return {
    symbol: r.symbol,
    priceCents: r.price_cents,
    previousCloseCents: r.prev_close_cents,
    changePct: Math.round(((r.price_cents - r.prev_close_cents) / r.prev_close_cents) * 10_000) / 100,
    asOf: r.as_of,
    source: "alpaca_iex",
    delayedMinutes: 0,
  };
}

/**
 * Current quote for a symbol. Simulated mode: the simulator (catalog only).
 * Alpaca mode: the cached quote if fetched within QUOTE_MAX_AGE_MS of `now`, else null.
 * `db` may be omitted only in simulated mode (it then returns null in Alpaca mode).
 */
export function quoteFor(db: DB | undefined, symbol: string, now: Date): Quote | null {
  if (quoteSource() === "simulated") return simulateQuote(symbol, now);
  if (!db) return null;
  const row = db.prepare("SELECT * FROM market_quotes WHERE symbol = ?").get(normalizeSymbol(symbol)) as
    QuoteRow | undefined;
  if (!row) return null;
  const age = now.getTime() - new Date(row.fetched_at).getTime();
  return age <= QUOTE_MAX_AGE_MS ? toQuote(row) : null;
}

/** Daily closes for roughly the last `days` days plus the current price. Null for symbols outside the catalog. */
export function historyFor(db: DB | undefined, symbol: string, days: number, now: Date): PriceHistory | null {
  if (quoteSource() === "simulated") return simulateHistory(symbol, days, now);
  const sym = normalizeSymbol(symbol);
  if (!db || !instrumentFor(db, sym)) return null;
  const n = Math.min(Math.max(Math.floor(days), 1), MAX_HISTORY_DAYS);
  const since = new Date(now.getTime() - n * DAY_MS).toISOString().slice(0, 10);
  const rows = db
    .prepare("SELECT date, close_cents FROM market_bars WHERE symbol = ? AND date >= ? ORDER BY date")
    .all(sym, since) as { date: string; close_cents: number }[];
  const points: PricePoint[] = rows.map((r) => ({ date: r.date, closeCents: r.close_cents }));
  const quote = quoteFor(db, sym, now);
  if (quote) {
    const today = quote.asOf.slice(0, 10);
    if (points.at(-1)?.date === today) points[points.length - 1] = { date: today, closeCents: quote.priceCents };
    else if (!points.length || points.at(-1)!.date < today) points.push({ date: today, closeCents: quote.priceCents });
  }
  return { symbol: sym, points, source: "alpaca_iex", disclaimer: ALPACA_PRICES_DISCLAIMER };
}

export function marketStatusFor(db: DB | undefined, now: Date): MarketStatus {
  if (quoteSource() === "simulated") {
    return { status: "open", label: SIMULATED_MARKET_STATUS, source: "simulated", nextOpen: null, nextClose: null };
  }
  const row = db?.prepare("SELECT value FROM market_data_state WHERE key = 'clock'").get() as
    { value: string } | undefined;
  if (!row) {
    return { status: "closed", label: msg("US market status unknown"), source: "alpaca_iex", nextOpen: null, nextClose: null };
  }
  const clock = JSON.parse(row.value) as AlpacaClock;
  // The cached clock can be up to a minute old: derive open/closed from its boundaries at `now`.
  const t = now.getTime();
  const open = clock.is_open ? t < new Date(clock.next_close).getTime() : t >= new Date(clock.next_open).getTime();
  return {
    status: open ? "open" : "closed",
    label: open ? msg("US market open") : msg("US market closed — orders queue for the next open"),
    source: "alpaca_iex",
    nextOpen: clock.next_open,
    nextClose: clock.next_close,
  };
}

// --- Async refreshers (Alpaca mode only; no-ops when simulated) -----------------

/** One in-flight refresh per database and key, so concurrent requests share a single API call. */
const inFlight = new WeakMap<DB, Map<string, Promise<void>>>();

function once(db: DB, key: string, run: () => Promise<void>): Promise<void> {
  let map = inFlight.get(db);
  if (!map) inFlight.set(db, (map = new Map()));
  const existing = map.get(key);
  if (existing) return existing;
  const p = run().finally(() => map!.delete(key));
  map.set(key, p);
  return p;
}

function upsertQuote(db: DB, symbol: string, priceCents: number, prevCloseCents: number, asOf: string, now: Date) {
  db.prepare(
    `INSERT INTO market_quotes (symbol, price_cents, prev_close_cents, as_of, fetched_at, source)
     VALUES (?, ?, ?, ?, ?, 'alpaca_iex')
     ON CONFLICT (symbol) DO UPDATE SET price_cents = excluded.price_cents, prev_close_cents = excluded.prev_close_cents,
       as_of = excluded.as_of, fetched_at = excluded.fetched_at, source = excluded.source`,
  ).run(symbol, priceCents, prevCloseCents, asOf, now.toISOString());
}

/** Snapshots for the catalog (plus `extra` symbols). Skipped while the cache is fresh unless `force`. */
export function refreshQuotes(db: DB, opts: { force?: boolean; extra?: string[] } = {}): Promise<void> {
  if (quoteSource() === "simulated") return Promise.resolve();
  const symbols = [...new Set([...catalogInstruments().map((i) => i.symbol), ...(opts.extra ?? []).map(normalizeSymbol)])];
  if (!opts.force) {
    const now = Date.now();
    const rows = db.prepare(`SELECT symbol, fetched_at FROM market_quotes WHERE symbol IN (${symbols.map(() => "?").join(",")})`)
      .all(...symbols) as { symbol: string; fetched_at: string }[];
    const fresh = rows.filter((r) => now - new Date(r.fetched_at).getTime() < QUOTE_REFRESH_MS);
    if (fresh.length === symbols.length) return Promise.resolve();
  }
  return once(db, `quotes:${symbols.join(",")}`, async () => {
    const snapshots = await getSnapshots(symbols);
    const now = new Date();
    db.transaction(() => {
      for (const [symbol, snap] of Object.entries(snapshots)) {
        const trade = snap?.latestTrade;
        if (!trade || !(trade.p > 0)) continue;
        const priceCents = decimalToCents(trade.p);
        // Previous session close: prevDailyBar, unless today's bar is the latest completed one.
        const prev = snap.prevDailyBar?.c ?? snap.dailyBar?.c ?? trade.p;
        const prevCloseCents = Math.max(1, decimalToCents(prev));
        if (priceCents > 0) upsertQuote(db, normalizeSymbol(symbol), priceCents, prevCloseCents, trade.t, now);
      }
    })();
  });
}

/** Caches a broker-reported price for a held symbol outside the catalog (positions valuation only). */
export function cacheBrokerPrice(db: DB, symbol: string, priceCents: number, prevCloseCents: number, now: Date): void {
  if (priceCents > 0 && prevCloseCents > 0) upsertQuote(db, normalizeSymbol(symbol), priceCents, prevCloseCents, now.toISOString(), now);
}

/**
 * Daily bars, about once an hour: the catalog as one batch (state key "bars"), plus any
 * `extra` symbols (searched or watched), each tracked under "bars:<SYMBOL>".
 */
export async function refreshBars(db: DB, opts: { force?: boolean; extra?: string[] } = {}): Promise<void> {
  if (quoteSource() === "simulated") return;
  const stale = (key: string) => {
    const state = db.prepare("SELECT fetched_at FROM market_data_state WHERE key = ?").get(key) as
      { fetched_at: string } | undefined;
    return opts.force || !state || Date.now() - new Date(state.fetched_at).getTime() >= BARS_REFRESH_MS;
  };
  const extras = [...new Set((opts.extra ?? []).map(normalizeSymbol))]
    .filter((s) => !findInstrument(s) && stale(`bars:${s}`));
  await Promise.all([
    stale("bars") ? fetchBars(db, catalogInstruments().map((i) => i.symbol), ["bars"]) : null,
    extras.length ? fetchBars(db, extras, extras.map((s) => `bars:${s}`)) : null,
  ]);
}

function fetchBars(db: DB, symbols: string[], stateKeys: string[]): Promise<void> {
  return once(db, `bars:${symbols.join(",")}`, async () => {
    const start = new Date(Date.now() - (MAX_HISTORY_DAYS + 7) * DAY_MS);
    const bars = await getDailyBars(symbols, start);
    const now = new Date().toISOString();
    db.transaction(() => {
      const ins = db.prepare(
        `INSERT INTO market_bars (symbol, date, close_cents, source) VALUES (?, ?, ?, 'alpaca_iex')
         ON CONFLICT (symbol, date) DO UPDATE SET close_cents = excluded.close_cents, source = excluded.source`,
      );
      for (const [symbol, list] of Object.entries(bars)) {
        for (const b of list) {
          const cents = decimalToCents(b.c);
          if (cents > 0) ins.run(normalizeSymbol(symbol), b.t.slice(0, 10), cents);
        }
      }
      const mark = db.prepare(
        `INSERT INTO market_data_state (key, value, fetched_at) VALUES (?, '{}', ?)
         ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at`,
      );
      for (const key of stateKeys) mark.run(key, now);
    })();
  });
}

export function refreshClock(db: DB, opts: { force?: boolean } = {}): Promise<void> {
  if (quoteSource() === "simulated") return Promise.resolve();
  const state = db.prepare("SELECT fetched_at FROM market_data_state WHERE key = 'clock'").get() as
    { fetched_at: string } | undefined;
  if (!opts.force && state && Date.now() - new Date(state.fetched_at).getTime() < CLOCK_REFRESH_MS) {
    return Promise.resolve();
  }
  return once(db, "clock", async () => {
    const clock = await getClock();
    db.prepare(
      `INSERT INTO market_data_state (key, value, fetched_at) VALUES ('clock', ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at`,
    ).run(JSON.stringify(clock), new Date().toISOString());
  });
}
