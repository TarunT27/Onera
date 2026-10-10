/**
 * Scoped reads. Every function takes the session user ID and filters on it;
 * a record owned by someone else is reported as "not found".
 */
import type { DB } from "@/lib/db";
import {
  toAccount,
  toRecipient,
  toTransaction,
  type AccountRow,
  type RecipientRow,
  type TransactionRow,
} from "@/lib/db/rows";
import { notFound } from "@/lib/errors";
import type { Account, Recipient, Transaction, UserId } from "@/lib/types";

export function listAccounts(db: DB, userId: UserId): Account[] {
  const rows = db.prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY type, id").all(userId);
  return (rows as AccountRow[]).map(toAccount);
}

export function getOwnedAccount(db: DB, userId: UserId, accountId: string): Account {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId);
  if (!row) throw notFound("Account");
  return toAccount(row as AccountRow);
}

export function netWorthCents(accounts: Account[]): number {
  return accounts.reduce((sum, a) => sum + a.balanceCents, 0);
}

export function listTransactions(
  db: DB,
  userId: UserId,
  opts: { accountId?: string; limit?: number; sinceIso?: string } = {},
): Transaction[] {
  if (opts.accountId) getOwnedAccount(db, userId, opts.accountId); // ownership check
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const clauses = ["user_id = ?"];
  const params: (string | number)[] = [userId];
  if (opts.accountId) { clauses.push("account_id = ?"); params.push(opts.accountId); }
  if (opts.sinceIso) { clauses.push("posted_at >= ?"); params.push(opts.sinceIso); }
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE ${clauses.join(" AND ")} ORDER BY posted_at DESC, id DESC LIMIT ?`)
    .all(...params, limit);
  return (rows as TransactionRow[]).map(toTransaction);
}

export function getTransactionsByIds(db: DB, userId: UserId, ids: string[]): Transaction[] {
  if (ids.length === 0) return [];
  const rows = db
    .prepare(`SELECT * FROM transactions WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .all(userId, ...ids);
  return (rows as TransactionRow[]).map(toTransaction);
}

export function listRecipients(db: DB, userId: UserId): Recipient[] {
  const rows = db.prepare("SELECT * FROM recipients WHERE user_id = ? ORDER BY kind DESC, display_name").all(userId);
  return (rows as RecipientRow[]).map(toRecipient);
}

export function getOwnedRecipient(db: DB, userId: UserId, recipientId: string): Recipient {
  const row = db.prepare("SELECT * FROM recipients WHERE id = ? AND user_id = ?").get(recipientId, userId);
  if (!row) throw notFound("Recipient");
  return toRecipient(row as RecipientRow);
}
