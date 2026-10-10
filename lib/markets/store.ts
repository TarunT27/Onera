/**
 * Session-scoped reads shared by the markets services. Every query filters on
 * user_id; records owned by someone else are "not found".
 *
 * lib/finance/accounts imports this module's getPortfolio, so accounts are
 * read here directly instead of through lib/finance (avoids an import cycle).
 */
import type { DB } from "@/lib/db";
import { toAccount, type AccountRow } from "@/lib/db/rows";
import { notFound, ServiceError } from "@/lib/errors";
import type { Account, UserId } from "@/lib/types";
import { DEFAULT_TRADING_CONTROLS } from "./db";
import { utcDayWindow } from "./math";
import { isTradableAccount } from "./policy";
import { toTradingControls, type MandateRow, type TradingControlsRow } from "./rows";
import type { TradingControls } from "./types";

export function loadOwnedAccount(db: DB, userId: UserId, accountId: string): Account {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId);
  if (!row) throw notFound("Account");
  return toAccount(row as AccountRow);
}

/** Throws 400 UNSUPPORTED unless the account is a paper account with the "trade" capability. */
export function assertTradable(account: Account): void {
  if (!isTradableAccount(account)) {
    throw new ServiceError("UNSUPPORTED",
      `${account.name} is view-only. Orders can only be placed in a paper trading account.`, 400);
  }
}

export function heldQuantityMicros(db: DB, userId: UserId, accountId: string, symbol: string): number {
  const row = db
    .prepare("SELECT quantity_micros AS q FROM positions WHERE user_id = ? AND account_id = ? AND symbol = ?")
    .get(userId, accountId, symbol) as { q: number } | undefined;
  return row?.q ?? 0;
}

export function readTradingControls(db: DB, userId: UserId): TradingControls {
  const row = db.prepare("SELECT * FROM trading_controls WHERE user_id = ?").get(userId);
  if (row) return toTradingControls(row as TradingControlsRow);
  // Conservative defaults for a user without a row (never looser than the seeded demo values).
  return { userId, ...DEFAULT_TRADING_CONTROLS, updatedAt: new Date(0).toISOString() };
}

/** Gross value of this user's paper orders executed in the UTC day containing `now`. */
export function ordersExecutedTodayCents(db: DB, userId: UserId, now: Date): number {
  const { start, end } = utcDayWindow(now);
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(filled_gross_cents), 0) AS total FROM orders
              WHERE user_id = ? AND state = 'EXECUTED' AND executed_at >= ? AND executed_at < ?`)
    .get(userId, start, end) as { total: number };
  return total;
}

/** Gross value executed under one mandate in the UTC day containing `now`. */
export function mandateUsedTodayCents(db: DB, userId: UserId, mandateId: string, now: Date): number {
  const { start, end } = utcDayWindow(now);
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(filled_gross_cents), 0) AS total FROM orders
              WHERE user_id = ? AND mandate_id = ? AND state = 'EXECUTED' AND executed_at >= ? AND executed_at < ?`)
    .get(userId, mandateId, start, end) as { total: number };
  return total;
}

export function loadMandateRow(db: DB, userId: UserId, mandateId: string): MandateRow | null {
  const row = db.prepare("SELECT * FROM mandates WHERE id = ? AND user_id = ?").get(mandateId, userId);
  return (row as MandateRow | undefined) ?? null;
}
