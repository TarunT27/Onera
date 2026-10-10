/**
 * Recipient verification. In a real product this is an out-of-band check
 * (call the landlord on a known number, micro-deposits, etc.). Here a user
 * click simulates it. The assistant cannot verify recipients.
 */
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { getOwnedRecipient } from "@/lib/finance/accounts";
import type { Recipient, RecipientDetails, UserId } from "@/lib/types";

export function verifyRecipient(db: DB, userId: UserId, recipientId: string): Recipient {
  const r = getOwnedRecipient(db, userId, recipientId);
  db.transaction(() => {
    db.prepare(
      `UPDATE recipients SET verified_version = version, previous_details = NULL, change_note = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(new Date().toISOString(), recipientId, userId);
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: "recipient.verified",
      detail: { recipientId, version: r.version, simulated: true },
    });
  })();
  return getOwnedRecipient(db, userId, recipientId);
}

/** Replaces destination details and bumps the version (used by tests and demo scenarios). */
export function changeRecipientDetails(
  db: DB,
  userId: UserId,
  recipientId: string,
  details: RecipientDetails,
  note: string,
): Recipient {
  const r = getOwnedRecipient(db, userId, recipientId);
  db.transaction(() => {
    db.prepare(
      `UPDATE recipients SET details = ?, version = version + 1, previous_details = ?, change_note = ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(JSON.stringify(details), JSON.stringify(r.details), note, new Date().toISOString(), recipientId, userId);
    writeAudit(db, {
      userId, actor: "system", eventType: "recipient.changed",
      detail: { recipientId, fromVersion: r.version, toVersion: r.version + 1, note },
    });
  })();
  return getOwnedRecipient(db, userId, recipientId);
}
