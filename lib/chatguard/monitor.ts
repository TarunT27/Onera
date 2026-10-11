/**
 * Background chat security monitor.
 *
 * A server process (never a browser timer) that reads new chat security events
 * after a durable cursor, applies fixed rules, optionally asks the AI reviewer
 * about ambiguous ones, and writes deduplicated findings. It runs without the
 * user starting a scan: on arrival of new events (in-process wake-up) and on a
 * catch-up poll. With nothing new it only updates its heartbeat — no reviewer
 * call, no model traffic.
 *
 * Restart/replay safety:
 *  - a lease on the state row lets one process work at a time; it is renewed
 *    between reviewer calls, and a batch commits only if it still holds the
 *    lease (a demo reset or another process taking over discards the batch);
 *  - findings and their event links are written in the same transaction that
 *    advances the cursor, so progress is saved only after findings are durable;
 *  - finding upserts are keyed by dedupe key and event ID, so a replayed batch
 *    adds nothing new;
 *  - an event whose processing throws is retried on later batches, then kept in
 *    chat_monitor_failures for review instead of being silently skipped.
 *
 * The monitor can only write findings and its own state. It has no path that
 * approves, executes, verifies recipients, changes limits or pauses anything.
 */
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { listConversationEvents, onNewEvents, toEvent, type EventRow } from "./events";
import { upsertFinding } from "./findings";
import { reviewerEnabled, reviewerFromEnv, type Reviewer } from "./reviewer";
import { applyRules } from "./rules";
import type { BatchReport, ChatSecurityEvent, FindingDraft, MonitorHealth, MonitorStatus } from "./types";
import { msg } from "@/lib/i18n/msg";

export const MONITOR_SETTINGS = {
  /** Catch-up poll while the app process is running. */
  pollMs: 30_000,
  /** No successful heartbeat for this long = degraded. */
  staleAfterMs: 60_000,
  batchLimit: 100,
  leaseMs: 60_000,
  /** Attempts per event before it is set aside as failed (kept for review). */
  maxEventAttempts: 3,
  /** Reviewer calls per batch, so a burst can't fan out into unbounded model traffic. */
  reviewerCallsPerBatch: 5,
  /** A reviewer error within this window shows monitoring as degraded. */
  reviewerDegradedMs: 5 * 60_000,
  /** Retention: processed events and stale findings are deleted after these ages. */
  eventRetentionDays: 14,
  findingRetentionDays: 30,
} as const;

const DAY_MS = 86_400_000;

interface StateRow {
  cursor: number;
  heartbeat_at: string | null;
  last_completed_at: string | null;
  lease_owner: string | null;
  lease_until: string | null;
  reviewer_calls: number;
  reviewer_last_error: string | null;
  reviewer_last_error_at: string | null;
}

function state(db: DB, now: Date): StateRow {
  db.prepare("INSERT OR IGNORE INTO chat_monitor_state (id, cursor, updated_at) VALUES ('chat_security', 0, ?)").run(
    now.toISOString(),
  );
  return db.prepare("SELECT * FROM chat_monitor_state WHERE id = 'chat_security'").get() as StateRow;
}

function acquireLease(db: DB, owner: string, now: Date): boolean {
  state(db, now);
  const until = new Date(now.getTime() + MONITOR_SETTINGS.leaseMs).toISOString();
  const r = db
    .prepare(
      `UPDATE chat_monitor_state SET lease_owner = ?, lease_until = ?, heartbeat_at = ?, updated_at = ?
       WHERE id = 'chat_security' AND (lease_until IS NULL OR lease_until < ? OR lease_owner = ?)`,
    )
    .run(owner, until, now.toISOString(), now.toISOString(), now.toISOString(), owner);
  return r.changes === 1;
}

/** Extends the lease if this owner still holds it. False = lost (expired and taken, or state reset). */
function renewLease(db: DB, owner: string, now: Date): boolean {
  const until = new Date(now.getTime() + MONITOR_SETTINGS.leaseMs).toISOString();
  return (
    db.prepare("UPDATE chat_monitor_state SET lease_until = ?, heartbeat_at = ? WHERE id = 'chat_security' AND lease_owner = ?")
      .run(until, now.toISOString(), owner).changes === 1
  );
}

function holdsLease(db: DB, owner: string): boolean {
  const row = db.prepare("SELECT lease_owner FROM chat_monitor_state WHERE id = 'chat_security'").get() as
    | { lease_owner: string | null }
    | undefined;
  return row?.lease_owner === owner;
}

class LeaseLostError extends Error {}

function releaseLease(db: DB, owner: string): void {
  db.prepare(
    "UPDATE chat_monitor_state SET lease_owner = NULL, lease_until = NULL WHERE id = 'chat_security' AND lease_owner = ?",
  ).run(owner);
}

function purgeExpired(db: DB, now: Date, cursor: number): void {
  const eventCutoff = new Date(now.getTime() - MONITOR_SETTINGS.eventRetentionDays * DAY_MS).toISOString();
  const findingCutoff = new Date(now.getTime() - MONITOR_SETTINGS.findingRetentionDays * DAY_MS).toISOString();
  // Only processed events are deleted; anything after the cursor is still pending.
  db.prepare("DELETE FROM chat_security_events WHERE id <= ? AND created_at < ?").run(cursor, eventCutoff);
  db.prepare("DELETE FROM chat_security_findings WHERE last_seen_at < ?").run(findingCutoff);
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

export interface BatchOptions {
  now?: () => Date;
  /** Identifies this process for the lease. */
  owner?: string;
  limit?: number;
  /** The optional AI reviewer. Defaults to the live reviewer when configured; pass null to disable. */
  reviewer?: Reviewer | null;
}

/** Processes one batch of new events. Safe to call concurrently from several processes. */
export async function processChatSecurityBatch(db: DB, opts: BatchOptions = {}): Promise<BatchReport> {
  const clock = opts.now ?? (() => new Date());
  const owner = opts.owner ?? `proc_${process.pid}`;
  const reviewer = opts.reviewer === undefined ? reviewerFromEnv() : opts.reviewer;
  const limit = Math.min(Math.max(opts.limit ?? MONITOR_SETTINGS.batchLimit, 1), 500);
  const report: BatchReport = {
    processed: 0, findingsWritten: 0, reviewerCalls: 0, reviewerFailures: 0, failedEvents: 0, cursor: 0, skipped: false,
  };

  if (!acquireLease(db, owner, clock())) {
    report.skipped = true;
    report.cursor = state(db, clock()).cursor;
    return report;
  }

  try {
    const start = state(db, clock());
    report.cursor = start.cursor;
    const rows = db
      .prepare("SELECT * FROM chat_security_events WHERE id > ? ORDER BY id LIMIT ?")
      .all(start.cursor, limit) as EventRow[];

    if (rows.length === 0) {
      const now = clock().toISOString();
      db.prepare(
        "UPDATE chat_monitor_state SET heartbeat_at = ?, last_completed_at = ?, updated_at = ? WHERE id = 'chat_security'",
      ).run(now, now, now);
      purgeExpired(db, clock(), start.cursor);
      return report;
    }

    const results: { event: ChatSecurityEvent; drafts: FindingDraft[] }[] = [];
    let stopAt: number | null = null;
    let reviewerError: string | null = null;

    for (const row of rows) {
      let event: ChatSecurityEvent;
      try {
        event = toEvent(row);
        const conversation = listConversationEvents(db, event.userId, event.conversationId, event.id);
        const { drafts, reviewCandidate } = applyRules(event, { conversation });

        if (reviewCandidate && reviewer && event.excerpt && report.reviewerCalls < MONITOR_SETTINGS.reviewerCallsPerBatch) {
          // Reviewer calls can be slow: keep the lease alive, and stop if it was lost meanwhile.
          if (!renewLease(db, owner, clock())) throw new LeaseLostError();
          report.reviewerCalls++;
          try {
            const markers = Array.isArray(event.signals.markers) ? (event.signals.markers as unknown[]).map(String) : [];
            const verdict = await reviewer({ stage: event.stage, excerpt: event.excerpt, markers });
            if (verdict.verdict !== "benign") {
              drafts.push({
                ruleId: "reviewer_flagged",
                severity: verdict.verdict === "suspicious" ? "warning" : "info",
                title: verdict.verdict === "suspicious" ? msg("AI reviewer flagged this message") : msg("AI reviewer couldn't decide"),
                signal: verdict.rationale,
                explanation:
                  msg("An AI reviewer read a redacted excerpt with no tools. Its opinion is advisory: it can't confirm a " +
                  "violation or authorize anything, and the server's fixed checks ran regardless."),
                method: "ai_review",
                status: event.stage === "input" && verdict.verdict === "suspicious" ? "suspected" : "needs_review",
                enforcement: "observed_after_event",
                dedupeKey: `review:${event.id}`,
                evidenceIds: event.evidenceIds,
              });
            }
          } catch (err) {
            // Degraded, not bypassed: the fixed-rule result for this event still stands.
            report.reviewerFailures++;
            reviewerError = errorText(err);
          }
        }
        results.push({ event, drafts });
      } catch (err) {
        if (err instanceof LeaseLostError) throw err;
        if (!holdsLease(db, owner)) throw new LeaseLostError();
        const failure = db
          .prepare(
            `INSERT INTO chat_monitor_failures (event_id, user_id, attempts, last_error, failed_at) VALUES (?, ?, 1, ?, ?)
             ON CONFLICT(event_id) DO UPDATE SET attempts = attempts + 1, last_error = excluded.last_error,
               failed_at = excluded.failed_at
             RETURNING attempts`,
          )
          .get(row.id, row.user_id, errorText(err), clock().toISOString()) as { attempts: number };
        if (failure.attempts < MONITOR_SETTINGS.maxEventAttempts) {
          stopAt = row.id; // retry this event on the next batch; don't skip past it
          break;
        }
        db.prepare("UPDATE chat_monitor_failures SET gave_up = 1 WHERE event_id = ?").run(row.id);
        report.failedEvents++;
      }
    }

    const lastRowId = rows[rows.length - 1].id;
    const newCursor = stopAt !== null ? stopAt - 1 : lastRowId;

    db.transaction(() => {
      // Progress is saved only by the lease holder: after a reset or a takeover this batch is stale.
      if (!holdsLease(db, owner)) throw new LeaseLostError();
      for (const { event, drafts } of results) {
        if (event.id > newCursor) continue;
        for (const d of drafts) {
          upsertFinding(db, event, d);
          report.findingsWritten++;
        }
        report.processed++;
      }
      db.prepare("DELETE FROM chat_monitor_failures WHERE event_id <= ? AND gave_up = 0").run(newCursor);
      const now = clock().toISOString();
      db.prepare(
        `UPDATE chat_monitor_state SET cursor = MAX(cursor, ?), heartbeat_at = ?, last_completed_at = ?,
           reviewer_calls = reviewer_calls + ?,
           reviewer_last_error = COALESCE(?, reviewer_last_error),
           reviewer_last_error_at = CASE WHEN ? IS NULL THEN reviewer_last_error_at ELSE ? END,
           updated_at = ?
         WHERE id = 'chat_security'`,
      ).run(newCursor, now, now, report.reviewerCalls, reviewerError, reviewerError, now, now);
    })();
    report.cursor = newCursor;
    return report;
  } catch (err) {
    if (!(err instanceof LeaseLostError)) throw err;
    // Nothing from this batch was committed; whoever holds the state now processes these events.
    return { ...report, processed: 0, findingsWritten: 0, skipped: true };
  } finally {
    releaseLease(db, owner);
  }
}

// ---------------------------------------------------------------------------
// Status (per user)
// ---------------------------------------------------------------------------

const clockLabel = (iso: string) => `${iso.slice(11, 19)} UTC`;

export function getMonitorStatus(db: DB, userId: UserId, now: Date = new Date()): MonitorStatus {
  const s = state(db, now);
  const pending = db
    .prepare("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM chat_security_events WHERE user_id = ? AND id > ?")
    .get(userId, s.cursor) as { n: number; oldest: string | null };
  const failed = db
    .prepare("SELECT COUNT(*) AS n FROM chat_monitor_failures WHERE user_id = ? AND gave_up = 1")
    .get(userId) as { n: number };

  const heartbeatAge = s.heartbeat_at ? now.getTime() - Date.parse(s.heartbeat_at) : Infinity;
  const reviewerRecentlyFailed =
    s.reviewer_last_error_at !== null && now.getTime() - Date.parse(s.reviewer_last_error_at) < MONITOR_SETTINGS.reviewerDegradedMs;
  const lagSeconds = pending.oldest ? Math.max(0, Math.round((now.getTime() - Date.parse(pending.oldest)) / 1000)) : null;

  let health: MonitorHealth;
  if (!s.heartbeat_at) health = "not_running";
  else if (heartbeatAge > MONITOR_SETTINGS.staleAfterMs || reviewerRecentlyFailed) health = "degraded";
  else if (lagSeconds !== null && lagSeconds * 1000 > MONITOR_SETTINGS.pollMs) health = "lagging";
  else health = "active";

  const last = s.last_completed_at ? clockLabel(s.last_completed_at) : "never";
  const label =
    health === "not_running"
      ? msg("Monitoring not running — no background check has completed yet")
      : health === "degraded"
        ? heartbeatAge > MONITOR_SETTINGS.staleAfterMs
          ? `Monitoring degraded — last completed check ${last}`
          : `Monitoring degraded — AI reviewer unavailable; fixed rules still checked at ${last}`
        : health === "lagging"
          ? `Background monitoring lagging — ${pending.n} events pending, oldest ${lagSeconds}s ago`
          : `Background monitoring active — checked at ${last}, ${pending.n} events pending`;

  return {
    health,
    label,
    heartbeatAt: s.heartbeat_at,
    lastCompletedAt: s.last_completed_at,
    pendingEvents: pending.n,
    failedEvents: failed.n,
    lagSeconds,
    reviewer: {
      enabled: reviewerEnabled(),
      calls: s.reviewer_calls,
      lastError: s.reviewer_last_error,
      lastErrorAt: s.reviewer_last_error_at,
    },
    staleAfterSeconds: MONITOR_SETTINGS.staleAfterMs / 1000,
    pollSeconds: MONITOR_SETTINGS.pollMs / 1000,
    limitations: [
      msg("Pattern matching and AI review are fallible. No finding does not prove no attack happened."),
      msg("Inline gates, not this monitor, prevent disclosure and unauthorized tool use; a finding can't undo what was shown."),
      msg("Monitoring runs only while the app or worker process is running."),
    ],
  };
}

// ---------------------------------------------------------------------------
// In-process loop: on arrival + catch-up poll
// ---------------------------------------------------------------------------

export interface MonitorLoopHandle {
  stop(): void;
  /** Resolves when the current batch (if any) finishes. */
  idle(): Promise<void>;
}

/**
 * Runs the monitor until stopped: a batch shortly after new events arrive in
 * this process, plus a catch-up poll every `pollMs` (which also heartbeats).
 * Batches never overlap; a wake-up during a batch schedules one more.
 */
export function startChatSecurityMonitor(
  db: DB,
  opts: { pollMs?: number; debounceMs?: number; log?: (line: string) => void; reviewer?: Reviewer | null } = {},
): MonitorLoopHandle {
  const owner = `monitor_${process.pid}_${randomBytes(3).toString("hex")}`;
  const pollMs = opts.pollMs ?? MONITOR_SETTINGS.pollMs;
  const debounceMs = opts.debounceMs ?? 250;
  const log = opts.log ?? (() => {});
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  let wakeTimer: ReturnType<typeof setTimeout> | null = null;

  const run = () => {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    running = (async () => {
      do {
        again = false;
        try {
          const r = await processChatSecurityBatch(db, { owner, reviewer: opts.reviewer });
          if (r.processed > 0 || r.failedEvents > 0) {
            log(`[chatguard] processed=${r.processed} findings=${r.findingsWritten} reviewer=${r.reviewerCalls} failed=${r.failedEvents} cursor=${r.cursor}`);
          }
          if (r.processed >= MONITOR_SETTINGS.batchLimit) again = true; // backlog: keep draining
        } catch (err) {
          console.error("[chatguard] batch failed; will retry on the next poll", err);
        }
      } while (again && !stopped);
    })().finally(() => {
      running = null;
    });
  };

  const unsubscribe = onNewEvents(() => {
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      run();
    }, debounceMs);
    wakeTimer.unref?.();
  });
  const poll = setInterval(run, pollMs);
  poll.unref?.();
  run();

  return {
    stop() {
      stopped = true;
      unsubscribe();
      clearInterval(poll);
      if (wakeTimer) clearTimeout(wakeTimer);
    },
    idle: () => running ?? Promise.resolve(),
  };
}
