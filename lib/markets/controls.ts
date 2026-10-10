/**
 * Trading limits. Only the signed-in user changes them (user route only; no
 * assistant or agent tool). The global pause stays in core user_controls.
 */
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { DEFAULT_TRADING_CONTROLS } from "./db";
import { UpdateTradingControlsSchema } from "./schemas";
import { readTradingControls } from "./store";
import type { TradingControls } from "./types";

export function getTradingControls(db: DB, userId: UserId): TradingControls {
  return readTradingControls(db, userId);
}

export function updateTradingControls(db: DB, userId: UserId, input: unknown): TradingControls {
  const patch = UpdateTradingControlsSchema.parse(input);
  const before = readTradingControls(db, userId);
  const now = new Date().toISOString();
  db.transaction(() => {
    db.prepare(
      `INSERT OR IGNORE INTO trading_controls (user_id, per_order_limit_cents, daily_order_limit_cents, updated_at)
       VALUES (?, ?, ?, ?)`,
    ).run(userId, DEFAULT_TRADING_CONTROLS.perOrderLimitCents, DEFAULT_TRADING_CONTROLS.dailyOrderLimitCents, now);
    db.prepare(
      `UPDATE trading_controls SET
         per_order_limit_cents = COALESCE(?, per_order_limit_cents),
         daily_order_limit_cents = COALESCE(?, daily_order_limit_cents),
         updated_at = ?
       WHERE user_id = ?`,
    ).run(patch.perOrderLimitCents ?? null, patch.dailyOrderLimitCents ?? null, now, userId);
    writeAudit(db, { userId, actor: `user:${userId}`, eventType: "trading_controls.updated", detail: { before, patch } });
  })();
  return readTradingControls(db, userId);
}
