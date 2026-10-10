/**
 * Demo FX. Rates are synthetic, dated and labeled. Conversion uses integer
 * math: cents × rate_micros / 1,000,000, rounded half away from zero.
 */
import type { DB } from "@/lib/db";
import type { CurrencyCode, FxRate } from "@/lib/types";

/** Synthetic rates seeded with the demo data (USD per unit). */
export const DEMO_FX_RATES: Record<CurrencyCode, number> = {
  USD: 1_000_000,
  EUR: 1_085_000,
  GBP: 1_270_000,
  CAD: 730_000,
};

export function listFxRates(db: DB): FxRate[] {
  const rows = db.prepare("SELECT currency, rate_micros, as_of, source FROM fx_rates ORDER BY currency").all() as {
    currency: CurrencyCode; rate_micros: number; as_of: string; source: string;
  }[];
  return rows.map((r) => ({ currency: r.currency, rateMicros: r.rate_micros, asOf: r.as_of, source: r.source }));
}

export function convertToUsdCents(cents: number, rateMicros: number): number {
  const scaled = cents * rateMicros;
  const sign = scaled < 0 ? -1 : 1;
  return sign * Math.round(Math.abs(scaled) / 1_000_000);
}

/** Returns a converter bound to the stored rates. Throws for a currency with no rate. */
export function usdConverter(db: DB): (cents: number, currency: CurrencyCode) => number {
  const rates = new Map(listFxRates(db).map((r) => [r.currency, r.rateMicros]));
  return (cents, currency) => {
    if (currency === "USD") return cents;
    const rate = rates.get(currency);
    if (rate === undefined) throw new Error(`No FX rate for ${currency}`);
    return convertToUsdCents(cents, rate);
  };
}
