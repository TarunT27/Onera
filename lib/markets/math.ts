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

// --- Decimal strings (broker API) --------------------------------------------
// Alpaca sends money and share quantities as decimal strings ("187.2345",
// "0.123456789"). These convert them exactly with BigInt: never via floats.

const DECIMAL = /^(-)?(\d+)(?:\.(\d+))?$/;

/** A decimal string (or a finite JSON number) scaled by 10^scale, rounded as requested (round = half away from zero). */
export function decimalToScaled(value: string | number, scale: number, mode: Rounding = "round"): bigint {
  const text = typeof value === "number" ? numberToDecimal(value) : value.trim();
  const m = DECIMAL.exec(text);
  if (!m) throw new Error(`Not a decimal: ${JSON.stringify(value)}`);
  const negative = m[1] === "-";
  const frac = m[3] ?? "";
  const kept = BigInt(m[2] + frac.slice(0, scale).padEnd(scale, "0"));
  const rest = frac.slice(scale);
  const hasRest = /[1-9]/.test(rest);
  let magnitude = kept;
  if (hasRest) {
    // Rounding acts on the magnitude; floor/ceil are mirrored for negatives.
    const up =
      mode === "round" ? rest[0] >= "5"
      : mode === "ceil" ? !negative
      : negative;
    if (up) magnitude += 1n;
  }
  return negative ? -magnitude : magnitude;
}

/** Exact decimal text of a finite JSON number (handles exponent notation). */
function numberToDecimal(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`Not a finite number: ${n}`);
  const text = String(n);
  if (!/e/i.test(text)) return text;
  return n.toFixed(Math.min(20, Math.max(0, -Math.floor(Math.log10(Math.abs(n))) + 15)));
}

export function decimalToCents(value: string | number, mode: Rounding = "round"): number {
  return Number(decimalToScaled(value, 2, mode));
}

export function decimalToMicros(value: string | number, mode: Rounding = "floor"): number {
  return Number(decimalToScaled(value, 6, mode));
}

function scaledToDecimal(n: number, scale: number): string {
  if (!Number.isSafeInteger(n)) throw new Error(`Not a safe integer: ${n}`);
  const sign = n < 0 ? "-" : "";
  const digits = String(Math.abs(n)).padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const frac = digits.slice(-scale).replace(/0+$/, "");
  return `${sign}${whole}${frac ? `.${frac}` : ""}`;
}

/** 1234567 → "1.234567" (trailing zeros trimmed). */
export function microsToDecimal(quantityMicros: number): string {
  return scaledToDecimal(quantityMicros, 6);
}

/** 12345 → "123.45". Always two decimals, as broker limit prices expect. */
export function centsToDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error(`Not a safe integer: ${cents}`);
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** Gross cents of a decimal quantity × decimal price (both exact), rounded as requested. */
export function decimalProductCents(quantity: string | number, price: string | number, mode: Rounding): number {
  const SCALE = 9;
  const q = decimalToScaled(quantity, SCALE, "floor");
  const p = decimalToScaled(price, SCALE, "round");
  if (q < 0n || p < 0n) throw new Error("decimalProductCents: negative input");
  const num = q * p * 100n;
  const den = 10n ** BigInt(SCALE * 2);
  const whole = num / den;
  const rem = num % den;
  if (rem === 0n || mode === "floor") return Number(whole);
  if (mode === "ceil") return Number(whole + 1n);
  return Number(rem * 2n >= den ? whole + 1n : whole);
}
