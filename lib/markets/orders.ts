/**
 * Order lifecycle — the same governance as transfers:
 *   PROPOSED → HELD | AWAITING_APPROVAL → APPROVED → EXECUTED   (FAILED on broker error)
 * Orders in an Alpaca-linked account go APPROVED → SUBMITTING → SUBMITTED →
 * EXECUTED | CANCELED | FAILED instead (brokerage.ts).
 *
 * Approval is either the user approving the exact version (user route only)
 * or, for an agent's order that carries a mandate, automatic authorization at
 * creation when the mandate is valid and covers the order. Every function
 * takes the session user ID from the server.
 *
 * Writes read the real clock (`new Date()`); callers cannot pass a time, so a
 * stale timestamp can never price, approve or authorize an order. Tests move
 * time with Vitest fake timers. Every load-then-write runs in one IMMEDIATE
 * transaction and every UPDATE is guarded by the expected state (and version),
 * so a concurrent change is a 409 INVALID_STATE, never a lost update or a 500.
 */
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import { getControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { ApproveSchema, type Account, type UserId } from "@/lib/types";
import { orderApprovalHash, type ApprovableOrder } from "./approval";
import { findInstrument } from "./instruments";
import { quoteFor, quoteSource } from "./marketdata";
import { priceBoundFor } from "./math";
import { evaluateOrderPolicy, type MandateTerms, type OrderTerms } from "./policy";
import { toOrder, venueOf, type OrderRow } from "./rows";
import { AGENT_ID_PATTERN, CreateOrderSchema, EditOrderSchema } from "./schemas";
import {
  assertTradable,
  brokerLinkFor,
  brokerTermsFor,
  heldQuantityMicros,
  loadMandateRow,
  loadOwnedAccount,
  mandateUsedTodayCents,
  ordersExecutedTodayCents,
  readTradingControls,
} from "./store";
import type { OrderCreator, OrderPolicyResult, OrderState, PaperOrder, Quote } from "./types";

const EVALUABLE: OrderState[] = ["PROPOSED", "HELD", "AWAITING_APPROVAL"];
const EDITABLE: OrderState[] = ["PROPOSED", "HELD", "AWAITING_APPROVAL", "APPROVED"];

/** 409 for an order whose state (or version) changed under us. */
export function stateConflict(message = "The order changed while it was being updated. Reload it and try again.") {
  return conflict("INVALID_STATE", message);
}

export function orderActor(createdBy: OrderCreator, userId: UserId): string {
  return createdBy === "user" ? `user:${userId}` : createdBy;
}

function assertCreator(createdBy: OrderCreator): void {
  if (createdBy === "user" || createdBy === "assistant") return;
  const agentId = createdBy.startsWith("agent:") ? createdBy.slice("agent:".length) : "";
  if (!AGENT_ID_PATTERN.test(agentId)) throw badRequest("Invalid order creator");
}

// --- Reads ------------------------------------------------------------------

export function loadOrderRow(db: DB, userId: UserId, orderId: string): OrderRow {
  const row = db.prepare("SELECT * FROM orders WHERE id = ? AND user_id = ?").get(orderId, userId);
  if (!row) throw notFound("Order");
  return row as OrderRow;
}

export function getOrder(db: DB, userId: UserId, orderId: string): PaperOrder {
  return toOrder(loadOrderRow(db, userId, orderId));
}

export function listOrders(
  db: DB,
  userId: UserId,
  opts: { state?: string; limit?: number } = {},
): PaperOrder[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = opts.state
    ? db.prepare("SELECT * FROM orders WHERE user_id = ? AND state = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(userId, opts.state, limit)
    : db.prepare("SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(userId, limit);
  return (rows as OrderRow[]).map(toOrder);
}

// --- Policy plumbing --------------------------------------------------------

export function approvableOrder(row: OrderRow): ApprovableOrder {
  return {
    id: row.id,
    userId: row.user_id,
    version: row.version,
    accountId: row.account_id,
    symbol: row.symbol,
    side: row.side,
    quantityMicros: row.quantity_micros,
    notionalCents: row.notional_cents,
    priceBoundCents: row.price_bound_cents,
    mandateId: row.mandate_id,
    venue: row.venue,
  };
}

function termsOf(row: OrderRow, priceBoundCents: number | null): OrderTerms {
  return {
    accountId: row.account_id,
    symbol: row.symbol,
    side: row.side,
    quantityMicros: row.quantity_micros,
    notionalCents: row.notional_cents,
    priceBoundCents,
    createdBy: row.created_by,
    mandateId: row.mandate_id,
  };
}

function policyFor(db: DB, userId: UserId, terms: OrderTerms, quote: Quote | null, now: Date) {
  const account = loadOwnedAccount(db, userId, terms.accountId);
  const mandateRow = terms.mandateId ? loadMandateRow(db, userId, terms.mandateId) : null;
  const mandate: MandateTerms | null = mandateRow && {
    id: mandateRow.id,
    agentId: mandateRow.agent_id,
    accountId: mandateRow.account_id,
    symbols: JSON.parse(mandateRow.symbols) as string[],
    side: mandateRow.side,
    maxOrderCents: mandateRow.max_order_cents,
    maxDailyCents: mandateRow.max_daily_cents,
    expiresAt: mandateRow.expires_at,
    revokedAt: mandateRow.revoked_at,
  };
  const policy = evaluateOrderPolicy({
    order: terms,
    account,
    instrument: findInstrument(terms.symbol),
    quote,
    heldQuantityMicros: heldQuantityMicros(db, userId, terms.accountId, terms.symbol),
    paused: getControls(db, userId).paused,
    tradingControls: readTradingControls(db, userId),
    executedTodayCents: ordersExecutedTodayCents(db, userId, now),
    mandate,
    mandateUsedTodayCents: terms.mandateId ? mandateUsedTodayCents(db, userId, terms.mandateId, now) : 0,
    now,
    broker: brokerTermsFor(db, userId, terms.accountId),
    quoteSource: quoteSource(),
  });
  return { policy, account };
}

/** Current policy for the stored version: its captured price bound against the current quote. */
export function runOrderPolicy(db: DB, userId: UserId, row: OrderRow, now: Date): {
  policy: OrderPolicyResult;
  account: Account;
  quote: Quote | null;
} {
  const quote = quoteFor(db, row.symbol, now);
  return { ...policyFor(db, userId, termsOf(row, row.price_bound_cents), quote, now), quote };
}

/**
 * Re-prices at the current quote, evaluates and stores the outcome.
 * Must run inside a transaction. Always clears any approval. When `bumpOnReprice`
 * is set and the price bound changes, the order gets a new version (the bound is
 * part of what the user approves). The UPDATE only applies if the order is still
 * in `row.state` at `row.version`; otherwise it throws 409 INVALID_STATE (and the
 * caller's transaction rolls back).
 */
export function applyOrderEvaluation(
  db: DB,
  userId: UserId,
  row: OrderRow,
  actor: string,
  now: Date,
  opts: { bumpOnReprice: boolean },
): OrderPolicyResult {
  const quote = quoteFor(db, row.symbol, now);
  const bound = quote ? priceBoundFor(row.side, quote.priceCents) : null;
  const repriced = opts.bumpOnReprice && row.price_bound_cents !== null && bound !== row.price_bound_cents;
  const version = repriced ? row.version + 1 : row.version;
  const { policy } = policyFor(db, userId, termsOf(row, bound), quote, now);
  const state: OrderState = policy.decision === "ALLOW" ? "AWAITING_APPROVAL" : "HELD";

  const updated = db.prepare(
    `UPDATE orders SET state = ?, version = ?, hold_reasons = ?, policy = ?, quote_price_cents = ?,
       price_bound_cents = ?, approval_hash = NULL, approved_version = NULL, approved_at = NULL,
       approved_by = NULL, updated_at = ?
     WHERE id = ? AND user_id = ? AND state = ? AND version = ?`,
  ).run(state, version, JSON.stringify(policy.reasons), JSON.stringify(policy), quote?.priceCents ?? null,
    bound, now.toISOString(), row.id, userId, row.state, row.version);
  if (updated.changes !== 1) throw stateConflict();

  if (repriced) {
    writeAudit(db, { userId, actor: "system", eventType: "order.repriced", actionId: row.id,
      detail: { fromVersion: row.version, toVersion: version, fromPriceBoundCents: row.price_bound_cents,
        toPriceBoundCents: bound, quotePriceCents: quote?.priceCents ?? null,
        quoteSource: quote?.source ?? quoteSource(), simulated: quote?.source === "simulated" } });
  }
  writeAudit(db, {
    userId, actor, eventType: state === "HELD" ? "order.held" : "order.awaiting_approval", actionId: row.id,
    detail: { version, decision: policy.decision, reasons: policy.reasons, priceBoundCents: bound,
      quotePriceCents: quote?.priceCents ?? null },
  });
  return policy;
}

/** Mandate authorization for an agent's order. Policy (incl. the mandate check) must have just passed. */
function authorizeByMandate(db: DB, userId: UserId, row: OrderRow, now: Date): void {
  const hash = orderApprovalHash(approvableOrder(row));
  const approvedBy = `mandate:${row.mandate_id}`;
  const ts = now.toISOString();
  const claimed = db.prepare(
    `UPDATE orders SET state = 'APPROVED', approval_hash = ?, approved_version = ?, approved_at = ?,
       approved_by = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND state = 'AWAITING_APPROVAL' AND version = ? AND mandate_id IS NOT NULL`,
  ).run(hash, row.version, ts, approvedBy, ts, row.id, userId, row.version);
  if (claimed.changes !== 1) throw stateConflict("The order changed during mandate authorization");
  writeAudit(db, { userId, actor: "system", eventType: "order.mandate_authorized", actionId: row.id,
    detail: { version: row.version, mandateId: row.mandate_id, proposedBy: row.created_by, approvedBy,
      approvalHashPrefix: hash.slice(0, 12), paper: true } });
}

// --- Writes -----------------------------------------------------------------

/**
 * Creates and evaluates an order. Internal (not exported from index.ts): only
 * the mandate helper passes a mandate, and authorization happens here, at the
 * real current time.
 */
export function createOrderInternal(
  db: DB,
  userId: UserId,
  input: unknown,
  createdBy: OrderCreator,
  mandateId: string | null,
): PaperOrder {
  const now = new Date();
  assertCreator(createdBy);
  if (mandateId !== null && !createdBy.startsWith("agent:")) throw badRequest("Only agent orders can carry a mandate");
  const data = CreateOrderSchema.parse(input);
  assertTradable(loadOwnedAccount(db, userId, data.accountId), brokerTermsFor(db, userId, data.accountId));
  const venue = venueOf(brokerLinkFor(db, userId, data.accountId));
  if (mandateId !== null && venue !== "onera_paper") throw badRequest("Mandates only cover Onera paper accounts");
  if (venue === "alpaca_live" && createdBy !== "user") {
    throw badRequest("Live (real-money) orders can only be created by you in the app.");
  }

  const id = `ord_${randomBytes(5).toString("hex")}`;
  const ts = now.toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, user_id, state, venue, version, account_id, symbol, side, quantity_micros, notional_cents,
         created_by, mandate_id, created_at, updated_at)
       VALUES (?, ?, 'PROPOSED', ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, venue, data.accountId, data.symbol, data.side, data.quantityMicros ?? null,
      data.notionalCents ?? null, createdBy, mandateId, ts, ts);
    writeAudit(db, {
      userId, actor: orderActor(createdBy, userId), eventType: "order.proposed", actionId: id,
      detail: { accountId: data.accountId, symbol: data.symbol, side: data.side,
        quantityMicros: data.quantityMicros ?? null, notionalCents: data.notionalCents ?? null, mandateId,
        venue, paper: venue !== "alpaca_live" },
    });
    const policy = applyOrderEvaluation(db, userId, loadOrderRow(db, userId, id), "system", now, { bumpOnReprice: false });
    if (mandateId !== null && policy.decision === "ALLOW") {
      authorizeByMandate(db, userId, loadOrderRow(db, userId, id), now);
    }
  }).immediate();
  return getOrder(db, userId, id);
}

/**
 * Proposes a paper order. Never auto-approves: user, assistant and agent
 * orders without a mandate wait for the user's exact-version approval.
 */
export function createOrder(db: DB, userId: UserId, input: unknown, createdBy: OrderCreator): PaperOrder {
  return createOrderInternal(db, userId, input, createdBy, null);
}

/** Material edit by the user: bumps the version, drops approval and any mandate, re-prices and re-evaluates. */
export function editOrder(db: DB, userId: UserId, orderId: string, input: unknown): PaperOrder {
  const patch = EditOrderSchema.parse(input);
  const now = new Date();
  db.transaction(() => {
    const row = loadOrderRow(db, userId, orderId);
    if (!EDITABLE.includes(row.state)) throw stateConflict(`Order is ${row.state} and cannot be edited`);

    const accountId = patch.accountId ?? row.account_id;
    assertTradable(loadOwnedAccount(db, userId, accountId), brokerTermsFor(db, userId, accountId));
    const venue = venueOf(brokerLinkFor(db, userId, accountId));
    const side = patch.side ?? row.side;
    let quantityMicros = row.quantity_micros;
    let notionalCents = row.notional_cents;
    if (patch.quantityMicros !== undefined) { quantityMicros = patch.quantityMicros; notionalCents = null; }
    if (patch.notionalCents !== undefined) { notionalCents = patch.notionalCents; quantityMicros = null; }
    if (side === "sell" && quantityMicros === null) throw badRequest("Sell orders are sized by quantityMicros");

    const edited = db.prepare(
      `UPDATE orders SET state = 'PROPOSED', version = version + 1, venue = ?, account_id = ?, symbol = ?, side = ?,
         quantity_micros = ?, notional_cents = ?, quote_price_cents = NULL, price_bound_cents = NULL,
         mandate_id = NULL, approval_hash = NULL, approved_version = NULL, approved_at = NULL, approved_by = NULL,
         updated_at = ?
       WHERE id = ? AND user_id = ? AND version = ? AND state IN (${EDITABLE.map(() => "?").join(", ")})`,
    ).run(venue, accountId, patch.symbol ?? row.symbol, side, quantityMicros, notionalCents, now.toISOString(), orderId, userId,
      row.version, ...EDITABLE);
    if (edited.changes !== 1) throw stateConflict();
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: "order.edited", actionId: orderId,
      detail: { fromVersion: row.version, toVersion: row.version + 1, changes: patch,
        approvalInvalidated: row.approval_hash !== null, mandateDetached: row.mandate_id },
    });
    applyOrderEvaluation(db, userId, loadOrderRow(db, userId, orderId), "system", now, { bumpOnReprice: false });
  }).immediate();
  return getOrder(db, userId, orderId);
}

/** Re-prices and re-runs policy (e.g. after resolving a hold). A new price bound means a new version. */
export function evaluateOrder(db: DB, userId: UserId, orderId: string): PaperOrder {
  const now = new Date();
  db.transaction(() => {
    const row = loadOrderRow(db, userId, orderId);
    if (!EVALUABLE.includes(row.state)) {
      throw stateConflict(`Order is ${row.state}; only proposed, held or awaiting orders are re-evaluated`);
    }
    // Guarded on row.state/row.version, so a concurrent approve or execute is a 409.
    applyOrderEvaluation(db, userId, row, `user:${userId}`, now, { bumpOnReprice: true });
  }).immediate();
  return getOrder(db, userId, orderId);
}

/**
 * Exact-version approval by the signed-in user. Only reachable from the user
 * route — no assistant or agent tool. Policy is rechecked at approval time.
 */
export function approveOrder(db: DB, userId: UserId, orderId: string, input: unknown): PaperOrder {
  const { version } = ApproveSchema.parse(input);
  const now = new Date();
  const outcome = db.transaction(() => {
    const row = loadOrderRow(db, userId, orderId);
    if (row.state !== "AWAITING_APPROVAL") {
      return { error: conflict("INVALID_STATE", `Order is ${row.state}; only AWAITING_APPROVAL can be approved`) };
    }
    if (row.version !== version) {
      return { error: conflict("STALE_VERSION",
        `You reviewed v${version} but the order is now v${row.version}. Review it again.`) };
    }
    const { policy } = runOrderPolicy(db, userId, row, now);
    if (policy.decision === "HOLD") {
      applyOrderEvaluation(db, userId, row, "system", now, { bumpOnReprice: true });
      return { error: conflict("POLICY_HOLD", "Policy checks no longer pass; the order was re-evaluated",
        { reasons: policy.reasons }) };
    }
    const hash = orderApprovalHash(approvableOrder(row));
    const ts = now.toISOString();
    const approved = db.prepare(
      `UPDATE orders SET state = 'APPROVED', approval_hash = ?, approved_version = ?, approved_at = ?,
         approved_by = ?, policy = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND state = 'AWAITING_APPROVAL' AND version = ?`,
    ).run(hash, row.version, ts, `user:${userId}`, JSON.stringify(policy), ts, orderId, userId, version);
    if (approved.changes !== 1) throw stateConflict();
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: "order.approved", actionId: orderId,
      detail: { version: row.version, priceBoundCents: row.price_bound_cents, approvalHashPrefix: hash.slice(0, 12) },
    });
    return { error: null };
  }).immediate();
  if (outcome.error) throw outcome.error;
  return getOrder(db, userId, orderId);
}
