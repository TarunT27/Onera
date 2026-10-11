/**
 * Connection monitor (job type "sync_connection", payload { connectionId }).
 *
 * Asks the providers module to sync one connection (an idempotent import of
 * simulated bank data). When new data arrives it queues spending and
 * subscription reviews for the same user. A failed or unhealthy sync becomes
 * a connection-health insight; thrown errors are retried with backoff.
 */
import { ServiceError } from "@/lib/errors";
import type { SyncSummary } from "@/lib/providers";
import type { AgentContext, AgentHandler } from "../context";
import { PermanentJobError } from "../errors";
import { msg, tpl } from "@/lib/i18n/msg";

const STATUS_TITLE: Record<string, string> = {
  login_required: msg("A linked bank connection needs you to sign in again"),
  error: msg("A linked bank connection is reporting an error"),
  disconnected: msg("A linked bank connection is disconnected"),
};

function healthInsight(ctx: AgentContext, connectionId: string, status: string, error: string | null) {
  ctx.insights.upsert({
    type: "connection_health",
    severity: "warning",
    title: STATUS_TITLE[status] ?? msg("A linked bank connection failed to sync"),
    body: error
      ? tpl(
          "The last sync of connection {connectionId} did not complete: {error} Balances and transactions from it may " +
            "be out of date, and monitors can't see new activity until it syncs again. Simulated institution.",
          { connectionId, error },
        )
      : tpl(
          "The last sync of connection {connectionId} did not complete. Balances and transactions from it may " +
            "be out of date, and monitors can't see new activity until it syncs again. Simulated institution.",
          { connectionId },
        ),
    evidence: { connectionIds: [connectionId], status, error },
    dedupeKey: `connection_health:${connectionId}`,
  });
}

export const syncConnectionJob: AgentHandler = (ctx) => {
  const connectionId = ctx.job.payload.connectionId;
  if (typeof connectionId !== "string" || !connectionId) throw new PermanentJobError("payload.connectionId is required");

  let summary: SyncSummary;
  try {
    summary = ctx.connections.sync(connectionId);
  } catch (err) {
    // Not this user's connection (or gone): nothing to report to them, don't retry.
    if (err instanceof ServiceError && err.code === "NOT_FOUND") throw new PermanentJobError(err.message);
    const message = err instanceof Error ? err.message : String(err);
    healthInsight(ctx, connectionId, "error", message);
    throw err; // retried with exponential backoff, then dead-lettered
  }

  if (summary.status !== "healthy") {
    healthInsight(ctx, connectionId, summary.status, null);
    return { summary: tpl("Connection {connectionId} is {status}", { connectionId, status: summary.status }), data: { ...summary } };
  }

  const changed = Math.max(summary.added + summary.modified + summary.removed, summary.newTransactionIds.length);
  if (changed > 0) {
    const key = `after_sync:${connectionId}:${summary.syncedAt}`;
    const payload = { trigger: "sync", connectionId };
    ctx.jobs.enqueue({ type: "spending_review", dedupeKey: key, payload });
    ctx.jobs.enqueue({ type: "subscription_review", dedupeKey: key, payload });
  }
  return {
    summary: tpl(
      changed > 0
        ? "Synced {connectionId}: +{added} ~{modified} -{removed}; spending and subscription reviews queued"
        : "Synced {connectionId}: +{added} ~{modified} -{removed}; no new data",
      { connectionId, added: summary.added, modified: summary.modified, removed: summary.removed },
    ),
    data: { ...summary },
  };
};
