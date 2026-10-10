/**
 * Deterministic spending calculations. The assistant calls these through tools
 * rather than doing arithmetic itself.
 */
import type { DB } from "@/lib/db";
import { toTransaction, type TransactionRow } from "@/lib/db/rows";
import type { SpendingSummary, Transaction, UserId } from "@/lib/types";
import { usdConverter } from "./fx";

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function monthBounds(asOf: Date, offset: number): { start: string; end: string; key: string } {
  const start = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + offset, 1));
  const end = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth() + offset + 1, 1));
  return { start: start.toISOString(), end: end.toISOString(), key: monthKey(start) };
}

/** A transaction counts as spending when it is a posted outflow that is not an internal transfer leg. */
export function isSpending(t: Transaction): boolean {
  return t.status === "posted" && t.amountCents < 0 && t.transferGroupId === null;
}

function postedBetween(db: DB, userId: UserId, start: string, end: string): Transaction[] {
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE user_id = ? AND posted_at >= ? AND posted_at < ?`)
    .all(userId, start, end);
  return (rows as TransactionRow[]).map(toTransaction);
}

export function spendingSummary(db: DB, userId: UserId, asOf: Date = new Date()): SpendingSummary {
  const cur = monthBounds(asOf, 0);
  const prev = monthBounds(asOf, -1);
  const current = postedBetween(db, userId, cur.start, cur.end);
  const previous = postedBetween(db, userId, prev.start, prev.end);

  const toUsd = usdConverter(db);
  const usd = (t: Transaction) => toUsd(t.amountCents, t.currency);
  const spend = current.filter(isSpending);
  const byCat = new Map<string, number>();
  for (const t of spend) byCat.set(t.category, (byCat.get(t.category) ?? 0) - usd(t));

  return {
    month: cur.key,
    totalCents: spend.reduce((s, t) => s - usd(t), 0),
    previousMonth: prev.key,
    previousTotalCents: previous.filter(isSpending).reduce((s, t) => s - usd(t), 0),
    byCategory: [...byCat.entries()]
      .map(([category, totalCents]) => ({ category, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents),
    excludedInternalTransferCents: current
      .filter((t) => t.transferGroupId !== null && t.amountCents < 0)
      .reduce((s, t) => s - usd(t), 0),
    transactionCount: spend.length,
  };
}
