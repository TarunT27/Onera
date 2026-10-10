/**
 * Deterministic recurring-charge detection. Flags a monthly subscription whose
 * latest charge is higher than the steady amount before it, with the exact
 * transactions as evidence.
 */
import type { DB } from "@/lib/db";
import { toTransaction, type TransactionRow } from "@/lib/db/rows";
import type { SubscriptionIncrease, Transaction, UserId } from "@/lib/types";
import { isSpending } from "./spending";

const DAY_MS = 86_400_000;
const MIN_CHARGES = 3;
const CADENCE_MIN_DAYS = 25;
const CADENCE_MAX_DAYS = 35;
const RECENT_DAYS = 45;
const EVIDENCE_CHARGES = 4;

export function detectSubscriptionIncreases(
  db: DB,
  userId: UserId,
  asOf: Date = new Date(),
): SubscriptionIncrease[] {
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE user_id = ? AND merchant IS NOT NULL ORDER BY posted_at ASC`)
    .all(userId) as TransactionRow[];
  return detectFromTransactions(rows.map(toTransaction), asOf);
}

export function detectFromTransactions(transactions: Transaction[], asOf: Date): SubscriptionIncrease[] {
  const groups = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!isSpending(t) || !t.merchant) continue;
    const key = `${t.accountId}|${t.merchant.trim().toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), t]);
  }

  const findings: SubscriptionIncrease[] = [];
  for (const charges of groups.values()) {
    charges.sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    const recent = charges.slice(-EVIDENCE_CHARGES);
    if (recent.length < MIN_CHARGES) continue;

    const monthly = recent.every((t, i) => {
      if (i === 0) return true;
      const gap = (Date.parse(t.postedAt) - Date.parse(recent[i - 1].postedAt)) / DAY_MS;
      return gap >= CADENCE_MIN_DAYS && gap <= CADENCE_MAX_DAYS;
    });
    if (!monthly) continue;

    const latest = recent[recent.length - 1];
    if ((asOf.getTime() - Date.parse(latest.postedAt)) / DAY_MS > RECENT_DAYS) continue;

    const prior = recent.slice(0, -1);
    const steady = prior.every((t) => t.amountCents === prior[0].amountCents);
    const previousAmount = -prior[prior.length - 1].amountCents;
    const currentAmount = -latest.amountCents;
    if (!steady || currentAmount <= previousAmount) continue;

    const increase = currentAmount - previousAmount;
    findings.push({
      kind: "subscription_price_increase",
      merchant: latest.merchant!,
      accountId: latest.accountId,
      previousAmountCents: previousAmount,
      currentAmountCents: currentAmount,
      increaseCents: increase,
      increasePct: Math.round((increase / previousAmount) * 1000) / 10,
      cadence: "monthly",
      evidenceTransactionIds: recent.map((t) => t.id),
      latestChargeAt: latest.postedAt,
    });
  }
  return findings.sort((a, b) => b.increaseCents - a.increaseCents);
}
