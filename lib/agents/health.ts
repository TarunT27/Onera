/**
 * Worker liveness. Each worker process (the in-process worker started with the
 * Next.js server, or `npm run worker`) records a heartbeat after every tick.
 * The UI shows monitoring as live, stale or not running from these rows —
 * never "all clear" when no worker has checked in recently.
 *
 * Heartbeats are process status (counts only); they hold no user data.
 */
import type { DB } from "@/lib/db";

export type WorkerMode = "in-process" | "standalone";

/** A worker that hasn't beaten for this long is shown as stale. */
export const WORKER_STALE_AFTER_MS = 60_000;

export interface WorkerHeartbeat {
  workerId: string;
  mode: WorkerMode;
  pid: number;
  intervalMs: number;
  startedAt: string;
  lastBeatAt: string;
  ticks: number;
  tickErrors: number;
  lastSummary: string | null;
}

export interface WorkerHealth {
  /** live: a worker beat within WORKER_STALE_AFTER_MS; stale: one did, earlier; offline: none ever did. */
  status: "live" | "stale" | "offline";
  staleAfterMs: number;
  /** Most recently active worker. */
  latest: WorkerHeartbeat | null;
  liveWorkers: number;
}

interface HeartbeatRow {
  worker_id: string;
  mode: WorkerMode;
  pid: number;
  interval_ms: number;
  started_at: string;
  last_beat_at: string;
  ticks: number;
  tick_errors: number;
  last_summary: string | null;
}

export function recordHeartbeat(
  db: DB,
  beat: { workerId: string; mode: WorkerMode; intervalMs: number; startedAt: string; ok: boolean; summary?: string },
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO worker_heartbeats (worker_id, mode, pid, interval_ms, started_at, last_beat_at, ticks, tick_errors, last_summary)
     VALUES (@workerId, @mode, @pid, @intervalMs, @startedAt, @now, 1, @err, @summary)
     ON CONFLICT(worker_id) DO UPDATE SET
       last_beat_at = @now, interval_ms = @intervalMs, ticks = ticks + 1, tick_errors = tick_errors + @err,
       last_summary = COALESCE(@summary, last_summary)`,
  ).run({
    workerId: beat.workerId, mode: beat.mode, pid: process.pid, intervalMs: beat.intervalMs,
    startedAt: beat.startedAt, now: now.toISOString(), err: beat.ok ? 0 : 1, summary: beat.summary ?? null,
  });
}

export function workerHealth(db: DB, now: Date = new Date()): WorkerHealth {
  const rows = db.prepare("SELECT * FROM worker_heartbeats ORDER BY last_beat_at DESC").all() as HeartbeatRow[];
  const cutoff = now.getTime() - WORKER_STALE_AFTER_MS;
  const live = rows.filter((r) => Date.parse(r.last_beat_at) >= cutoff);
  const r = rows[0];
  return {
    status: live.length > 0 ? "live" : rows.length > 0 ? "stale" : "offline",
    staleAfterMs: WORKER_STALE_AFTER_MS,
    liveWorkers: live.length,
    latest: r
      ? {
          workerId: r.worker_id, mode: r.mode, pid: r.pid, intervalMs: r.interval_ms, startedAt: r.started_at,
          lastBeatAt: r.last_beat_at, ticks: r.ticks, tickErrors: r.tick_errors, lastSummary: r.last_summary,
        }
      : null,
  };
}
