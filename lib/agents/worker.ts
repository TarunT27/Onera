/**
 * Background worker tick and loop (used by `npm run worker`, scripts/worker.ts).
 *
 * A tick is: schedule recurring reviews for every user (deduped per day /
 * 15-minute bucket), then run due jobs up to a limit. All queue semantics
 * (dedupe, leases, retries, dead letters, per-user scoping, audit events) live
 * in the scheduler and runner — this file only sequences them.
 *
 * The loop isolates each tick: an exception is reported and the loop carries
 * on with the next tick. Stopping is cooperative: the current tick always
 * finishes, then the loop returns so the caller can close the database.
 */
import type { DB } from "@/lib/db";
import { DEFAULT_RUN_LIMIT, runPendingJobs } from "./runner";
import { scheduleRecurring } from "./scheduler";
import type { RunReport, ScheduleReport } from "./types";

export const DEFAULT_WORKER_INTERVAL_MS = 5_000;

export interface WorkerTickOptions {
  /** Max jobs processed in this tick (runner clamps to 1–500). */
  limit?: number;
}

export interface WorkerTickReport {
  at: string;
  scheduled: ScheduleReport;
  run: RunReport;
}

/** One worker tick across all users. Every job still runs scoped to its own user. */
export function runWorkerTick(db: DB, now: Date = new Date(), opts: WorkerTickOptions = {}): WorkerTickReport {
  const scheduled = scheduleRecurring(db, now, { trigger: "schedule" });
  const run = runPendingJobs(db, { now, limit: opts.limit ?? DEFAULT_RUN_LIMIT });
  return { at: now.toISOString(), scheduled, run };
}

/** One-line summary for logs. Contains counts only — no user data. */
export function formatTickSummary(r: WorkerTickReport): string {
  return (
    `[worker] ${r.at} scheduled=${r.scheduled.enqueued} deduped=${r.scheduled.deduplicated} ` +
    `processed=${r.run.processed} succeeded=${r.run.succeeded} failed=${r.run.failed} dead=${r.run.dead}` +
    (r.run.requeued ? ` requeued=${r.run.requeued}` : "")
  );
}

export interface WorkerLoopOptions extends WorkerTickOptions {
  intervalMs?: number;
  /** Run a single tick and return. */
  once?: boolean;
  /** Abort to stop after the current tick (also interrupts the sleep between ticks). */
  signal?: AbortSignal;
  /** Stop after this many ticks (tests). */
  maxTicks?: number;
  /** Injection points for tests. */
  tick?: (db: DB, now: Date, opts: WorkerTickOptions) => WorkerTickReport;
  clock?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (line: string) => void;
  logError?: (message: string, err: unknown) => void;
}

export interface WorkerLoopResult {
  ticks: number;
  errors: number;
  last: WorkerTickReport | null;
}

/** Resolves after `ms`, or immediately when `signal` aborts. */
export function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Runs ticks until stopped. A tick that throws is logged and counted; the loop continues. */
export async function runWorkerLoop(db: DB, opts: WorkerLoopOptions = {}): Promise<WorkerLoopResult> {
  const tick = opts.tick ?? runWorkerTick;
  const clock = opts.clock ?? (() => new Date());
  const sleep = opts.sleep ?? interruptibleSleep;
  const log = opts.log ?? ((line: string) => console.log(line));
  const logError = opts.logError ?? ((message: string, err: unknown) => console.error(message, err));
  const intervalMs = Math.max(opts.intervalMs ?? DEFAULT_WORKER_INTERVAL_MS, 0);
  const result: WorkerLoopResult = { ticks: 0, errors: 0, last: null };

  while (!opts.signal?.aborted) {
    result.ticks++;
    try {
      const report = tick(db, clock(), { limit: opts.limit });
      result.last = report;
      log(formatTickSummary(report));
    } catch (err) {
      result.errors++;
      logError("[worker] tick failed; continuing", err);
    }
    if (opts.once || (opts.maxTicks !== undefined && result.ticks >= opts.maxTicks) || opts.signal?.aborted) break;
    await sleep(intervalMs, opts.signal);
  }
  return result;
}
