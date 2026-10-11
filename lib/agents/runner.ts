/**
 * Job runner. Claims due jobs one at a time, runs the registered agent's
 * handler with a context built from its registry entry, and records the
 * outcome on the job, in agent_runs and in the audit log (actor "agent:<id>").
 *
 * One job's failure never blocks another: every job is isolated in its own
 * try/catch, retries back off exponentially, and permanent failures
 * (scope violations, bad payloads, records not found for the user) go
 * straight to the dead-letter state.
 */
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { buildAgentContext, type AgentHandler, type ContextTracker } from "./context";
import { PermanentJobError, ScopeViolationError } from "./errors";
import { assistantBriefing } from "./monitors/assistant";
import { syncConnectionJob } from "./monitors/connections";
import { portfolioReview } from "./monitors/portfolio";
import { securityReview } from "./monitors/security";
import { spendingReview } from "./monitors/spending";
import { subscriptionReview } from "./monitors/subscriptions";
import { threatSweep } from "./monitors/threats";
import { claimNextJob, completeJob, failJob, requeueExpiredJobs, toJob, type JobRow } from "./queue";
import { agentForJobType } from "./registry";
import { finishRun, startRun } from "./runs";
import type { AgentId, JobOutcome, RunReport } from "./types";

const HANDLERS: Record<AgentId, AgentHandler> = {
  spending_monitor: spendingReview,
  subscription_monitor: subscriptionReview,
  security_sentinel: securityReview,
  portfolio_monitor: portfolioReview,
  connection_monitor: syncConnectionJob,
  threat_monitor: threatSweep,
  personal_assistant: assistantBriefing,
};

export const DEFAULT_RUN_LIMIT = 25;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function insightCounts(tracker: ContextTracker) {
  const count = (o: string) => tracker.insights.filter((i) => i.outcome === o).length;
  return { created: count("created"), updated: count("updated"), unchanged: count("unchanged") };
}

function processJob(db: DB, row: JobRow, now: Date): JobOutcome {
  const job = toJob(row);
  const userId = job.userId;
  const agent = agentForJobType(job.type);
  if (!agent) {
    const status = failJob(db, job.id, `No agent registered for job type "${job.type}"`, now, { permanent: true });
    writeAudit(db, { userId, actor: "system", eventType: "agent.job_dead",
      detail: { jobId: job.id, jobType: job.type, error: "No agent registered" } });
    return { jobId: job.id, userId, type: job.type, agentId: null, status, summary: "No agent registered" };
  }

  const actor = `agent:${agent.id}`;
  const trigger = typeof job.payload.trigger === "string" ? job.payload.trigger : "event";
  const runId = startRun(db, { userId, agentId: agent.id, jobId: job.id, trigger }, now);
  let tracker: ContextTracker | undefined;

  try {
    const built = buildAgentContext(db, agent,
      { id: job.id, userId, type: job.type, payload: job.payload, attempt: row.attempts }, now);
    tracker = built.tracker;
    const result = HANDLERS[agent.id](built.ctx);
    // A scope violation fails the run even if the handler caught the error.
    if (tracker.violations.length > 0) throw tracker.violations[0];

    const insights = insightCounts(tracker);
    completeJob(db, job.id, {
      summary: result.summary,
      ...(result.data ?? {}),
      insights: { ...insights, ids: tracker.insights.map((i) => i.id) },
      enqueued: tracker.enqueued,
    }, now);
    finishRun(db, runId, { status: "succeeded", summary: result.summary }, now);
    writeAudit(db, {
      userId, actor, eventType: "agent.run_succeeded", actionId: result.auditActionId ?? null,
      detail: { jobId: job.id, runId, jobType: job.type, trigger, summary: result.summary, insights,
        insightIds: tracker.insights.filter((i) => i.outcome !== "unchanged").map((i) => i.id),
        enqueued: tracker.enqueued.filter((e) => !e.deduplicated).map((e) => e.type) },
    });
    return { jobId: job.id, userId, type: job.type, agentId: agent.id, status: "succeeded", summary: result.summary };
  } catch (err) {
    const violation = err instanceof ScopeViolationError ? err : tracker?.violations[0];
    const permanent = violation !== undefined || err instanceof PermanentJobError;
    const message = errorMessage(violation ?? err);
    const status = failJob(db, job.id, message, now, { permanent });
    finishRun(db, runId, { status: "failed", error: message }, now);
    if (violation) {
      writeAudit(db, {
        userId, actor, eventType: "agent.scope_violation",
        detail: { jobId: job.id, runId, jobType: job.type, scope: violation.scope, error: message,
          allowedReads: agent.reads, allowedWrites: agent.writes },
      });
    }
    writeAudit(db, {
      userId, actor, eventType: status === "dead" ? "agent.job_dead" : "agent.run_failed",
      detail: { jobId: job.id, runId, jobType: job.type, trigger, attempt: row.attempts,
        maxAttempts: row.max_attempts, error: message, willRetry: status === "failed" },
    });
    return { jobId: job.id, userId, type: job.type, agentId: agent.id, status, summary: message };
  }
}

/**
 * Processes due jobs synchronously, up to `limit`. Jobs enqueued during the
 * run (e.g. reviews queued by a sync) are picked up in the same call if the
 * limit allows. Pass `userId` to process only that user's jobs.
 */
export function runPendingJobs(
  db: DB,
  opts: { limit?: number; now?: Date; userId?: UserId } = {},
): RunReport {
  const now = opts.now ?? new Date();
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_RUN_LIMIT), 1), 500);
  const expired = requeueExpiredJobs(db, now, { userId: opts.userId });
  const report: Required<RunReport> = {
    processed: 0, succeeded: 0, failed: 0, dead: expired.dead, requeued: expired.requeued, jobs: [],
  };

  for (let i = 0; i < limit; i++) {
    const row = claimNextJob(db, now, { userId: opts.userId });
    if (!row) break;
    report.processed++;
    let outcome: JobOutcome;
    try {
      outcome = processJob(db, row, now);
    } catch (err) {
      // Bookkeeping itself failed. Leave the job leased; it is requeued when the lease expires.
      console.error("[clearfi] agent job bookkeeping failed", row.id, err);
      outcome = { jobId: row.id, userId: row.user_id as UserId, type: row.type, agentId: null, status: "running",
        summary: errorMessage(err) };
      report.failed++;
      report.jobs.push(outcome);
      continue;
    }
    if (outcome.status === "succeeded") report.succeeded++;
    else if (outcome.status === "dead") report.dead++;
    else report.failed++;
    report.jobs.push(outcome);
  }
  return report;
}
