import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { toControls, type ControlsRow } from "@/lib/db/rows";
import { notFound } from "@/lib/errors";
import { UpdateControlsSchema, type UserControls, type UserId } from "@/lib/types";

export function getControls(db: DB, userId: UserId): UserControls {
  const row = db.prepare("SELECT * FROM user_controls WHERE user_id = ?").get(userId);
  if (!row) throw notFound("Controls");
  return toControls(row as ControlsRow);
}

/** Sum of transfers executed since the start of the current UTC day. */
export function executedTodayCents(db: DB, userId: UserId, now: Date = new Date()): number {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM actions
              WHERE user_id = ? AND state = 'EXECUTED' AND executed_at >= ?`)
    .get(userId, dayStart) as { total: number };
  return total;
}

/** Only the signed-in user changes controls. The assistant has no tool for this. */
export function updateControls(db: DB, userId: UserId, input: unknown): UserControls {
  const patch = UpdateControlsSchema.parse(input);
  const before = getControls(db, userId);
  db.transaction(() => {
    db.prepare(
      `UPDATE user_controls SET
         per_transfer_limit_cents = COALESCE(?, per_transfer_limit_cents),
         daily_limit_cents = COALESCE(?, daily_limit_cents),
         paused = COALESCE(?, paused),
         updated_at = ?
       WHERE user_id = ?`,
    ).run(
      patch.perTransferLimitCents ?? null,
      patch.dailyLimitCents ?? null,
      patch.paused === undefined ? null : patch.paused ? 1 : 0,
      new Date().toISOString(),
      userId,
    );
    const eventType =
      patch.paused === true && !before.paused ? "controls.paused"
      : patch.paused === false && before.paused ? "controls.resumed"
      : "controls.updated";
    writeAudit(db, { userId, actor: `user:${userId}`, eventType, detail: { before, patch } });
  })();
  return getControls(db, userId);
}
