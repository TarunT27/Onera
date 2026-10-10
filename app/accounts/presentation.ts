import type { Account, CurrencyCode, FxRate, Transaction } from "@/lib/types";

/** Defense-in-depth for display; session ownership remains enforced by the server. */
export function filterAccountActivity<T extends Pick<Transaction, "accountId" | "description" | "merchant" | "category">>(transactions: T[], accountId: string | undefined, query: string, allowedAccountIds?: readonly string[]): T[] {
  const allowed = allowedAccountIds ? new Set(allowedAccountIds) : null;
  return transactions.filter((t) => (!accountId || t.accountId === accountId) &&
    (!allowed || allowed.has(t.accountId)) &&
    `${t.description} ${t.merchant ?? ""} ${t.category}`.toLowerCase().includes(query.toLowerCase()),
  );
}

/** Bank/account matches scope activity; otherwise preserve merchant/category search. */
export function directoryActivityScope(accounts: Pick<Account, "id" | "type" | "name" | "institution" | "mask">[], kind: string, query: string) {
  const eligible = accounts.filter((account) => kind === "all" || account.type === kind);
  const term = query.trim().toLowerCase();
  const matching = term ? eligible.filter((account) => `${account.name} ${account.institution} ${account.mask}`.toLowerCase().includes(term)) : [];
  return {
    accountIds: (matching.length ? matching : eligible).map((account) => account.id),
    query: matching.length ? "" : term,
  };
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
