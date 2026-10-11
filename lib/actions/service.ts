/**
 * Transfer proposal lifecycle:
 *   PROPOSED → HELD | AWAITING_APPROVAL → APPROVED → EXECUTED   (FAILED on simulation error)
 *
 * Every function takes the session user ID from the server. Callers (routes,
 * AI tools) cannot choose whose data they act on.
 */
import { randomBytes } from "node:crypto";
import { enqueueJob } from "@/lib/agents/queue";
import { writeAudit } from "@/lib/audit";
import { executedTodayCents, getControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import { toAction, type ActionRow } from "@/lib/db/rows";
import { badRequest, conflict, notFound, ServiceError } from "@/lib/errors";
import { getOwnedAccount, getOwnedRecipient } from "@/lib/finance/accounts";
import { approvalHash } from "@/lib/policy/approval";
import { evaluatePolicy } from "@/lib/policy/evaluate";
import {
  ApproveSchema,
  CreateTransferSchema,
  EditTransferSchema,
  type Account,
  type ActionCreator,
  type ActionState,
  type PolicyResult,
  type Recipient,
  type TransferAction,
  type UserId,
} from "@/lib/types";
import { msg } from "@/lib/i18n/msg";

export const actorLabel = (createdBy: ActionCreator, userId: UserId) =>
  createdBy === "user" ? `user:${userId}` : "assistant";

const EVALUABLE: ActionState[] = ["PROPOSED", "HELD", "AWAITING_APPROVAL"];
const EDITABLE: ActionState[] = ["PROPOSED", "HELD", "AWAITING_APPROVAL", "APPROVED"];

export function loadActionRow(db: DB, userId: UserId, actionId: string): ActionRow {
  const row = db.prepare("SELECT * FROM actions WHERE id = ? AND user_id = ?").get(actionId, userId);
  if (!row) throw notFound("Action");
  return row as ActionRow;
}

export function getAction(db: DB, userId: UserId, actionId: string): TransferAction {
  return toAction(loadActionRow(db, userId, actionId));
}

export function listActions(db: DB, userId: UserId, limit = 50): TransferAction[] {
  const rows = db
    .prepare("SELECT * FROM actions WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(userId, limit);
  return (rows as ActionRow[]).map(toAction);
}

/** Validates the source/recipient pairing. Throws 400/404 for invalid proposals. */
function resolveEndpoints(db: DB, userId: UserId, sourceAccountId: string, recipientId: string) {
  const source = getOwnedAccount(db, userId, sourceAccountId);
  if (!source.capabilities.includes("transfer_source")) {
    throw new ServiceError("UNSUPPORTED", `${source.name} is view-only and cannot send transfers`, 400);
  }
  if (source.currency !== "USD" || source.paper) {
    throw new ServiceError("UNSUPPORTED", msg("Transfers are limited to USD bank accounts in this demo"), 400);
  }
  const recipient = getOwnedRecipient(db, userId, recipientId);
  if (recipient.kind === "own_account") {
    if (recipient.accountId === source.id) throw badRequest(msg("Source and destination are the same account"));
    const dest = getOwnedAccount(db, userId, recipient.accountId!);
    if (!dest.capabilities.includes("transfer_destination")) {
      throw new ServiceError("UNSUPPORTED", `${dest.name} cannot receive transfers`, 400);
    }
    if (dest.currency !== "USD" || dest.paper) {
      throw new ServiceError("UNSUPPORTED", msg("Transfers are limited to USD bank accounts in this demo"), 400);
    }
  }
  return { source, recipient };
}

function destinationSnapshot(recipient: Recipient) {
  return JSON.stringify({ displayName: recipient.displayName, ...recipient.details });
}

export function runPolicy(db: DB, userId: UserId, row: ActionRow, now = new Date()): {
  policy: PolicyResult;
  source: Account;
  recipient: Recipient;
} {
  const source = getOwnedAccount(db, userId, row.source_account_id);
  const recipient = getOwnedRecipient(db, userId, row.recipient_id);
  const policy = evaluatePolicy({
    amountCents: row.amount_cents,
    recipientVersion: row.recipient_version,
    source,
    recipient,
    controls: getControls(db, userId),
    executedTodayCents: executedTodayCents(db, userId, now),
    now,
  });
  return { policy, source, recipient };
}

/** Evaluates and stores the outcome. Must run inside a transaction. Clears any approval. */
export function applyEvaluation(db: DB, userId: UserId, row: ActionRow, actor: string): PolicyResult {
  const { policy } = runPolicy(db, userId, row);
  const state: ActionState = policy.decision === "ALLOW" ? "AWAITING_APPROVAL" : "HELD";
  db.prepare(
    `UPDATE actions SET state = ?, hold_reasons = ?, policy = ?, approval_hash = NULL,
       approved_version = NULL, approved_at = NULL, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(state, JSON.stringify(policy.reasons), JSON.stringify(policy), new Date().toISOString(), row.id, userId);
  writeAudit(db, {
    userId, actor, eventType: state === "HELD" ? "action.held" : "action.awaiting_approval", actionId: row.id,
    detail: { version: row.version, decision: policy.decision, reasons: policy.reasons },
  });
  return policy;
}

export function createTransfer(
  db: DB,
  userId: UserId,
  input: unknown,
  createdBy: ActionCreator,
): TransferAction {
  const data = CreateTransferSchema.parse(input);
  const { recipient } = resolveEndpoints(db, userId, data.sourceAccountId, data.recipientId);
  const id = `act_${randomBytes(5).toString("hex")}`;
  const now = new Date().toISOString();
  const actor = actorLabel(createdBy, userId);

  db.transaction(() => {
    db.prepare(
      `INSERT INTO actions (id, user_id, state, version, source_account_id, recipient_id, recipient_version,
         destination, amount_cents, currency, memo, created_by, created_at, updated_at)
       VALUES (?, ?, 'PROPOSED', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, userId, data.sourceAccountId, recipient.id, recipient.version, destinationSnapshot(recipient),
      data.amountCents, data.currency, data.memo, createdBy, now, now);
    writeAudit(db, {
      userId, actor, eventType: "action.proposed", actionId: id,
      detail: { amountCents: data.amountCents, sourceAccountId: data.sourceAccountId, recipientId: recipient.id,
        recipientVersion: recipient.version },
    });
    applyEvaluation(db, userId, loadActionRow(db, userId, id), "system");
    // Advisory security review by the background sentinel. It can raise findings, never approve.
    enqueueSecurityReview(db, userId, id, 1);
  })();
  return getAction(db, userId, id);
}

/** Material edit: bumps the version, drops approval and re-evaluates. */
export function editTransfer(db: DB, userId: UserId, actionId: string, input: unknown): TransferAction {
  const patch = EditTransferSchema.parse(input);
  const row = loadActionRow(db, userId, actionId);
  if (!EDITABLE.includes(row.state)) throw conflict("INVALID_STATE", `Action is ${row.state} and cannot be edited`);

  const sourceAccountId = patch.sourceAccountId ?? row.source_account_id;
  const recipientId = patch.recipientId ?? row.recipient_id;
  const { recipient } = resolveEndpoints(db, userId, sourceAccountId, recipientId);
  // Re-selecting a recipient captures its current version; otherwise keep the original snapshot.
  const refresh = patch.recipientId !== undefined;

  db.transaction(() => {
    db.prepare(
      `UPDATE actions SET state = 'PROPOSED', version = version + 1, source_account_id = ?, recipient_id = ?,
         recipient_version = ?, destination = ?, amount_cents = ?, memo = ?,
         approval_hash = NULL, approved_version = NULL, approved_at = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      sourceAccountId, recipientId,
      refresh ? recipient.version : row.recipient_version,
      refresh ? destinationSnapshot(recipient) : row.destination,
      patch.amountCents ?? row.amount_cents, patch.memo ?? row.memo,
      new Date().toISOString(), actionId, userId,
    );
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: "action.edited", actionId,
      detail: { fromVersion: row.version, toVersion: row.version + 1, changes: patch,
        approvalInvalidated: row.approval_hash !== null },
    });
    applyEvaluation(db, userId, loadActionRow(db, userId, actionId), "system");
    // Each version gets its own advisory review; it updates the same sentinel insight.
    enqueueSecurityReview(db, userId, actionId, row.version + 1);
  })();
  return getAction(db, userId, actionId);
}

function enqueueSecurityReview(db: DB, userId: UserId, actionId: string, version: number): void {
  enqueueJob(db, {
    userId, type: "security_review", dedupeKey: `security_review:${actionId}:v${version}`, payload: { actionId },
  });
}

export function evaluateAction(db: DB, userId: UserId, actionId: string): TransferAction {
  const row = loadActionRow(db, userId, actionId);
  if (!EVALUABLE.includes(row.state)) {
    throw conflict("INVALID_STATE", `Action is ${row.state}; only proposed, held or awaiting actions are re-evaluated`);
  }
  db.transaction(() => applyEvaluation(db, userId, row, `user:${userId}`))();
  return getAction(db, userId, actionId);
}

/**
 * Exact-action approval. Only reachable from the user-facing route — there is
 * no assistant tool for it. Policy is rechecked at approval time.
 */
export function approveAction(db: DB, userId: UserId, actionId: string, input: unknown): TransferAction {
  const { version } = ApproveSchema.parse(input);
  const outcome = db.transaction(() => {
    const row = loadActionRow(db, userId, actionId);
    if (row.state !== "AWAITING_APPROVAL") {
      return { error: conflict("INVALID_STATE", `Action is ${row.state}; only AWAITING_APPROVAL can be approved`) };
    }
    if (row.version !== version) {
      return {
        error: conflict("STALE_VERSION", `You reviewed v${version} but the action is now v${row.version}. Review it again.`),
      };
    }
    const { policy, recipient } = runPolicy(db, userId, row);
    if (policy.decision === "HOLD") {
      applyEvaluation(db, userId, row, "system");
      return { error: conflict("POLICY_HOLD", msg("Policy checks no longer pass; the action is held"), { reasons: policy.reasons }) };
    }
    const hash = approvalHash(toAction(row), recipient);
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE actions SET state = 'APPROVED', approval_hash = ?, approved_version = ?, approved_at = ?,
         policy = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND state = 'AWAITING_APPROVAL' AND version = ?`,
    ).run(hash, row.version, now, JSON.stringify(policy), now, actionId, userId, version);
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: "action.approved", actionId,
      detail: { version: row.version, approvalHashPrefix: hash.slice(0, 12) },
    });
    return { error: null };
  })();
  if (outcome.error) throw outcome.error;
  return getAction(db, userId, actionId);
}
