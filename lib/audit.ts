import type { DB } from "@/lib/db";
import { toAuditEvent, type AuditRow } from "@/lib/db/rows";
import type { AuditEvent, UserId } from "@/lib/types";

/** Actor strings: "user:<id>", "assistant", "system". */
export function writeAudit(
  db: DB,
  e: { userId: UserId; actor: string; eventType: string; actionId?: string | null; detail?: object },
): void {
  db.prepare(
    `INSERT INTO audit_events (user_id, actor, event_type, action_id, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(e.userId, e.actor, e.eventType, e.actionId ?? null, JSON.stringify(e.detail ?? {}), new Date().toISOString());
}

export function listAudit(
  db: DB,
  userId: UserId,
  opts: { actionId?: string; limit?: number } = {},
): AuditEvent[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = opts.actionId
    ? db.prepare(`SELECT * FROM audit_events WHERE user_id = ? AND action_id = ? ORDER BY id DESC LIMIT ?`)
        .all(userId, opts.actionId, limit)
    : db.prepare(`SELECT * FROM audit_events WHERE user_id = ? ORDER BY id DESC LIMIT ?`).all(userId, limit);
  return (rows as AuditRow[]).map(toAuditEvent);
}
