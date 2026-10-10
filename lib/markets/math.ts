/**
 * Integer money math for shares × prices. Quantities are micro-shares, prices
 * and values are cents. BigInt keeps the products exact.
 */
export const MICROS_PER_SHARE = 1_000_000;

type Rounding = "floor" | "ceil" | "round";

/** a × b ÷ d for non-negative integers, rounded as requested (round = half up). */
export function mulDiv(a: number, b: number, d: number, mode: Rounding): number {
  if (d <= 0) throw new Error("mulDiv: divisor must be positive");
  const p = BigInt(a) * BigInt(b);
  const D = BigInt(d);
  const q = p / D;
  const r = p % D;
  if (mode === "floor" || r === 0n) return Number(q);
  if (mode === "ceil") return Number(q + 1n);
  return Number(r * 2n >= D ? q + 1n : q);
}

/** Value in cents of `quantityMicros` shares at `priceCents`. */
export function valueCents(quantityMicros: number, priceCents: number, mode: Rounding = "round"): number {
  return mulDiv(quantityMicros, priceCents, MICROS_PER_SHARE, mode);
}

/** Buy: maximum acceptable fill price (quote + 1%, rounded up). Sell: minimum (quote − 1%, rounded down). */
export function priceBoundFor(side: "buy" | "sell", quotePriceCents: number): number {
  return side === "buy" ? mulDiv(quotePriceCents, 101, 100, "ceil") : Math.max(1, mulDiv(quotePriceCents, 99, 100, "floor"));
}

/** Display-only formatting for policy details. */
export function usd(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

/** Display-only share count (micro-shares → up to 6 decimals). */
export function shares(quantityMicros: number): string {
  return (quantityMicros / MICROS_PER_SHARE).toLocaleString("en-US", { maximumFractionDigits: 6 });
}

/** UTC day window [start, end) containing `now`, as ISO strings. */
export function utcDayWindow(now: Date): { start: string; end: string } {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: new Date(start).toISOString(), end: new Date(start + 86_400_000).toISOString() };
}
