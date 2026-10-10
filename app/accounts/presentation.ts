import type { CurrencyCode, FxRate, Transaction } from "@/lib/types";

/** Defense-in-depth for display; session ownership remains enforced by the server. */
export function filterAccountActivity<T extends Pick<Transaction, "accountId" | "description" | "merchant" | "category">>(transactions: T[], accountId: string | undefined, query: string): T[] {
  return transactions.filter((t) => (!accountId || t.accountId === accountId) &&
    `${t.description} ${t.merchant ?? ""} ${t.category}`.toLowerCase().includes(query.toLowerCase()),
  );
}

/** Display-only equivalent using the dated server rates, never execution FX. */
export function displayUsdCents(cents: number, currency: CurrencyCode, rates: FxRate[]): number | null {
  if (!Number.isSafeInteger(cents)) return null;
  if (currency === "USD") return cents;
  const rate = rates.find((r) => r.currency === currency)?.rateMicros;
  if (!rate || !Number.isSafeInteger(rate) || rate < 0) return null;
  const scaled = BigInt(cents) * BigInt(rate);
  const magnitude = scaled < 0n ? -scaled : scaled;
  const rounded = (magnitude + 500_000n) / 1_000_000n;
  const result = Number(scaled < 0n ? -rounded : rounded);
  return Number.isSafeInteger(result) ? result : null;
}
