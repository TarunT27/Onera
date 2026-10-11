/**
 * Alpaca brokerage: connect, mirror, submit, sync and cancel.
 *
 * Governance is unchanged from Onera paper orders: an order is proposed, held
 * or awaits the user's exact-version approval, and only the signed-in user's
 * route submits it. What differs is where it fills:
 *
 *   APPROVED ─(submitOrder: one IMMEDIATE transaction re-verifies the approval
 *   hash and policy, then claims)→ SUBMITTING ─(POST /v2/orders, outside any
 *   transaction)→ SUBMITTED ─(syncOrders)→ EXECUTED | CANCELED | FAILED
 *
 * Orders go to Alpaca as LIMIT orders at the approved price bound (day only,
 * no extended hours), so the broker itself enforces the price the user saw.
 * Notional buys are converted to a quantity at the bound, so the worst-case
 * spend never exceeds the approved amount. client_order_id = "<id>-v<version>"
 * makes submission idempotent: an ambiguous failure (timeout, 5xx) is
 * reconciled by looking the order up, never by blindly re-posting.
 *
 * Cash and positions are mirrored from Alpaca into the existing accounts and
 * positions tables, so the deterministic policy, portfolio and agents read
 * them synchronously like any other account. Available cash is
 * min(cash, non-marginable buying power): Onera never trades on margin.
 */
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { badRequest, conflict, notFound, ServiceError } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import {
  AlpacaError,
  alpacaConfig,
  alpacaConfigured,
  alpacaStatus,
  cancelBrokerOrder,
  getAccount,
  getAccountConfig,
  getAsset,
  getBrokerOrder,
  getOrderByClientId,
  listPositions,
  postOrder,
  requireAlpaca,
  type AlpacaAccount,
  type AlpacaOrder,
  type AlpacaPosition,
} from "./alpaca";
import { executeOrder, isTransientLockError, verifyApprovedOrder } from "./broker";
import { findInstrument } from "./instruments";
import { cacheBrokerPrice, refreshBars, refreshClock, refreshQuotes } from "./marketdata";
import {
  centsToDecimal,
  decimalProductCents,
  decimalToCents,
  decimalToMicros,
  MICROS_PER_SHARE,
  microsToDecimal,
  mulDiv,
} from "./math";
import { getOrder, loadOrderRow } from "./orders";
import type { BrokerLinkRow, OrderRow } from "./rows";
import { venueOf } from "./rows";
import type { BrokerConnection, OrderFill, PaperOrder, PlaceOrderResult } from "./types";

/** Account mirrors newer than this are reused (unless forced). */
const ACCOUNT_SYNC_MS = 10_000;
/** A SUBMITTING order Alpaca still doesn't know after this long was never placed. */
const SUBMIT_CONFIRM_MS = 2 * 60_000;
const OPEN_STATES = ["SUBMITTING", "SUBMITTED"] as const;
/** Alpaca statuses after which nothing more can fill. */
const TERMINAL = new Set(["filled", "canceled", "expired", "rejected"]);

// --- Errors -----------------------------------------------------------------------

/** Maps an Alpaca failure (outside order submission) to a user-facing ServiceError. Never echoes keys. */
function brokerError(err: unknown, what: string): ServiceError {
  if (err instanceof ServiceError) return err;
  if (!(err instanceof AlpacaError)) {
    return new ServiceError("INTERNAL", `${what} failed.`, 502, { retryable: true });
  }
  switch (err.kind) {
    case "auth":
      return new ServiceError("UNSUPPORTED",
        "Alpaca rejected the API keys. Check ALPACA_API_KEY_ID / ALPACA_API_SECRET_KEY and ALPACA_ENV.", 503);
    case "rate_limited":
      return new ServiceError("RATE_LIMITED", "Alpaca rate limit reached. Try again in a minute.", 429,
        { retryable: true });
    case "network":
    case "server":
      return new ServiceError("INTERNAL", `Alpaca could not be reached (${what}). Nothing changed; try again.`, 502,
        { retryable: true });
    default:
      return new ServiceError("INTERNAL", `${what} failed: ${err.brokerMessage}`, 502);
  }
}

// --- Connection ---------------------------------------------------------------------

function accountIdFor(userId: UserId, env: "paper" | "live"): string {
  return `acct_${userId}_alpaca_${env}`;
}

function linkForUser(db: DB, userId: UserId, env: "paper" | "live"): BrokerLinkRow | null {
  const row = db.prepare("SELECT * FROM broker_links WHERE user_id = ? AND env = ?").get(userId, env);
  return (row as BrokerLinkRow | undefined) ?? null;
}

/** Status of the user's Alpaca connection for the Trade screen. Never includes keys. */
export function getBrokerConnection(db: DB, userId: UserId): BrokerConnection {
  const status = alpacaStatus();
  const c = alpacaConfig();
  const link = linkForUser(db, userId, c.env);
  return {
    broker: "alpaca",
    configured: status.configured,
    env: status.env,
    tradingEnabled: status.tradingEnabled,
    availableToUser: status.configured && c.userId === userId,
    accountId: link?.account_id ?? null,
    accountNumberMask: link?.account_number_mask ?? null,
    connectedAt: link?.connected_at ?? null,
    lastSyncedAt: link?.last_synced_at ?? null,
    lastSyncError: link?.last_sync_error ?? null,
    liveMaxOrderCents: status.liveMaxOrderCents,
    feed: status.feed,
  };
}

/**
 * Mirrors Alpaca's cash and long positions into the account. Must run inside a transaction.
 * Short positions are skipped (Onera never shorts); held quantities round down to micro-shares.
 */
function applyAccountSnapshot(
  db: DB,
  userId: UserId,
  accountId: string,
  account: AlpacaAccount,
  positions: AlpacaPosition[],
  now: Date,
): void {
  const ts = now.toISOString();
  const cash = decimalToCents(account.cash, "floor");
  const nonMarginable = decimalToCents(account.non_marginable_buying_power, "floor");
  const available = Math.max(0, Math.min(cash, nonMarginable));
  db.prepare(
    `UPDATE accounts SET balance_cents = ?, available_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  ).run(cash, available, ts, accountId, userId);

  db.prepare("DELETE FROM positions WHERE user_id = ? AND account_id = ?").run(userId, accountId);
  const ins = db.prepare(
    `INSERT INTO positions (user_id, account_id, symbol, quantity_micros, cost_basis_cents, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const p of positions) {
    if (p.side !== "long") continue;
    const qty = decimalToMicros(p.qty, "floor");
    if (qty <= 0) continue;
    const cost = Math.max(0, decimalToCents(p.cost_basis, "round"));
    ins.run(userId, accountId, p.symbol.toUpperCase(), qty, cost, ts);
    // Value holdings outside the catalog at the broker's price (catalog symbols use the quote feed).
    if (!findInstrument(p.symbol) && p.current_price) {
      cacheBrokerPrice(db, p.symbol, decimalToCents(p.current_price),
        decimalToCents(p.lastday_price || p.current_price), now);
    }
  }
  db.prepare("UPDATE broker_links SET last_synced_at = ?, last_sync_error = NULL WHERE account_id = ? AND user_id = ?")
    .run(ts, accountId, userId);
}

/**
 * Links the configured Alpaca account to the signed-in user. User route only. The keys must be
 * configured for this user (ALPACA_USER_ID); otherwise the connection is "not found".
 */
export async function connectAlpaca(db: DB, userId: UserId): Promise<BrokerConnection> {
  const c = requireAlpaca();
  if (c.userId !== userId) throw notFound("Alpaca connection");
  if (c.env === "live" && !c.liveTradingAllowed) {
    throw new ServiceError("UNSUPPORTED",
      "ALPACA_ENV=live but live trading is turned off. Set ALPACA_ALLOW_LIVE_TRADING=true to connect a live account.",
      400);
  }

  let account: AlpacaAccount;
  let positions: AlpacaPosition[];
  let noShorting: boolean | null = null;
  try {
    [account, positions] = await Promise.all([getAccount(), listPositions()]);
    noShorting = (await getAccountConfig()).no_shorting;
  } catch (err) {
    throw brokerError(err, "Connecting to Alpaca");
  }

  const paperAccount = account.account_number.startsWith("PA");
  if (c.env === "paper" && !paperAccount) {
    throw badRequest("ALPACA_ENV=paper, but these keys belong to a live Alpaca account. Use paper trading keys.");
  }
  if (c.env === "live" && paperAccount) {
    throw badRequest("ALPACA_ENV=live, but these keys belong to an Alpaca paper account.");
  }
  if (account.account_blocked || account.trading_blocked || account.status !== "ACTIVE") {
    throw badRequest(`This Alpaca account cannot trade right now (status ${account.status}).`);
  }
  if (account.currency !== "USD") throw badRequest("Only USD Alpaca accounts are supported.");

  const now = new Date();
  const ts = now.toISOString();
  const accountId = accountIdFor(userId, c.env);
  const mask = account.account_number.slice(-4);
  db.transaction(() => {
    const existing = db.prepare("SELECT user_id FROM accounts WHERE id = ?").get(accountId) as
      { user_id: string } | undefined;
    if (existing && existing.user_id !== userId) throw notFound("Alpaca connection");
    db.prepare(
      `INSERT INTO accounts (id, user_id, institution, name, type, currency, mask, balance_cents, available_cents,
         capabilities, connection_id, external_id, is_paper, updated_at)
       VALUES (?, ?, 'Alpaca', ?, 'brokerage', 'USD', ?, 0, 0, '["view","trade"]', NULL, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET mask = excluded.mask, external_id = excluded.external_id,
         updated_at = excluded.updated_at`,
    ).run(accountId, userId, c.env === "paper" ? "Alpaca Paper Trading" : "Alpaca (LIVE)", mask, account.id,
      c.env === "paper" ? 1 : 0, ts);
    db.prepare(
      `INSERT INTO broker_links (account_id, user_id, broker, env, external_account_id, account_number_mask,
         connected_at, last_synced_at, last_sync_error)
       VALUES (?, ?, 'alpaca', ?, ?, ?, ?, NULL, NULL)
       ON CONFLICT (account_id) DO UPDATE SET external_account_id = excluded.external_account_id,
         account_number_mask = excluded.account_number_mask, last_sync_error = NULL`,
    ).run(accountId, userId, c.env, account.id, mask, ts);
    applyAccountSnapshot(db, userId, accountId, account, positions, now);
    writeAudit(db, { userId, actor: `user:${userId}`, eventType: "broker.connected",
      detail: { broker: "alpaca", env: c.env, accountId, accountNumberMask: mask, noShorting,
        positions: positions.length } });
  }).immediate();
  return getBrokerConnection(db, userId);
}

/**
 * Re-reads cash and positions from Alpaca into the user's linked account. No-op when the
 * user has no link for the configured environment. Records (and rethrows) failures.
 */
export async function syncBrokerAccount(db: DB, userId: UserId, opts: { force?: boolean } = {}): Promise<void> {
  if (!alpacaConfigured()) return;
  const c = alpacaConfig();
  if (c.userId !== userId) return;
  const link = linkForUser(db, userId, c.env);
  if (!link) return;
  if (!opts.force && link.last_synced_at && Date.now() - new Date(link.last_synced_at).getTime() < ACCOUNT_SYNC_MS) {
    return;
  }
  try {
    const [account, positions] = await Promise.all([getAccount(), listPositions()]);
    if (account.id !== link.external_account_id) {
      throw new ServiceError("UNSUPPORTED",
        "The configured Alpaca keys belong to a different account than the one you connected. Reconnect Alpaca.", 409);
    }
    db.transaction(() => applyAccountSnapshot(db, userId, link.account_id, account, positions, new Date())).immediate();
  } catch (err) {
    const e = brokerError(err, "Syncing your Alpaca account");
    try {
      db.prepare("UPDATE broker_links SET last_sync_error = ? WHERE account_id = ? AND user_id = ?")
        .run(e.message, link.account_id, userId);
    } catch (recordErr) {
      if (!isTransientLockError(recordErr)) throw recordErr;
    }
    throw e;
  }
}

export interface MarketRefreshReport {
  /** True when everything that was due refreshed (or nothing was due). */
  ok: boolean;
  errors: string[];
}

/**
 * Refreshes cached market data (quotes, clock, daily bars) and the user's Alpaca mirror before
 * synchronous services read them. A no-op in simulated mode. Never throws: read routes keep
 * serving the cache (stale quotes are already reported as unavailable).
 */
export async function refreshMarketData(
  db: DB,
  userId: UserId | null,
  opts: { force?: boolean } = {},
): Promise<MarketRefreshReport> {
  if (!alpacaConfigured()) return { ok: true, errors: [] };
  const results = await Promise.allSettled([
    refreshQuotes(db, { force: opts.force }),
    refreshClock(db),
    refreshBars(db),
    userId ? syncBrokerAccount(db, userId, { force: opts.force }) : Promise.resolve(),
  ]);
  const errors = results
    .filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => brokerError(r.reason, "Refreshing market data").message);
  if (errors.length) console.warn(`[clearfi] Alpaca refresh: ${errors.join(" | ")}`);
  return { ok: errors.length === 0, errors };
}

// --- Orders ----------------------------------------------------------------------------

function resultFor(db: DB, userId: UserId, orderId: string, duplicate: boolean): PlaceOrderResult {
  const order = getOrder(db, userId, orderId);
  return { order, fill: order.fill, duplicate, venue: order.venue };
}

/**
 * Applies Alpaca's view of an order to a SUBMITTING/SUBMITTED row (guarded on its state, so
 * concurrent syncs are idempotent). Returns true when the order reached a final state.
 */
function applyBrokerOrder(db: DB, userId: UserId, orderId: string, bo: AlpacaOrder, now: Date): boolean {
  return db.transaction((): boolean => {
    const row = loadOrderRow(db, userId, orderId);
    if (row.state !== "SUBMITTING" && row.state !== "SUBMITTED") return false;
    const ts = now.toISOString();
    const filledMicros = decimalToMicros(bo.filled_qty || "0", "floor");
    const done = TERMINAL.has(bo.status);

    if (bo.status === "filled" || (done && filledMicros > 0)) {
      if (!bo.filled_avg_price || filledMicros <= 0) return false; // wait for a complete report
      const grossCents = decimalProductCents(bo.filled_qty, bo.filled_avg_price, row.side === "buy" ? "ceil" : "floor");
      const executedAt = bo.filled_at ?? bo.updated_at ?? ts;
      const fill: OrderFill = {
        fillId: `fill_${bo.id}`,
        orderId,
        orderVersion: row.version,
        executedAt,
        accountId: row.account_id,
        symbol: row.symbol,
        side: row.side,
        quantityMicros: filledMicros,
        priceCents: decimalToCents(bo.filled_avg_price),
        grossCents,
        priceBoundCents: row.price_bound_cents!,
        cashAfterCents: null,
        positionQuantityAfterMicros: null,
        realizedPnlCents: null,
        approvedBy: row.approved_by!,
        executedBy: `user:${userId}`,
        quoteSource: "alpaca_iex",
        venue: row.venue,
        partial: bo.status !== "filled" || (row.broker_qty_micros !== null && filledMicros < row.broker_qty_micros),
        brokerOrderId: bo.id,
        paper: row.venue !== "alpaca_live",
        simulated: false,
      };
      const claimed = db.prepare(
        `UPDATE orders SET state = 'EXECUTED', executed_at = ?, fill = ?, filled_gross_cents = ?, broker_order_id = ?,
           broker_status = ?, broker_filled_qty_micros = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = ?`,
      ).run(executedAt, JSON.stringify(fill), grossCents, bo.id, bo.status, filledMicros, ts, orderId, userId, row.state);
      if (claimed.changes !== 1) return false;
      writeAudit(db, { userId, actor: "system", eventType: "order.executed", actionId: orderId,
        detail: { fillId: fill.fillId, version: row.version, symbol: row.symbol, side: row.side,
          quantityMicros: filledMicros, priceCents: fill.priceCents, grossCents, priceBoundCents: row.price_bound_cents,
          approvedBy: row.approved_by, venue: row.venue, brokerOrderId: bo.id, brokerStatus: bo.status,
          partial: fill.partial, paper: fill.paper, simulated: false } });
      return true;
    }

    if (bo.status === "canceled" || bo.status === "expired") {
      const updated = db.prepare(
        `UPDATE orders SET state = 'CANCELED', broker_order_id = ?, broker_status = ?, broker_filled_qty_micros = 0,
           failure_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = ?`,
      ).run(bo.id, bo.status, bo.status === "expired" ? "Expired at Alpaca without filling (day order)." : null, ts,
        orderId, userId, row.state);
      if (updated.changes !== 1) return false;
      writeAudit(db, { userId, actor: "system", eventType: "order.canceled", actionId: orderId,
        detail: { venue: row.venue, brokerOrderId: bo.id, brokerStatus: bo.status,
          requestedByUser: row.cancel_requested_at !== null } });
      return true;
    }

    if (bo.status === "rejected") {
      const updated = db.prepare(
        `UPDATE orders SET state = 'FAILED', broker_order_id = ?, broker_status = ?, failure_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = ?`,
      ).run(bo.id, bo.status, "Alpaca rejected the order.", ts, orderId, userId, row.state);
      if (updated.changes !== 1) return false;
      writeAudit(db, { userId, actor: "system", eventType: "order.broker_rejected", actionId: orderId,
        detail: { venue: row.venue, brokerOrderId: bo.id, brokerStatus: bo.status } });
      return true;
    }

    // Still working at Alpaca (new, accepted, partially_filled, pending_cancel, …).
    if (bo.status === "replaced") console.warn(`[clearfi] Alpaca order ${bo.id} was replaced outside Onera`);
    db.prepare(
      `UPDATE orders SET state = 'SUBMITTED', broker_order_id = ?, broker_status = ?, broker_filled_qty_micros = ?,
         updated_at = ?
       WHERE id = ? AND user_id = ? AND state = ?`,
    ).run(bo.id, bo.status, filledMicros, ts, orderId, userId, row.state);
    return false;
  }).immediate();
}

/** Final broker refusal of a SUBMITTING order (nothing was placed, or Alpaca refused it). */
function markSubmitFailed(db: DB, userId: UserId, orderId: string, reason: string, detail: object): void {
  db.transaction(() => {
    const updated = db.prepare(
      `UPDATE orders SET state = 'FAILED', failure_reason = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND state = 'SUBMITTING'`,
    ).run(reason, new Date().toISOString(), orderId, userId);
    if (updated.changes === 1) {
      writeAudit(db, { userId, actor: "system", eventType: "order.broker_rejected", actionId: orderId,
        detail: { reason, ...detail } });
    }
  }).immediate();
}

/**
 * Submits the signed-in user's APPROVED Alpaca order. User route only (via placeOrder). Repeats
 * return the current order instead of submitting again.
 */
export async function submitOrder(db: DB, userId: UserId, orderId: string): Promise<PlaceOrderResult> {
  const c = requireAlpaca();
  const actor = `user:${userId}`;
  const first = loadOrderRow(db, userId, orderId);
  if (first.venue === "onera_paper") {
    throw conflict("INVALID_STATE", "This is an Onera paper order; it executes in the paper broker.");
  }
  if (first.client_order_id !== null) return resultFor(db, userId, orderId, true);
  if (first.state !== "APPROVED") {
    throw conflict("INVALID_STATE", `Order is ${first.state}; only an APPROVED order can be submitted`,
      { state: first.state });
  }

  // Phase 0: fresh price and balances, and the asset's fractional support. Nothing changes on failure.
  let fractionable = true;
  try {
    await refreshQuotes(db, { force: true });
    await syncBrokerAccount(db, userId, { force: true });
    const asset = await getAsset(first.symbol);
    if (!asset.tradable) throw badRequest(`${first.symbol} is not tradable at Alpaca right now.`);
    fractionable = asset.fractionable;
  } catch (err) {
    const e = brokerError(err, "Preparing the order");
    if (e.status >= 500 || e.status === 429) {
      throw new ServiceError(e.code, `${e.message} The order is still approved and nothing was sent.`, e.status,
        { retryable: true });
    }
    throw e;
  }

  // Phase A: re-verify and claim APPROVED → SUBMITTING in one transaction.
  const now = new Date();
  type Claim =
    | { kind: "claimed"; row: OrderRow; quantityMicros: number; clientOrderId: string }
    | { kind: "duplicate" }
    | { kind: "rejected"; error: ServiceError };
  let claim: Claim;
  try {
    claim = db.transaction((): Claim => {
      const row = loadOrderRow(db, userId, orderId);
      if (row.client_order_id !== null) return { kind: "duplicate" };
      if (row.state !== "APPROVED") {
        writeAudit(db, { userId, actor, eventType: "order.execute_refused", actionId: orderId,
          detail: { reason: "NOT_APPROVED", state: row.state } });
        return { kind: "rejected", error: conflict("INVALID_STATE",
          `Order is ${row.state}; only an APPROVED order can be submitted`, { state: row.state }) };
      }
      const verified = verifyApprovedOrder(db, userId, row, now);
      if (!verified.ok) return { kind: "rejected", error: verified.error };

      const bound = row.price_bound_cents!;
      let quantityMicros = row.quantity_micros ?? mulDiv(row.notional_cents!, MICROS_PER_SHARE, bound, "floor");
      if (!fractionable) quantityMicros -= quantityMicros % MICROS_PER_SHARE;
      if (quantityMicros <= 0) {
        return { kind: "rejected", error: badRequest(fractionable
          ? "The order is too small to buy any shares."
          : `${row.symbol} can't be traded in fractions at Alpaca, and this amount buys less than one share. Edit the order.`) };
      }
      const clientOrderId = `${row.id}-v${row.version}`;
      const ts = now.toISOString();
      const claimed = db.prepare(
        `UPDATE orders SET state = 'SUBMITTING', client_order_id = ?, broker_qty_micros = ?,
           broker_filled_qty_micros = 0, reserved_cents = ?, submitted_at = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'APPROVED' AND version = ?`,
      ).run(clientOrderId, quantityMicros, verified.policy.estimatedValueCents, ts, ts, orderId, userId, row.version);
      if (claimed.changes !== 1) {
        return { kind: "rejected", error: conflict("INVALID_STATE", "The order changed while it was being submitted.") };
      }
      writeAudit(db, { userId, actor, eventType: "order.submitting", actionId: orderId,
        detail: { venue: row.venue, version: row.version, clientOrderId, quantityMicros, limitPriceCents: bound,
          reservedCents: verified.policy.estimatedValueCents } });
      return { kind: "claimed", row, quantityMicros, clientOrderId };
    }).immediate();
  } catch (err) {
    if (isTransientLockError(err)) {
      throw new ServiceError("INTERNAL", "Onera is busy. Nothing was sent; try again.", 503, { retryable: true });
    }
    throw err;
  }
  if (claim.kind === "duplicate") return resultFor(db, userId, orderId, true);
  if (claim.kind === "rejected") throw claim.error;

  // Phase B: send it. Outside any transaction.
  const { row, quantityMicros, clientOrderId } = claim;
  let brokerOrder: AlpacaOrder | null = null;
  try {
    brokerOrder = await postOrder({
      symbol: row.symbol,
      qty: microsToDecimal(quantityMicros),
      side: row.side,
      type: "limit",
      time_in_force: "day",
      limit_price: centsToDecimal(row.price_bound_cents!),
      client_order_id: clientOrderId,
      extended_hours: false,
    });
  } catch (err) {
    if (!(err instanceof AlpacaError)) throw err;
    if (err.kind === "forbidden" || err.kind === "unprocessable") {
      markSubmitFailed(db, userId, orderId, `Alpaca rejected the order: ${err.brokerMessage}`,
        { status: err.status, venue: row.venue });
      return resultFor(db, userId, orderId, false);
    }
    if (err.kind === "auth" || err.kind === "rate_limited") {
      // Definitely not placed: return the order to APPROVED (same version, same approval).
      db.prepare(
        `UPDATE orders SET state = 'APPROVED', client_order_id = NULL, broker_qty_micros = NULL,
           broker_filled_qty_micros = NULL, reserved_cents = NULL, submitted_at = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'SUBMITTING'`,
      ).run(new Date().toISOString(), orderId, userId);
      throw brokerError(err, "Submitting the order");
    }
    // Ambiguous (timeout, network, 5xx): the order may exist. Look it up; never re-post blindly.
    try {
      brokerOrder = await getOrderByClientId(clientOrderId);
    } catch {
      brokerOrder = null;
    }
    if (!brokerOrder) return resultFor(db, userId, orderId, false); // stays SUBMITTING; syncOrders reconciles
  }
  const final = applyBrokerOrder(db, userId, orderId, brokerOrder, new Date());
  if (final) await syncBrokerAccount(db, userId, { force: true }).catch(() => undefined);
  return resultFor(db, userId, orderId, false);
}

/**
 * Places the signed-in user's APPROVED order wherever its account trades: Onera's paper broker
 * (fills immediately) or Alpaca (submitted; fills are reported by syncOrders).
 */
export async function placeOrder(db: DB, userId: UserId, orderId: string): Promise<PlaceOrderResult> {
  const row = loadOrderRow(db, userId, orderId);
  if (row.venue === "onera_paper") {
    const r = executeOrder(db, userId, orderId);
    return { order: r.order, fill: r.fill, duplicate: r.duplicate, venue: "onera_paper" };
  }
  return submitOrder(db, userId, orderId);
}

/**
 * Pulls Alpaca's status for open orders (all users when `userId` is omitted — background
 * poller) and applies fills, cancellations and rejections. Only orders for the configured
 * environment and key owner are touched. Returns how many orders reached a final state.
 */
export async function syncOrders(db: DB, userId?: UserId): Promise<number> {
  if (!alpacaConfigured()) return 0;
  const c = alpacaConfig();
  if (userId !== undefined && userId !== c.userId) return 0;
  const owner = c.userId as UserId;
  const rows = db.prepare(
    `SELECT * FROM orders WHERE user_id = ? AND venue = ? AND state IN ('SUBMITTING','SUBMITTED')
     ORDER BY submitted_at LIMIT 50`,
  ).all(owner, venueOf({ env: c.env })) as OrderRow[];
  let finals = 0;
  for (const row of rows) {
    try {
      let bo: AlpacaOrder | null;
      if (row.broker_order_id) {
        bo = await getBrokerOrder(row.broker_order_id);
      } else {
        bo = await getOrderByClientId(row.client_order_id!);
        if (!bo) {
          const age = Date.now() - new Date(row.submitted_at ?? row.updated_at).getTime();
          if (age > SUBMIT_CONFIRM_MS) {
            markSubmitFailed(db, owner, row.id,
              "Alpaca never received this order (submission could not be confirmed). Nothing was traded.",
              { clientOrderId: row.client_order_id });
            finals++;
          }
          continue;
        }
      }
      if (applyBrokerOrder(db, owner, row.id, bo, new Date())) finals++;
    } catch (err) {
      console.warn(`[clearfi] Alpaca sync for ${row.id} failed:`, err instanceof Error ? err.message : err);
    }
  }
  if (finals > 0) await syncBrokerAccount(db, owner, { force: true }).catch(() => undefined);
  return finals;
}

/**
 * Asks Alpaca to cancel the signed-in user's open order. User route only. Alpaca confirms
 * asynchronously: the order becomes CANCELED (or EXECUTED, if it filled first) once a sync sees it.
 */
export async function cancelOrder(db: DB, userId: UserId, orderId: string): Promise<PaperOrder> {
  requireAlpaca();
  const row = loadOrderRow(db, userId, orderId);
  if (row.venue === "onera_paper") {
    throw conflict("INVALID_STATE", "Onera paper orders fill immediately; there is nothing to cancel.");
  }
  if (row.state === "SUBMITTING" || (row.state === "SUBMITTED" && !row.broker_order_id)) {
    throw conflict("INVALID_STATE", "The order is still being submitted to Alpaca. Try again in a moment.");
  }
  if (row.state !== "SUBMITTED") {
    throw conflict("INVALID_STATE", `Order is ${row.state}; only an open Alpaca order can be canceled`,
      { state: row.state });
  }
  let refused: string | null = null;
  try {
    await cancelBrokerOrder(row.broker_order_id!);
  } catch (err) {
    if (err instanceof AlpacaError && (err.kind === "unprocessable" || err.kind === "not_found")) {
      refused = err.brokerMessage;
    } else {
      throw brokerError(err, "Canceling the order");
    }
  }
  const ts = new Date().toISOString();
  db.transaction(() => {
    if (!refused) {
      db.prepare(`UPDATE orders SET cancel_requested_at = ?, updated_at = ? WHERE id = ? AND user_id = ? AND state = 'SUBMITTED'`)
        .run(ts, ts, orderId, userId);
    }
    writeAudit(db, { userId, actor: `user:${userId}`, eventType: refused ? "order.cancel_refused" : "order.cancel_requested",
      actionId: orderId, detail: { venue: row.venue, brokerOrderId: row.broker_order_id, ...(refused ? { refused } : {}) } });
  }).immediate();
  try {
    const bo = await getBrokerOrder(row.broker_order_id!);
    if (applyBrokerOrder(db, userId, orderId, bo, new Date())) {
      await syncBrokerAccount(db, userId, { force: true }).catch(() => undefined);
    }
  } catch {
    /* the background sync will pick it up */
  }
  if (refused) {
    const order = getOrder(db, userId, orderId);
    if (order.state === "SUBMITTED") {
      throw conflict("INVALID_STATE", `Alpaca could not cancel this order: ${refused}`, { state: order.state });
    }
    return order;
  }
  return getOrder(db, userId, orderId);
}

// --- Background poller --------------------------------------------------------------

/**
 * Polls Alpaca for open orders every `intervalMs` (default 10s) while any exist, and refreshes
 * cached market data and the key owner's account about once a minute so background agents
 * value portfolios at current prices. Started with the other in-process background services;
 * a no-op without keys.
 */
export function startBrokerOrderSync(
  db: DB,
  opts: { intervalMs?: number; log?: (line: string) => void } = {},
): { stop(): void } {
  const intervalMs = opts.intervalMs ?? 10_000;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRefresh = 0;
  const tick = async () => {
    if (stopped) return;
    try {
      if (alpacaConfigured()) {
        if (Date.now() - lastRefresh >= 60_000) {
          lastRefresh = Date.now();
          await refreshMarketData(db, alpacaConfig().userId as UserId);
        }
        const { open } = db.prepare(
          `SELECT COUNT(*) AS open FROM orders WHERE state IN (${OPEN_STATES.map(() => "?").join(",")})`,
        ).get(...OPEN_STATES) as { open: number };
        if (open > 0) {
          const finals = await syncOrders(db);
          if (finals > 0) opts.log?.(`[background] Alpaca sync: ${finals} order(s) settled`);
        }
      }
    } catch (err) {
      console.warn("[background] Alpaca order sync failed:", err instanceof Error ? err.message : err);
    }
    if (!stopped) timer = setTimeout(tick, intervalMs);
  };
  timer = setTimeout(tick, intervalMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
