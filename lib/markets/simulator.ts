/**
 * Deterministic market simulator. NOT real market data.
 *
 * Daily closes follow a seeded random walk (mean-reverting around a slow
 * drift) from a fixed epoch, so the same symbol and time always give the same
 * price. Intraday prices move smoothly from the previous close toward the
 * day's close, plus a small deterministic per-minute wiggle. The simulated
 * market is always open.
 *
 * Floating point is used only to generate prices; every price leaves this file
 * as integer cents.
 */
import { findInstrument, normalizeSymbol, simParams, type SimParams } from "./instruments";
import { SIMULATED_PRICES_DISCLAIMER, type PriceHistory, type PricePoint, type Quote } from "./types";

const EPOCH_MS = Date.UTC(2024, 0, 1);
const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
/** Pull back toward the trend each day (AR(1) coefficient). */
const MEAN_REVERSION = 0.99;
/** Per-minute wiggle is capped well below the 1% order price bound. */
const MAX_INTRADAY_WIGGLE = 0.0015;

export const MAX_HISTORY_DAYS = 365;

// --- Seeded PRNG ----------------------------------------------------------

function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function gaussian(key: string): number {
  const rng = mulberry32(hash32(key));
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function uniform(key: string): number {
  return mulberry32(hash32(key))();
}

// --- Daily closes -----------------------------------------------------------

/** Mean-reverting deviation of the log price from trend, per day since epoch. Memoized per symbol. */
const deviationCache = new Map<string, number[]>();

function deviation(symbol: string, sim: SimParams, day: number): number {
  if (day <= 0) return 0;
  let series = deviationCache.get(symbol);
  if (!series) {
    series = [0];
    deviationCache.set(symbol, series);
  }
  for (let d = series.length; d <= day; d++) {
    series.push(MEAN_REVERSION * series[d - 1] + sim.dailyVol * gaussian(`${symbol}:close:${d}`));
  }
  return series[day];
}

function logClose(symbol: string, sim: SimParams, day: number): number {
  const d = Math.max(day, 0);
  return Math.log(sim.basePriceCents) + (sim.annualDrift * d) / 365 + deviation(symbol, sim, d);
}

const toCents = (logPrice: number) => Math.max(1, Math.round(Math.exp(logPrice)));

export function dayIndex(t: Date): number {
  return Math.floor((t.getTime() - EPOCH_MS) / DAY_MS);
}

function dayDate(day: number): string {
  return new Date(EPOCH_MS + day * DAY_MS).toISOString().slice(0, 10);
}

// --- Public API -------------------------------------------------------------

function intradayLogPrice(symbol: string, sim: SimParams, now: Date): { log: number; day: number; minute: number } {
  const day = dayIndex(now);
  const minute = Math.floor((now.getTime() - (EPOCH_MS + day * DAY_MS)) / MINUTE_MS); // 0..1439
  const frac = minute / 1440;
  const prev = logClose(symbol, sim, day - 1);
  const close = logClose(symbol, sim, day);
  const amplitude = Math.min(MAX_INTRADAY_WIGGLE, sim.dailyVol * 0.1);
  const wiggle = amplitude * (2 * uniform(`${symbol}:minute:${day}:${minute}`) - 1) * Math.sin(Math.PI * frac);
  return { log: prev + frac * (close - prev) + wiggle, day, minute };
}

/** Simulated quote at `now` (to the minute). Null for symbols outside the catalog. */
export function simulateQuote(symbol: string, now: Date = new Date()): Quote | null {
  const sym = normalizeSymbol(symbol);
  const sim = simParams(sym);
  if (!sim) return null;
  const { log, day, minute } = intradayLogPrice(sym, sim, now);
  const priceCents = toCents(log);
  const previousCloseCents = toCents(logClose(sym, sim, day - 1));
  const changePct = Math.round(((priceCents - previousCloseCents) / previousCloseCents) * 10_000) / 100;
  return {
    symbol: sym,
    priceCents,
    previousCloseCents,
    changePct,
    asOf: new Date(EPOCH_MS + day * DAY_MS + minute * MINUTE_MS).toISOString(),
    source: "simulated",
    delayedMinutes: 0,
  };
}

/** Daily closes for the `days` completed days before `now`, then the current price. */
export function simulateHistory(symbol: string, days: number, now: Date = new Date()): PriceHistory | null {
  const sym = normalizeSymbol(symbol);
  const sim = simParams(sym);
  if (!sim || !findInstrument(sym)) return null;
  const n = Math.min(Math.max(Math.floor(days), 1), MAX_HISTORY_DAYS);
  const today = dayIndex(now);
  const points: PricePoint[] = [];
  for (let d = today - n; d < today; d++) {
    points.push({ date: dayDate(d), closeCents: toCents(logClose(sym, sim, d)) });
  }
  points.push({ date: dayDate(today), closeCents: simulateQuote(sym, now)!.priceCents });
  return { symbol: sym, points, source: "simulated", disclaimer: SIMULATED_PRICES_DISCLAIMER };
}
