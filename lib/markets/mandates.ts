/**
 * Mandates: bounded, expiring, revocable authority for one background agent to
 * place paper BUY orders. Created and revoked only by the signed-in user
 * (user routes). Agents can never create, widen or revoke a mandate.
 *
 * proposeMandateOrder is the only way an agent order can execute without the
 * user approving it, and it goes through the same propose → policy →
 * authorize → execute functions as every other order.
 *
 * Writes (create, revoke, propose) read the real clock; callers cannot pass a
 * time, so expiry and daily budgets are always judged at the current moment.
 * Reads (list, get) still accept `now` for display.
 */
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { badRequest, notFound, ServiceError } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import { executeMandateOrder } from "./broker";
import { findInstrument } from "./instruments";
import { createOrderInternal, getOrder } from "./orders";
import { toMandate, type MandateRow } from "./rows";
import { AGENT_ID_PATTERN, CreateMandateSchema, MandateOrderSchema } from "./schemas";
import { assertTradable, loadMandateRow, loadOwnedAccount, mandateUsedTodayCents } from "./store";
import type { Mandate, MandateOrderResult } from "./types";
import { msg } from "@/lib/i18n/msg";

export const MAX_MANDATE_DAYS = 90;
const DAY_MS = 86_400_000;

function present(db: DB, userId: UserId, row: MandateRow, now: Date): Mandate {
  return toMandate(row, mandateUsedTodayCents(db, userId, row.id, now), now);
}

export function listMandates(db: DB, userId: UserId, now: Date = new Date()): Mandate[] {
  const rows = db
    .prepare("SELECT * FROM mandates WHERE user_id = ? ORDER BY created_at DESC, rowid DESC")
    .all(userId) as MandateRow[];
  return rows.map((r) => present(db, userId, r, now));
}

export function getMandate(db: DB, userId: UserId, mandateId: string, now: Date = new Date()): Mandate {
  const row = loadMandateRow(db, userId, mandateId);
  if (!row) throw notFound("Mandate");
  return present(db, userId, row, now);
}

/** User route only. Paper accounts only; buy side only; must expire within 90 days. */
export function createMandate(db: DB, userId: UserId, input: unknown): Mandate {
  const data = CreateMandateSchema.parse(input);
  const now = new Date();
  assertTradable(loadOwnedAccount(db, userId, data.accountId));

  const symbols = [...new Set(data.symbols)];
  const unknown = symbols.filter((s) => !findInstrument(s));
  if (unknown.length > 0) throw badRequest(`Unsupported symbols: ${unknown.join(", ")}`);

  const expires = new Date(data.expiresAt);
  if (expires.getTime() <= now.getTime()) throw badRequest(msg("expiresAt must be in the future"));
  if (expires.getTime() > now.getTime() + MAX_MANDATE_DAYS * DAY_MS) {
    throw badRequest(`Mandates expire within ${MAX_MANDATE_DAYS} days`);
  }

  const id = `mdt_${randomBytes(5).toString("hex")}`;
  const ts = now.toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT INTO mandates (id, user_id, agent_id, account_id, symbols, side, max_order_cents, max_daily_cents,
         expires_at, revoked_at, created_at)
       VALUES (?, ?, ?, ?, ?, 'buy', ?, ?, ?, NULL, ?)`,
    ).run(id, userId, data.agentId, data.accountId, JSON.stringify(symbols), data.maxOrderCents, data.maxDailyCents,
      expires.toISOString(), ts);
    writeAudit(db, { userId, actor: `user:${userId}`, eventType: "mandate.created",
      detail: { mandateId: id, agentId: data.agentId, accountId: data.accountId, symbols, side: "buy",
        maxOrderCents: data.maxOrderCents, maxDailyCents: data.maxDailyCents, expiresAt: expires.toISOString(),
        paper: true } });
  })();
  return getMandate(db, userId, id, now);
}

/** User route only. Idempotent: revoking a revoked mandate changes nothing. */
export function revokeMandate(db: DB, userId: UserId, mandateId: string): Mandate {
  const now = new Date();
  db.transaction(() => {
    const row = loadMandateRow(db, userId, mandateId);
    if (!row) throw notFound("Mandate");
    if (row.revoked_at !== null) return;
    const revoked = db.prepare("UPDATE mandates SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
      .run(now.toISOString(), mandateId, userId);
    if (revoked.changes !== 1) return;
    writeAudit(db, { userId, actor: `user:${userId}`, eventType: "mandate.revoked",
      detail: { mandateId, agentId: row.agent_id } });
  }).immediate();
  return getMandate(db, userId, mandateId, now);
}

/**
 * Governed helper for the agents module: an agent proposes a paper BUY of
 * `notionalCents` of `symbol` under a mandate. The order is created as
 * `agent:<agentId>` and evaluated by the same policy as every order, including
 * the mandate check (active, unexpired, unrevoked, same agent and user, covers
 * the symbol/side, fits the per-order cap and remaining daily budget). Only
 * then is it authorized as `mandate:<id>` and executed by the paper broker.
 * Otherwise the order stays HELD (e.g. MANDATE_INVALID) for the user to review.
 *
 * Authorization and execution both use the real clock; there is no time
 * parameter. Execution goes through the internal executeMandateOrder, which
 * refuses anything but this agent's own mandate-authorized order.
 *
 * Product note (unchanged here): `agentId` is validated for format only, not
 * against the agents registry; a mismatched agent is HELD with MANDATE_INVALID.
 */
export function proposeMandateOrder(
  db: DB,
  userId: UserId,
  mandateId: string,
  agentId: string,
  input: unknown,
): MandateOrderResult {
  if (!AGENT_ID_PATTERN.test(agentId)) throw badRequest(msg("Invalid agentId"));
  const data = MandateOrderSchema.parse(input);
  const mandate = loadMandateRow(db, userId, mandateId);
  if (!mandate) throw notFound("Mandate");

  const order = createOrderInternal(
    db, userId,
    { accountId: mandate.account_id, symbol: data.symbol, side: "buy", notionalCents: data.notionalCents },
    `agent:${agentId}`, mandate.id,
  );
  if (order.state !== "APPROVED") return { order, fill: null, executed: false, refusal: null };

  try {
    const result = executeMandateOrder(db, userId, order.id, mandate.id, agentId);
    return { order: result.order, fill: result.fill, executed: true, refusal: null };
  } catch (err) {
    if (err instanceof ServiceError && err.status === 409) {
      return { order: getOrder(db, userId, order.id), fill: null, executed: false,
        refusal: { code: err.code, message: err.message } };
    }
    throw err;
  }
}
