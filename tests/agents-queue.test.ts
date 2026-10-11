// Agents: durable queue (dedupe, lease, retry/backoff, dead letter, isolation) and the recurring scheduler.
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({
  listConnections: vi.fn(),
  syncConnection: vi.fn(),
}));
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  listConnections: providers.listConnections,
  syncConnection: providers.syncConnection,
}));

import { createTransfer } from "@/lib/actions/service";
import { enqueueJob, listInsights, listJobs, listRuns, runPendingJobs, scheduleRecurring } from "@/lib/agents";
import { backoffMs, claimNextJob, LEASE_MS } from "@/lib/agents/queue";
import { listAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import type { Connection } from "@/lib/providers";
import type { UserId } from "@/lib/types";
import { freshDb } from "./helpers";

const SEC = 1000;
/** A moment safely after every real-time created_at/run_after in the test. */
const soon = (offsetMs = 0) => new Date(Date.now() + SEC + offsetMs);

function jobRow(db: DB, id: string) {
  return db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as {
    status: string; attempts: number; run_after: string; last_error: string | null; locked_until: string | null;
  };
}

function connection(id: string, userId: UserId, status: Connection["status"] = "healthy"): Connection {
  return {
    id, userId, institutionId: "inst_td", institutionName: "TD Bank (simulated)", status, consentScopes: ["transactions"],
    lastSyncedAt: null, lastError: null, accountIds: [], createdAt: new Date().toISOString(), simulated: true,
  };
}

beforeEach(() => {
  providers.listConnections.mockReset().mockReturnValue([]);
  providers.syncConnection.mockReset();
});

describe("enqueueJob", () => {
  it("dedupes on dedupe_key and returns the existing job", () => {
    const db = freshDb();
    const first = enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spending_review:alice:x" });
    const again = enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spending_review:alice:x" });
    expect(first.deduplicated).toBe(false);
    expect(first.jobId).toMatch(/^job_/);
    expect(again).toEqual({ jobId: first.jobId, deduplicated: true });
    const n = db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE dedupe_key = ?").get("spending_review:alice:x") as { n: number };
    expect(n.n).toBe(1);
  });

  it("still dedupes after the job has finished", () => {
    const db = freshDb();
    const first = enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:done" });
    runPendingJobs(db, { now: soon() });
    expect(listJobs(db, "alice", { status: "succeeded" }).map((j) => j.id)).toContain(first.jobId);
    expect(enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:done" }).deduplicated).toBe(true);
  });

  it("rejects unknown job types and never returns another user's job for a colliding key", () => {
    const db = freshDb();
    expect(() => enqueueJob(db, { userId: "alice", type: "approve_transfer", dedupeKey: "k" })).toThrow(/Unknown job type/);
    enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "shared-key" });
    expect(() => enqueueJob(db, { userId: "bob", type: "spending_review", dedupeKey: "shared-key" })).toThrow(/collision/);
  });

  it("createTransfer enqueues exactly one advisory security review", () => {
    const db = freshDb();
    const a = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_savings", amountCents: 10_000 }, "user");
    const jobs = listJobs(db, "alice").filter((j) => j.type === "security_review");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].payload).toEqual({ actionId: a.id });
    expect(jobs[0].status).toBe("queued");
  });
});

describe("runPendingJobs", () => {
  it("retries a failing job with exponential backoff, then dead-letters it", () => {
    const db = freshDb();
    providers.syncConnection.mockImplementation(() => { throw new Error("Simulated bank timeout"); });
    const t0 = soon();
    const { jobId } = enqueueJob(db, {
      userId: "alice", type: "sync_connection", dedupeKey: "sync:alice:conn_1:t0",
      payload: { connectionId: "conn_1" }, runAfter: t0.toISOString(), maxAttempts: 3,
    });

    // Attempt 1 fails → retry after 30s.
    expect(runPendingJobs(db, { now: t0 })).toMatchObject({ processed: 1, failed: 1, dead: 0 });
    let row = jobRow(db, jobId!);
    expect(row).toMatchObject({ status: "failed", attempts: 1, last_error: "Simulated bank timeout", locked_until: null });
    expect(row.run_after).toBe(new Date(t0.getTime() + backoffMs(1)).toISOString());
    expect(backoffMs(1)).toBe(30 * SEC);

    // Not due yet: nothing runs.
    expect(runPendingJobs(db, { now: new Date(t0.getTime() + 10 * SEC) }).processed).toBe(0);

    // Attempt 2 fails → retry after 60s (doubled).
    const t1 = new Date(t0.getTime() + 31 * SEC);
    expect(runPendingJobs(db, { now: t1 })).toMatchObject({ processed: 1, failed: 1 });
    row = jobRow(db, jobId!);
    expect(row).toMatchObject({ status: "failed", attempts: 2 });
    expect(row.run_after).toBe(new Date(t1.getTime() + backoffMs(2)).toISOString());
    expect(backoffMs(2)).toBe(60 * SEC);

    // Attempt 3 fails → dead letter, kept for inspection.
    const t2 = new Date(t1.getTime() + 61 * SEC);
    expect(runPendingJobs(db, { now: t2 })).toMatchObject({ processed: 1, failed: 0, dead: 1 });
    expect(jobRow(db, jobId!)).toMatchObject({ status: "dead", attempts: 3, last_error: "Simulated bank timeout" });
    expect(runPendingJobs(db, { now: new Date(t2.getTime() + 3_600 * SEC) }).processed).toBe(0);
    expect(providers.syncConnection).toHaveBeenCalledTimes(3);

    // Every attempt is a failed run with an audit event; the health insight is raised once, not three times.
    const runs = listRuns(db, "alice", { agentId: "connection_monitor" });
    expect(runs.map((r) => r.status)).toEqual(["failed", "failed", "failed"]);
    const events = listAudit(db, "alice").filter((e) => e.actor === "agent:connection_monitor").map((e) => e.eventType);
    expect(events.sort()).toEqual(["agent.job_dead", "agent.run_failed", "agent.run_failed"]);
    const health = listInsights(db, "alice").filter((i) => i.type === "connection_health");
    expect(health).toHaveLength(1);
    expect(health[0].evidence.connectionIds).toEqual(["conn_1"]);
  });

  it("requeues a job whose lease expired (crashed worker) and runs it", () => {
    const db = freshDb();
    const { jobId } = enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:lease" });
    const t0 = soon();
    const claimed = claimNextJob(db, t0); // a worker claims it, then "crashes"
    expect(claimed?.id).toBe(jobId);
    expect(jobRow(db, jobId!)).toMatchObject({ status: "running", attempts: 1 });

    // While the lease is valid nobody else can take it.
    expect(runPendingJobs(db, { now: new Date(t0.getTime() + 10 * SEC) })).toMatchObject({ processed: 0, requeued: 0 });

    const report = runPendingJobs(db, { now: new Date(t0.getTime() + LEASE_MS + SEC) });
    expect(report).toMatchObject({ requeued: 1, processed: 1, succeeded: 1 });
    expect(jobRow(db, jobId!)).toMatchObject({ status: "succeeded", attempts: 2, locked_until: null });
  });

  it("dead-letters a job whose lease expired on its final attempt", () => {
    const db = freshDb();
    const { jobId } = enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:last", maxAttempts: 1 });
    const t0 = soon();
    claimNextJob(db, t0);
    const report = runPendingJobs(db, { now: new Date(t0.getTime() + LEASE_MS + SEC) });
    expect(report).toMatchObject({ dead: 1, processed: 0 });
    expect(jobRow(db, jobId!)).toMatchObject({ status: "dead", last_error: "Lease expired on final attempt" });
  });

  it("one failing job never blocks the others", () => {
    const db = freshDb();
    providers.syncConnection.mockImplementation(() => { throw new Error("provider down"); });
    enqueueJob(db, { userId: "alice", type: "sync_connection", dedupeKey: "sync:alice:down", payload: { connectionId: "conn_x" } });
    enqueueJob(db, { userId: "alice", type: "security_review", dedupeKey: "sec:alice:bogus", payload: { actionId: "act_missing" } });
    enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:ok" });

    const report = runPendingJobs(db, { now: soon() });
    expect(report).toMatchObject({ processed: 3, succeeded: 1, failed: 1, dead: 1 });
    // The permanent failure (missing action) is dead-lettered immediately, not retried.
    const dead = listJobs(db, "alice", { status: "dead" });
    expect(dead.map((j) => j.type)).toEqual(["security_review"]);
    expect(dead[0].lastError).toMatch(/not found/);
    expect(listInsights(db, "alice").some((i) => i.type === "subscription_price_increase")).toBe(true);
  });

  it("security reviews are claimed before other due work", () => {
    const db = freshDb();
    enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spend:alice:first" });
    createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents: 185_000 }, "user");
    const report = runPendingJobs(db, { now: soon(), limit: 1 });
    expect(report.jobs?.[0].type).toBe("security_review");
  });

  it("can be limited to one user's jobs", () => {
    const db = freshDb();
    enqueueJob(db, { userId: "alice", type: "subscription_review", dedupeKey: "sub:alice:only" });
    enqueueJob(db, { userId: "bob", type: "subscription_review", dedupeKey: "sub:bob:only" });
    const report = runPendingJobs(db, { now: soon(), userId: "bob" });
    expect(report.processed).toBe(1);
    expect(report.jobs?.every((j) => j.userId === "bob")).toBe(true);
    expect(listJobs(db, "alice")[0].status).toBe("queued");
  });
});

describe("scheduleRecurring", () => {
  it("dedupes across repeated ticks: daily reviews once per day, syncs once per 15-minute bucket", () => {
    const db = freshDb();
    providers.listConnections.mockImplementation((_db: DB, userId: UserId) =>
      userId === "alice" ? [connection("conn_healthy", "alice"), connection("conn_broken", "alice", "login_required")] : []);

    const t0 = new Date(Date.UTC(2026, 9, 10, 12, 0, 0));
    const first = scheduleRecurring(db, t0);
    // 2 users × 3 daily reviews + 1 sync for alice's healthy connection (the broken one is skipped)
    // + 1 threat sweep per user for the seeded activity in the audit log + 1 assistant briefing per user.
    expect(first).toMatchObject({ enqueued: 11, deduplicated: 0 });

    expect(scheduleRecurring(db, new Date(t0.getTime() + 60 * SEC))).toMatchObject({ enqueued: 0, deduplicated: 11 });
    expect(scheduleRecurring(db, new Date(t0.getTime() + 14 * 60 * SEC))).toMatchObject({ enqueued: 0 });
    // New sync bucket; the briefing's 30-minute bucket hasn't turned over yet.
    expect(scheduleRecurring(db, new Date(t0.getTime() + 15 * 60 * SEC))).toMatchObject({ enqueued: 1, deduplicated: 10 });
    expect(scheduleRecurring(db, new Date(t0.getTime() + 30 * 60 * SEC))).toMatchObject({ enqueued: 3 });
    // No new activity: daily reviews and briefings again, but no new threat sweep.
    expect(scheduleRecurring(db, new Date(t0.getTime() + 24 * 3_600 * SEC))).toMatchObject({ enqueued: 9 });

    const aliceKeys = listJobs(db, "alice", { limit: 200 }).map((j) => j.dedupeKey);
    expect(aliceKeys).toContain("spending_review:alice:2026-10-10");
    expect(aliceKeys).toContain("sync_connection:alice:conn_healthy:2026-10-10T12:00");
    expect(aliceKeys).toContain("sync_connection:alice:conn_healthy:2026-10-10T12:15");
    expect(aliceKeys).toContain("assistant_briefing:alice:2026-10-10T12:00");
    expect(aliceKeys).toContain("assistant_briefing:alice:2026-10-10T12:30");
    expect(aliceKeys.some((k) => k.includes("conn_broken"))).toBe(false);
    const syncJob = listJobs(db, "alice", { limit: 200 }).find((j) => j.type === "sync_connection");
    expect(syncJob?.payload).toEqual({ trigger: "schedule", connectionId: "conn_healthy" });
    // Every job carries its own user.
    expect(listJobs(db, "bob", { limit: 200 }).every((j) => j.userId === "bob" && j.dedupeKey.includes(":bob:"))).toBe(true);
  });

  it("keeps scheduling other users when listing one user's connections fails", () => {
    const db = freshDb();
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    providers.listConnections.mockImplementation((_db: DB, userId: UserId) => {
      if (userId === "alice") throw new Error("providers unavailable");
      return [connection("conn_bob", "bob")];
    });
    const report = scheduleRecurring(db, new Date(Date.UTC(2026, 9, 10, 9, 7)));
    expect(report.enqueued).toBe(11); // 6 daily reviews + bob's sync + 2 threat sweeps + 2 briefings
    expect(listJobs(db, "bob").some((j) => j.type === "sync_connection")).toBe(true);
    err.mockRestore();
  });

  it("can schedule a single user (the demo button)", () => {
    const db = freshDb();
    const report = scheduleRecurring(db, new Date(Date.UTC(2026, 9, 10, 9, 0)), { userId: "bob", trigger: "manual" });
    expect(report.enqueued).toBe(5); // 3 daily reviews + 1 threat sweep + 1 briefing
    expect(listJobs(db, "alice")).toHaveLength(0);
    expect(listJobs(db, "bob").every((j) => j.payload.trigger === "manual")).toBe(true);
  });
});
