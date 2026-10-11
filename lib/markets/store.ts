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
import { alpacaConfig } from "./alpaca";
import { DEFAULT_TRADING_CONTROLS } from "./db";
import { utcDayWindow } from "./math";
import { isTradableAccount, type BrokerTerms } from "./policy";
import { toTradingControls, venueOf, type BrokerLinkRow, type MandateRow, type TradingControlsRow } from "./rows";
import type { TradingControls } from "./types";

export function loadOwnedAccount(db: DB, userId: UserId, accountId: string): Account {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ? AND user_id = ?").get(accountId, userId);
  if (!row) throw notFound("Account");
  return toAccount(row as AccountRow);
}

export function brokerLinkFor(db: DB, userId: UserId, accountId: string): BrokerLinkRow | null {
  const row = db.prepare("SELECT * FROM broker_links WHERE account_id = ? AND user_id = ?").get(accountId, userId);
  return (row as BrokerLinkRow | undefined) ?? null;
}

/**
 * Policy view of an account's Alpaca link, or null for Onera paper accounts. "connected"
 * requires the server to hold keys for this user and for the environment the account was
 * linked in, so changing ALPACA_ENV can never route a paper approval to a live account.
 */
export function brokerTermsFor(db: DB, userId: UserId, accountId: string): BrokerTerms | null {
  const link = brokerLinkFor(db, userId, accountId);
  if (!link) return null;
  const c = alpacaConfig();
  const venue = venueOf(link);
  return {
    venue: venue === "alpaca_live" ? "alpaca_live" : "alpaca_paper",
    connected: c.keyId !== "" && c.secretKey !== "" && c.env === link.env && c.userId === userId,
    liveTradingAllowed: c.liveTradingAllowed,
    liveMaxOrderCents: c.liveMaxOrderCents,
  };
}

/** Throws 400 UNSUPPORTED unless orders can be placed in the account. */
export function assertTradable(account: Account, broker: BrokerTerms | null = null): void {
  if (!isTradableAccount(account, broker)) {
    if (broker !== null) {
      throw new ServiceError("UNSUPPORTED", broker.connected
        ? `${account.name} is a live Alpaca account and live trading is turned off.`
        : `${account.name} is not connected to Alpaca right now. Check the Alpaca keys on the server.`, 400);
    }
    throw new ServiceError("UNSUPPORTED",
      `${account.name} is view-only. Orders can only be placed in a paper trading account.`, 400);
  }
}

/** Shares held, minus shares already committed to this user's open broker sell orders. */
export function heldQuantityMicros(db: DB, userId: UserId, accountId: string, symbol: string): number {
  const row = db
    .prepare("SELECT quantity_micros AS q FROM positions WHERE user_id = ? AND account_id = ? AND symbol = ?")
    .get(userId, accountId, symbol) as { q: number } | undefined;
  const { open } = db
    .prepare(`SELECT COALESCE(SUM(COALESCE(broker_qty_micros, quantity_micros)), 0) AS open FROM orders
              WHERE user_id = ? AND account_id = ? AND symbol = ? AND side = 'sell'
                AND state IN ('SUBMITTING','SUBMITTED')`)
    .get(userId, accountId, symbol) as { open: number };
  return Math.max(0, (row?.q ?? 0) - open);
}

export function readTradingControls(db: DB, userId: UserId): TradingControls {
  const row = db.prepare("SELECT * FROM trading_controls WHERE user_id = ?").get(userId);
  if (row) return toTradingControls(row as TradingControlsRow);
  // Conservative defaults for a user without a row (never looser than the seeded demo values).
  return { userId, ...DEFAULT_TRADING_CONTROLS, updatedAt: new Date(0).toISOString() };
}

/**
 * Value counted against the daily limit in the UTC day containing `now`: gross value of
 * executed orders, plus the worst-case value reserved by orders still open at the broker
 * (submitted today). An open order's reservation is replaced by its fill once it executes.
 */
export function ordersExecutedTodayCents(db: DB, userId: UserId, now: Date): number {
  const { start, end } = utcDayWindow(now);
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(filled_gross_cents), 0) AS total FROM orders
              WHERE user_id = ? AND state = 'EXECUTED' AND executed_at >= ? AND executed_at < ?`)
    .get(userId, start, end) as { total: number };
  const { reserved } = db
    .prepare(`SELECT COALESCE(SUM(reserved_cents), 0) AS reserved FROM orders
              WHERE user_id = ? AND state IN ('SUBMITTING','SUBMITTED') AND submitted_at >= ? AND submitted_at < ?`)
    .get(userId, start, end) as { reserved: number };
  return total + reserved;
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
