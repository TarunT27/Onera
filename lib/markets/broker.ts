/**
 * Paper broker — the only code that fills orders and moves paper cash/shares.
 *
 * One IMMEDIATE SQLite transaction verifies owner, state and the approval hash,
 * reruns policy (pause, limits, cash/shares, mandate), checks the current
 * simulated price against the approved bound, then claims the order
 * (APPROVED → EXECUTED), moves paper cash, updates the position and writes the
 * fill and audit event. Either everything commits or nothing does. A repeated
 * request returns the original fill instead of filling again.
 *
 * Two entry points share one implementation:
 *  - executeOrder (public, user route): always runs as `user:<userId>`.
 *  - executeMandateOrder (internal, NOT exported from index.ts): called only by
 *    proposeMandateOrder; runs as `agent:<agentId>` and only for that agent's
 *    own order authorized as `mandate:<mandateId>`.
 * Neither accepts a time: execution prices and checks limits/expiry at the real
 * clock, read once per attempt and reused for the FAILED record.
 */
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { conflict, ServiceError } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import { orderApprovalHash } from "./approval";
import { MICROS_PER_SHARE, mulDiv, valueCents } from "./math";
import { applyOrderEvaluation, approvableOrder, getOrder, loadOrderRow, runOrderPolicy } from "./orders";
import type { PositionRow } from "./rows";
import type { ExecuteOrderResult, OrderFill } from "./types";
import { msg } from "@/lib/i18n/msg";

type Outcome =
  | { kind: "executed" }
  | { kind: "duplicate" }
  | { kind: "rejected"; error: ServiceError };

type Executor =
  | { kind: "user" }
  | { kind: "mandate"; mandateId: string; agentId: string };

/** SQLITE_BUSY / SQLITE_LOCKED (and extended codes): another writer holds the lock. Transient. */
function isTransientLockError(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && (code.startsWith("SQLITE_BUSY") || code.startsWith("SQLITE_LOCKED"));
}

// TODO(wire): ApiErrorCode has no retryable code yet (lib/types.ts); "INTERNAL" + 503 + details.retryable for now.
const brokerBusy = () => new ServiceError("INTERNAL",
  msg("The paper broker is busy. Nothing was executed and the order is unchanged; try again."), 503, { retryable: true });

/** User route: executes the signed-in user's APPROVED order as `user:<userId>`. */
export function executeOrder(db: DB, userId: UserId, orderId: string): ExecuteOrderResult {
  return runExecution(db, userId, orderId, { kind: "user" });
}

/**
 * Internal — only proposeMandateOrder calls this, and index.ts must not export
 * it. Executes as `agent:<agentId>` only an order that agent proposed under
 * `mandateId` and that was authorized as `mandate:<mandateId>`. A user-approved
 * order (or another agent's) is refused with 409 INVALID_STATE.
 */
export function executeMandateOrder(
  db: DB,
  userId: UserId,
  orderId: string,
  mandateId: string,
  agentId: string,
): ExecuteOrderResult {
  return runExecution(db, userId, orderId, { kind: "mandate", mandateId, agentId });
}

function runExecution(db: DB, userId: UserId, orderId: string, executor: Executor): ExecuteOrderResult {
  const now = new Date();
  const actor = executor.kind === "user" ? `user:${userId}` : `agent:${executor.agentId}`;
  let outcome: Outcome;
  try {
    outcome = db.transaction((): Outcome => {
      const row = loadOrderRow(db, userId, orderId);

      if (row.state === "EXECUTED") {
        writeAudit(db, { userId, actor, eventType: "order.execute_duplicate", actionId: orderId });
        return { kind: "duplicate" };
      }
      if (row.state !== "APPROVED") {
        writeAudit(db, { userId, actor, eventType: "order.execute_refused", actionId: orderId,
          detail: { reason: "NOT_APPROVED", state: row.state, holdReasons: JSON.parse(row.hold_reasons) } });
        return { kind: "rejected", error: conflict("INVALID_STATE",
          `Order is ${row.state}; only an APPROVED order can execute`, { state: row.state }) };
      }
      // An agent may only execute its own order, authorized by the mandate it used.
      if (executor.kind === "mandate" && (row.mandate_id !== executor.mandateId || row.created_by !== actor
        || row.approved_by !== `mandate:${executor.mandateId}`)) {
        writeAudit(db, { userId, actor, eventType: "order.execute_refused", actionId: orderId,
          detail: { reason: "AGENT_NOT_AUTHORIZED", approvedBy: row.approved_by, mandateId: executor.mandateId } });
        return { kind: "rejected", error: conflict("INVALID_STATE",
          msg("Agents can only execute their own mandate-authorized orders")) };
      }

      // 1. The approval must match the exact current order version, including the price bound.
      const expected = orderApprovalHash(approvableOrder(row));
      if (row.approval_hash !== expected || row.approved_version !== row.version || row.price_bound_cents === null) {
        writeAudit(db, { userId, actor: "system", eventType: "order.approval_invalidated", actionId: orderId,
          detail: { reason: "Order changed after approval" } });
        applyOrderEvaluation(db, userId, row, "system", now, { bumpOnReprice: true });
        return { kind: "rejected", error: conflict("APPROVAL_INVALID",
          msg("Something material changed after approval. The approval was discarded; review the order again.")) };
      }

      // 2. Current controls, limits, cash/shares, mandate and price bound must still pass.
      const { policy, account, quote } = runOrderPolicy(db, userId, row, now);
      if (policy.decision === "HOLD" || !quote) {
        applyOrderEvaluation(db, userId, row, "system", now, { bumpOnReprice: true });
        return { kind: "rejected", error: conflict("POLICY_HOLD",
          `Execution blocked: ${policy.reasons.join(", ")}. The approval was discarded.`, { reasons: policy.reasons }) };
      }

      // 3. Fill at the current simulated price.
      const priceCents = quote.priceCents;
      const bound = row.price_bound_cents;
      const inBound = row.side === "buy" ? priceCents <= bound : priceCents >= bound;
      if (!inBound) throw new Error(msg("Price outside the approved bound")); // policy already checked; defense in depth

      const position = db
        .prepare("SELECT * FROM positions WHERE user_id = ? AND account_id = ? AND symbol = ?")
        .get(userId, account.id, row.symbol) as PositionRow | undefined;
      const heldBefore = position?.quantity_micros ?? 0;

      let quantityMicros: number;
      let grossCents: number;
      let costPortionCents = 0;
      if (row.side === "buy") {
        quantityMicros = row.quantity_micros ?? mulDiv(row.notional_cents!, MICROS_PER_SHARE, priceCents, "floor");
        if (quantityMicros <= 0) throw new Error(msg("Order too small to buy any shares"));
        grossCents = valueCents(quantityMicros, priceCents, "ceil");
      } else {
        quantityMicros = row.quantity_micros!;
        if (!position || quantityMicros > heldBefore) throw new Error(msg("Insufficient shares at execution"));
        grossCents = valueCents(quantityMicros, priceCents, "floor");
        costPortionCents = quantityMicros === heldBefore
          ? position.cost_basis_cents
          : mulDiv(position.cost_basis_cents, quantityMicros, heldBefore, "round");
      }
      const ts = now.toISOString();
      const cashDelta = row.side === "buy" ? -grossCents : grossCents;
      const fill: OrderFill = {
        fillId: `fill_${randomBytes(6).toString("hex")}`,
        orderId,
        orderVersion: row.version,
        executedAt: ts,
        accountId: account.id,
        symbol: row.symbol,
        side: row.side,
        quantityMicros,
        priceCents,
        grossCents,
        priceBoundCents: bound,
        cashAfterCents: account.balanceCents + cashDelta,
        positionQuantityAfterMicros: row.side === "buy" ? heldBefore + quantityMicros : heldBefore - quantityMicros,
        realizedPnlCents: row.side === "sell" ? grossCents - costPortionCents : null,
        approvedBy: row.approved_by!,
        executedBy: actor,
        quoteSource: "simulated",
        paper: true,
        simulated: true,
      };

      // Single-execution guard: only one request can move APPROVED → EXECUTED.
      const claimed = db.prepare(
        `UPDATE orders SET state = 'EXECUTED', executed_at = ?, fill = ?, filled_gross_cents = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'APPROVED' AND version = ?`,
      ).run(ts, JSON.stringify(fill), grossCents, ts, orderId, userId, row.version);
      if (claimed.changes !== 1) throw new Error(msg("Order changed during execution"));

      // Paper cash only (is_paper = 1); never real or imported balances.
      const cash = row.side === "buy"
        ? db.prepare(
            `UPDATE accounts SET balance_cents = balance_cents - ?, available_cents = available_cents - ?, updated_at = ?
             WHERE id = ? AND user_id = ? AND is_paper = 1 AND available_cents >= ?`,
          ).run(grossCents, grossCents, ts, account.id, userId, grossCents)
        : db.prepare(
            `UPDATE accounts SET balance_cents = balance_cents + ?, available_cents = available_cents + ?, updated_at = ?
             WHERE id = ? AND user_id = ? AND is_paper = 1`,
          ).run(grossCents, grossCents, ts, account.id, userId);
      if (cash.changes !== 1) throw new Error(msg("Insufficient paper cash at execution"));

      if (row.side === "buy") {
        const bought = db.prepare(
          `INSERT INTO positions (user_id, account_id, symbol, quantity_micros, cost_basis_cents, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (account_id, symbol) DO UPDATE SET
             quantity_micros = quantity_micros + excluded.quantity_micros,
             cost_basis_cents = cost_basis_cents + excluded.cost_basis_cents,
             updated_at = excluded.updated_at
           WHERE positions.user_id = excluded.user_id`,
        ).run(userId, account.id, row.symbol, quantityMicros, grossCents, ts);
        if (bought.changes !== 1) throw new Error(msg("Position update failed"));
      } else if (quantityMicros === heldBefore) {
        db.prepare("DELETE FROM positions WHERE user_id = ? AND account_id = ? AND symbol = ?")
          .run(userId, account.id, row.symbol);
      } else {
        const sold = db.prepare(
          `UPDATE positions SET quantity_micros = quantity_micros - ?, cost_basis_cents = cost_basis_cents - ?, updated_at = ?
           WHERE user_id = ? AND account_id = ? AND symbol = ? AND quantity_micros > ?`,
        ).run(quantityMicros, costPortionCents, ts, userId, account.id, row.symbol, quantityMicros);
        if (sold.changes !== 1) throw new Error(msg("Insufficient shares at execution"));
      }

      writeAudit(db, { userId, actor, eventType: "order.executed", actionId: orderId,
        detail: { fillId: fill.fillId, version: row.version, symbol: row.symbol, side: row.side, quantityMicros,
          priceCents, grossCents, priceBoundCents: bound, approvedBy: row.approved_by, mandateId: row.mandate_id,
          paper: true, simulated: true } });
      return { kind: "executed" };
    }).immediate();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    // Lock contention is transient: nothing committed, the order stays APPROVED and can be retried.
    if (isTransientLockError(err)) throw brokerBusy();
    // The fill rolled back; record the failure separately, stamped with this attempt's time.
    const message = err instanceof Error ? err.message : msg("Unknown paper broker error");
    try {
      db.transaction(() => {
        db.prepare(`UPDATE orders SET state = 'FAILED', failure_reason = ?, updated_at = ?
                    WHERE id = ? AND user_id = ? AND state = 'APPROVED'`)
          .run(message, now.toISOString(), orderId, userId);
        writeAudit(db, { userId, actor: "system", eventType: "order.failed", actionId: orderId, detail: { message } });
      }).immediate();
    } catch (recordErr) {
      // Could not record the failure (lock held): the order is still APPROVED, so report it as retryable.
      if (isTransientLockError(recordErr)) throw brokerBusy();
      throw recordErr;
    }
    throw new ServiceError("INTERNAL", `Paper order failed: ${message}`, 500);
  }

  if (outcome.kind === "rejected") throw outcome.error;
  const order = getOrder(db, userId, orderId);
  return { order, fill: order.fill!, duplicate: outcome.kind === "duplicate" };
}
