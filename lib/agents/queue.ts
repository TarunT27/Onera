/**
 * Durable job queue — leaf module. Core code (lib/actions) imports enqueueJob
 * from here, so this file must not import lib/actions, lib/providers,
 * lib/markets or agent handlers (that would create import cycles). It imports
 * only the DB type and the module's own types.
 *
 * Semantics:
 *  - enqueue is idempotent on dedupe_key (any status, including finished jobs)
 *  - claiming is one atomic UPDATE … RETURNING that sets a lease (locked_until)
 *  - a lease that expires (crashed worker) is requeued, or dead-lettered if out of attempts
 *  - a failed attempt is retried with exponential backoff, then dead-lettered
 */
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { isJobType, type EnqueueResult, type Job, type JobInput, type JobStatus } from "./types";

export const DEFAULT_MAX_ATTEMPTS = 3;
export const MAX_ATTEMPTS_LIMIT = 10;
export const LEASE_MS = 60_000;
export const BACKOFF_BASE_MS = 30_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

/** Delay before retry number `attempts + 1`: 30s, 60s, 120s … capped at 30 min. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempts - 1, 0), BACKOFF_MAX_MS);
}

export interface JobRow {
  id: string;
  user_id: string;
  type: string;
  dedupe_key: string;
  status: JobStatus;
  attempts: number;
  max_attempts: number;
  run_after: string;
  locked_until: string | null;
  payload: string;
  result: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export function toJob(r: JobRow): Job {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    type: r.type,
    dedupeKey: r.dedupe_key,
    status: r.status,
    attempts: r.attempts,
    maxAttempts: r.max_attempts,
    runAfter: r.run_after,
    lockedUntil: r.locked_until,
    payload: JSON.parse(r.payload),
    result: r.result ? JSON.parse(r.result) : null,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Adds a job unless one with the same dedupe key already exists, in which case
 * the existing job's ID is returned with `deduplicated: true`. Safe to call
 * inside a caller's transaction (createTransfer does).
 */
export function enqueueJob(db: DB, job: JobInput): EnqueueResult {
  if (!isJobType(job.type)) throw new Error(`Unknown job type: ${job.type}`);
  if (!job.dedupeKey) throw new Error("dedupeKey is required");
  const now = new Date().toISOString();
  const runAfter = job.runAfter ? new Date(job.runAfter).toISOString() : now;
  const maxAttempts = Math.min(Math.max(Math.trunc(job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS), 1), MAX_ATTEMPTS_LIMIT);
  const id = `job_${randomBytes(6).toString("hex")}`;

  const inserted = db
    .prepare(
      `INSERT INTO jobs (id, user_id, type, dedupe_key, status, attempts, max_attempts, run_after, payload,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?, ?, ?)
       ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .run(id, job.userId, job.type, job.dedupeKey, maxAttempts, runAfter, JSON.stringify(job.payload ?? {}), now, now);
  if (inserted.changes === 1) return { jobId: id, deduplicated: false };

  const existing = db.prepare("SELECT id, user_id FROM jobs WHERE dedupe_key = ?").get(job.dedupeKey) as
    | { id: string; user_id: string }
    | undefined;
  // Never hand one user's job ID to another user's caller.
  if (!existing || existing.user_id !== job.userId) throw new Error("Dedupe key collision across users");
  return { jobId: existing.id, deduplicated: true };
}

/**
 * Atomically claims the next due job and leases it until now + leaseMs.
 * Security reviews go first so a backlog of other work never delays them.
 */
export function claimNextJob(
  db: DB,
  now: Date,
  opts: { userId?: UserId; leaseMs?: number } = {},
): JobRow | undefined {
  const nowIso = now.toISOString();
  const lockedUntil = new Date(now.getTime() + (opts.leaseMs ?? LEASE_MS)).toISOString();
  const userClause = opts.userId ? "AND user_id = @userId" : "";
  return db
    .prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, locked_until = @lockedUntil, updated_at = @now
       WHERE id = (
         SELECT id FROM jobs
         WHERE status IN ('queued','failed') AND run_after <= @now ${userClause}
         ORDER BY CASE type WHEN 'security_review' THEN 0 ELSE 1 END, run_after, created_at, id
         LIMIT 1
       ) AND status IN ('queued','failed')
       RETURNING *`,
    )
    .get({ now: nowIso, lockedUntil, ...(opts.userId ? { userId: opts.userId } : {}) }) as JobRow | undefined;
}

export function completeJob(db: DB, jobId: string, result: unknown, now: Date): void {
  db.prepare(
    `UPDATE jobs SET status = 'succeeded', result = ?, locked_until = NULL, last_error = NULL, updated_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(JSON.stringify(result ?? null), now.toISOString(), jobId);
}

/**
 * Records a failed attempt. Retries with exponential backoff while attempts
 * remain; otherwise (or for a permanent error) the job is dead-lettered.
 */
export function failJob(
  db: DB,
  jobId: string,
  error: string,
  now: Date,
  opts: { permanent?: boolean } = {},
): "failed" | "dead" {
  const row = db.prepare("SELECT attempts, max_attempts FROM jobs WHERE id = ?").get(jobId) as
    | { attempts: number; max_attempts: number }
    | undefined;
  if (!row) throw new Error(`Job ${jobId} not found`);
  const status = opts.permanent || row.attempts >= row.max_attempts ? "dead" : "failed";
  const runAfter = status === "failed" ? new Date(now.getTime() + backoffMs(row.attempts)).toISOString() : null;
  db.prepare(
    `UPDATE jobs SET status = ?, last_error = ?, locked_until = NULL, run_after = COALESCE(?, run_after), updated_at = ?
     WHERE id = ? AND status = 'running'`,
  ).run(status, error.slice(0, 1000), runAfter, now.toISOString(), jobId);
  return status;
}

/** Returns jobs whose lease expired (worker crashed mid-run) to the queue, or dead-letters them. */
export function requeueExpiredJobs(db: DB, now: Date, opts: { userId?: UserId } = {}): { requeued: number; dead: number } {
  const nowIso = now.toISOString();
  const userClause = opts.userId ? "AND user_id = @userId" : "";
  const params = { now: nowIso, ...(opts.userId ? { userId: opts.userId } : {}) };
  return db.transaction(() => {
    const dead = db
      .prepare(
        `UPDATE jobs SET status = 'dead', locked_until = NULL,
           last_error = 'Lease expired on final attempt', updated_at = @now
         WHERE status = 'running' AND locked_until < @now AND attempts >= max_attempts ${userClause}`,
      )
      .run(params).changes;
    const requeued = db
      .prepare(
        `UPDATE jobs SET status = 'queued', locked_until = NULL, run_after = @now,
           last_error = 'Lease expired; requeued', updated_at = @now
         WHERE status = 'running' AND locked_until < @now ${userClause}`,
      )
      .run(params).changes;
    return { requeued, dead };
  })();
}

export function getJob(db: DB, userId: UserId, jobId: string): Job | null {
  const row = db.prepare("SELECT * FROM jobs WHERE id = ? AND user_id = ?").get(jobId, userId) as JobRow | undefined;
  return row ? toJob(row) : null;
}

export function listJobs(db: DB, userId: UserId, opts: { status?: JobStatus; limit?: number } = {}): Job[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.status
    ? db.prepare("SELECT * FROM jobs WHERE user_id = ? AND status = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
        .all(userId, opts.status, limit)
    : db.prepare("SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, limit);
  return (rows as JobRow[]).map(toJob);
}
