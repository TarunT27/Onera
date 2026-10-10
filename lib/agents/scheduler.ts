/**
 * Recurring schedule. Safe to call on every worker tick: dedupe keys make
 * repeated calls within the same period no-ops.
 *
 *  - daily per user: spending_review, subscription_review, portfolio_review
 *    (key `${type}:${userId}:${YYYY-MM-DD}`, UTC)
 *  - every 15 minutes per healthy connection: sync_connection
 *    (key `sync_connection:${userId}:${connectionId}:${YYYY-MM-DDTHH:MM}` bucket start)
 */
import type { DB } from "@/lib/db";
import { listConnections } from "@/lib/providers";
import type { UserId } from "@/lib/types";
import { enqueueJob } from "./queue";
import type { JobType, ScheduleReport } from "./types";

export const DAILY_JOB_TYPES: JobType[] = ["spending_review", "subscription_review", "portfolio_review"];
export const SYNC_INTERVAL_MS = 15 * 60_000;

export function syncBucket(now: Date): string {
  return new Date(Math.floor(now.getTime() / SYNC_INTERVAL_MS) * SYNC_INTERVAL_MS).toISOString().slice(0, 16);
}

export function scheduleRecurring(
  db: DB,
  now: Date = new Date(),
  opts: { userId?: UserId; trigger?: string } = {},
): ScheduleReport {
  const trigger = opts.trigger ?? "schedule";
  const day = now.toISOString().slice(0, 10);
  const bucket = syncBucket(now);
  const runAfter = now.toISOString();
  const users = opts.userId
    ? [opts.userId]
    : (db.prepare("SELECT id FROM users ORDER BY id").all() as { id: UserId }[]).map((u) => u.id);

  const report: ScheduleReport = { enqueued: 0, deduplicated: 0, jobIds: [] };
  const add = (userId: UserId, type: JobType, dedupeKey: string, payload: Record<string, unknown>) => {
    const r = enqueueJob(db, { userId, type, dedupeKey, payload: { trigger, ...payload }, runAfter });
    if (r.deduplicated) report.deduplicated++;
    else report.enqueued++;
    if (r.jobId) report.jobIds.push(r.jobId);
  };

  for (const userId of users) {
    for (const type of DAILY_JOB_TYPES) add(userId, type, `${type}:${userId}:${day}`, {});

    // A providers failure for one user must not stop scheduling for the others.
    let connections: ReturnType<typeof listConnections> = [];
    try {
      connections = listConnections(db, userId);
    } catch (err) {
      console.error("[clearfi] scheduler could not list connections", userId, err);
    }
    for (const c of connections) {
      if (c.status !== "healthy" || c.userId !== userId) continue;
      add(userId, "sync_connection", `sync_connection:${userId}:${c.id}:${bucket}`, { connectionId: c.id });
    }
  }
  return report;
}
