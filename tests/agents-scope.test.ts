// Agents: a handler that reads outside its registered scope is blocked, its run fails and the attempt is audited.
// The spending and subscription handlers are replaced with misbehaving ones; the runner and registry are real.
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agents/monitors/spending", () => ({
  // spending_monitor may read transactions only.
  spendingReview: (ctx: import("@/lib/agents/context").AgentContext) => {
    ctx.read.actions.list();
    return { summary: "should never get here" };
  },
}));
vi.mock("@/lib/agents/monitors/subscriptions", () => ({
  // Swallowing the error doesn't help: the context records the violation.
  subscriptionReview: (ctx: import("@/lib/agents/context").AgentContext) => {
    try {
      ctx.read.recipients.get("rcp_alice_landlord");
    } catch {
      /* ignored on purpose */
    }
    return { summary: "pretending all is well" };
  },
}));

import { enqueueJob, listInsights, listJobs, listRuns, runPendingJobs } from "@/lib/agents";
import { listAudit } from "@/lib/audit";
import { freshDb } from "./helpers";

const soon = () => new Date(Date.now() + 1000);

describe("scope enforcement", () => {
  it("blocks an out-of-scope read, fails the run, dead-letters the job and audits the violation", () => {
    const db = freshDb();
    const { jobId } = enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spending_review:alice:scope" });
    const report = runPendingJobs(db, { now: soon() });
    expect(report).toMatchObject({ processed: 1, succeeded: 0, dead: 1 });

    const [job] = listJobs(db, "alice", { status: "dead" });
    expect(job.id).toBe(jobId);
    expect(job.attempts).toBe(1); // permanent: not retried
    expect(job.lastError).toMatch(/spending_monitor may not read "actions"/);

    const [runRec] = listRuns(db, "alice", { agentId: "spending_monitor" });
    expect(runRec).toMatchObject({ status: "failed", jobId });
    expect(runRec.error).toMatch(/may not read "actions"/);

    const violation = listAudit(db, "alice").find((e) => e.eventType === "agent.scope_violation");
    expect(violation).toBeDefined();
    expect(violation!.actor).toBe("agent:spending_monitor");
    expect(violation!.detail).toMatchObject({ jobId, scope: "actions", allowedReads: ["transactions"] });
    expect(listInsights(db, "alice", { status: "all" })).toHaveLength(0);
  });

  it("fails the run even when the handler swallows the scope error", () => {
    const db = freshDb();
    enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "subscription_review:alice:scope" });
    expect(runPendingJobs(db, { now: soon() })).toMatchObject({ succeeded: 0, dead: 1 });
    const violation = listAudit(db, "alice").find((e) => e.eventType === "agent.scope_violation");
    expect(violation).toMatchObject({ actor: "agent:subscription_monitor", detail: { scope: "recipients" } });
  });

  it("a violating job doesn't stop a well-behaved one", () => {
    const db = freshDb();
    enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spending_review:alice:bad" });
    enqueueJob(db, { userId: "alice", type: "portfolio_review", dedupeKey: "portfolio_review:alice:good" });
    expect(runPendingJobs(db, { now: soon() })).toMatchObject({ processed: 2, succeeded: 1, dead: 1 });
  });
});
