/**
 * Transfer simulator — the only code that moves (synthetic) money.
 *
 * One IMMEDIATE SQLite transaction verifies owner, state, approval hash and
 * current policy, then debits/credits and writes the receipt and audit event.
 * Either everything commits or nothing does. A repeated request returns the
 * original receipt instead of executing again.
 */
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { toAction } from "@/lib/db/rows";
import { conflict, ServiceError } from "@/lib/errors";
import { getOwnedAccount } from "@/lib/finance/accounts";
import { approvalHash } from "@/lib/policy/approval";
import type { ExecutionReceipt, TransferAction, UserId } from "@/lib/types";
import { applyEvaluation, getAction, loadActionRow, runPolicy } from "./service";

export interface ExecuteResult {
  action: TransferAction;
  receipt: ExecutionReceipt;
  duplicate: boolean;
}

type Outcome =
  | { kind: "executed" }
  | { kind: "duplicate" }
  | { kind: "rejected"; error: ServiceError };

export function executeTransfer(db: DB, userId: UserId, actionId: string): ExecuteResult {
  const actor = `user:${userId}`;
  let outcome: Outcome;
  try {
    outcome = db.transaction((): Outcome => {
      const row = loadActionRow(db, userId, actionId);

      if (row.state === "EXECUTED") {
        writeAudit(db, { userId, actor, eventType: "action.execute_duplicate", actionId });
        return { kind: "duplicate" };
      }
      if (row.state !== "APPROVED") {
        writeAudit(db, { userId, actor, eventType: "action.execute_refused", actionId,
          detail: { reason: "NOT_APPROVED", state: row.state, holdReasons: JSON.parse(row.hold_reasons) } });
        return { kind: "rejected", error: conflict("INVALID_STATE",
          `Action is ${row.state}; only an APPROVED action can execute`, { state: row.state }) };
      }

      // 1. The approval must match the exact current action and recipient record.
      const { policy, source, recipient } = runPolicy(db, userId, row);
      const expected = approvalHash(toAction(row), recipient);
      if (row.approval_hash !== expected || row.approved_version !== row.version) {
        writeAudit(db, { userId, actor: "system", eventType: "action.approval_invalidated", actionId,
          detail: { reason: "Action or recipient changed after approval" } });
        applyEvaluation(db, userId, row, "system");
        return { kind: "rejected", error: conflict("APPROVAL_INVALID",
          "Something material changed after approval. The approval was discarded; review the transfer again.") };
      }

      // 2. Current controls, limits and balance must still pass.
      if (policy.decision === "HOLD") {
        applyEvaluation(db, userId, row, "system");
        return { kind: "rejected", error: conflict("POLICY_HOLD",
          `Execution blocked: ${policy.reasons.join(", ")}. The approval was discarded.`, { reasons: policy.reasons }) };
      }

      // 3. Move simulated money.
      const now = new Date().toISOString();
      const amount = row.amount_cents;
      const ownDestination = recipient.kind === "own_account" ? getOwnedAccount(db, userId, recipient.accountId!) : null;
      const receipt: ExecutionReceipt = {
        receiptId: `rcpt_${randomBytes(6).toString("hex")}`,
        actionId,
        executedAt: now,
        amountCents: amount,
        currency: row.currency,
        sourceAccountId: source.id,
        sourceBalanceAfterCents: source.balanceCents - amount,
        destination: `${recipient.displayName} — ${recipient.details.institution} ••${recipient.details.accountMask}`,
        destinationAccountId: ownDestination?.id ?? null,
        destinationBalanceAfterCents: ownDestination ? ownDestination.balanceCents + amount : null,
        simulated: true,
      };

      // Single-execution guard: only one request can move APPROVED → EXECUTED.
      const claimed = db.prepare(
        `UPDATE actions SET state = 'EXECUTED', executed_at = ?, receipt = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND state = 'APPROVED' AND version = ?`,
      ).run(now, JSON.stringify(receipt), now, actionId, userId, row.version);
      if (claimed.changes !== 1) throw new Error("Action changed during execution");

      const debited = db.prepare(
        `UPDATE accounts SET balance_cents = balance_cents - ?, available_cents = available_cents - ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND available_cents >= ?`,
      ).run(amount, amount, now, source.id, userId, amount);
      if (debited.changes !== 1) throw new Error("Insufficient available balance at execution");

      const groupId = ownDestination ? `tg_${actionId}` : null;
      const insertTx = db.prepare(
        `INSERT INTO transactions (id, account_id, user_id, posted_at, description, merchant, category,
           amount_cents, transfer_group_id, action_id)
         VALUES (?, ?, ?, ?, ?, ?, 'transfer', ?, ?, ?)`,
      );
      insertTx.run(`tx_${actionId}_out`, source.id, userId, now, `Transfer to ${receipt.destination}`,
        ownDestination ? null : recipient.displayName, -amount, groupId, actionId);

      if (ownDestination) {
        db.prepare(
          `UPDATE accounts SET balance_cents = balance_cents + ?, available_cents = available_cents + ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        ).run(amount, amount, now, ownDestination.id, userId);
        insertTx.run(`tx_${actionId}_in`, ownDestination.id, userId, now,
          `Transfer from ${source.name} ••${source.mask}`, null, amount, groupId, actionId);
      }

      writeAudit(db, { userId, actor, eventType: "action.executed", actionId,
        detail: { receiptId: receipt.receiptId, amountCents: amount, version: row.version, simulated: true } });
      return { kind: "executed" };
    }).immediate();
  } catch (err) {
    if (err instanceof ServiceError) throw err;
    // Simulation failed and rolled back; record the failure separately.
    const message = err instanceof Error ? err.message : "Unknown simulation error";
    db.transaction(() => {
      db.prepare(`UPDATE actions SET state = 'FAILED', failure_reason = ?, updated_at = ?
                  WHERE id = ? AND user_id = ? AND state = 'APPROVED'`)
        .run(message, new Date().toISOString(), actionId, userId);
      writeAudit(db, { userId, actor: "system", eventType: "action.failed", actionId, detail: { message } });
    })();
    throw new ServiceError("INTERNAL", `Simulated transfer failed: ${message}`, 500);
  }

  if (outcome.kind === "rejected") throw outcome.error;
  const action = getAction(db, userId, actionId);
  return { action, receipt: action.receipt!, duplicate: outcome.kind === "duplicate" };
}
