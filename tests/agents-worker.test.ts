// Agents: background worker tick (schedule + run, deduped) and the loop's error isolation / graceful stop.
import { beforeEach, describe, expect, it, vi } from "vitest";

const providers = vi.hoisted(() => ({ listConnections: vi.fn() }));
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  listConnections: providers.listConnections,
}));

import {
  formatTickSummary,
  listInsights,
  listJobs,
  runWorkerLoop,
  runWorkerTick,
  type WorkerTickReport,
} from "@/lib/agents";
import { listAudit } from "@/lib/audit";
import { freshDb } from "./helpers";

/** A moment safely after every real-time created_at/run_after in the seed. */
const soon = (offsetMs = 0) => new Date(Date.now() + 1000 + offsetMs);
const noSleep = async () => {};

beforeEach(() => {
  providers.listConnections.mockReset().mockReturnValue([]);
});

describe("runWorkerTick", () => {
  it("schedules every user's daily reviews and processes them into insights", () => {
    const db = freshDb();
    const report = runWorkerTick(db, soon(), { limit: 200 });

    expect(report.scheduled.enqueued).toBeGreaterThanOrEqual(3);
    expect(report.run.processed).toBeGreaterThanOrEqual(report.scheduled.enqueued);
    expect(report.run.failed).toBe(0);
    expect(report.run.dead).toBe(0);

    // Every scheduled job ran, scoped to its own user.
    const aliceJobs = listJobs(db, "alice", { limit: 200 });
    expect(aliceJobs.map((j) => j.type)).toEqual(
      expect.arrayContaining(["spending_review", "subscription_review", "portfolio_review"]),
    );
    expect(aliceJobs.every((j) => j.userId === "alice" && j.status === "succeeded")).toBe(true);

    const [streamflix] = listInsights(db, "alice", { status: "all" }).filter(
      (i) => i.type === "subscription_price_increase",
    );
    expect(streamflix?.evidence).toMatchObject({ merchant: "StreamFlix" });
    expect(listInsights(db, "bob", { status: "all" }).some((i) => i.type === "subscription_price_increase")).toBe(false);

    // Runs are audited under the agent actor.
    expect(listAudit(db, "alice").some((e) => e.actor === "agent:subscription_monitor" && e.eventType === "agent.run_succeeded"))
      .toBe(true);
    expect(formatTickSummary(report)).toMatch(/processed=\d+ succeeded=\d+ failed=0 dead=0/);
  });

  it("dedupes a second tick in the same day and sync bucket", () => {
    const db = freshDb();
    const now = soon();
    const first = runWorkerTick(db, now, { limit: 200 });
    const insightsAfterFirst = listInsights(db, "alice", { status: "all" }).length;

    const second = runWorkerTick(db, new Date(now.getTime() + 60_000), { limit: 200 });
    expect(second.scheduled.enqueued).toBe(0);
    expect(second.scheduled.deduplicated).toBe(first.scheduled.enqueued + first.scheduled.deduplicated);
    expect(second.run.processed).toBe(0);
    expect(listInsights(db, "alice", { status: "all" })).toHaveLength(insightsAfterFirst);
  });

  it("respects the job limit and leaves the rest queued for the next tick", () => {
    const db = freshDb();
    const now = soon();
    const first = runWorkerTick(db, now, { limit: 1 });
    expect(first.run.processed).toBe(1);
    const next = runWorkerTick(db, new Date(now.getTime() + 1000), { limit: 200 });
    expect(next.scheduled.enqueued).toBe(0);
    expect(next.run.processed).toBe(first.scheduled.enqueued - 1);
  });
});

describe("runWorkerLoop", () => {
  const fakeReport = (at: Date): WorkerTickReport => ({
    at: at.toISOString(),
    scheduled: { enqueued: 0, deduplicated: 0, jobIds: [] },
    run: { processed: 0, succeeded: 0, failed: 0, dead: 0 },
  });

  it("logs a thrown tick and keeps looping", async () => {
    const db = freshDb();
    let calls = 0;
    const tick = vi.fn((_db, now: Date) => {
      calls++;
      if (calls === 2) throw new Error("boom");
      return fakeReport(now);
    });
    const lines: string[] = [];
    const errors: unknown[] = [];

    const result = await runWorkerLoop(db, {
      tick, maxTicks: 3, sleep: noSleep, log: (l) => lines.push(l), logError: (_m, e) => errors.push(e),
    });

    expect(tick).toHaveBeenCalledTimes(3);
    expect(result).toMatchObject({ ticks: 3, errors: 1 });
    expect(lines).toHaveLength(2);
    expect((errors[0] as Error).message).toBe("boom");
  });

  it("runs exactly one tick with once", async () => {
    const db = freshDb();
    const tick = vi.fn((_db, now: Date) => fakeReport(now));
    const sleep = vi.fn(noSleep);
    const result = await runWorkerLoop(db, { tick, once: true, sleep, log: () => {} });
    expect(result.ticks).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("finishes the current tick and stops when aborted", async () => {
    const db = freshDb();
    const stop = new AbortController();
    const tick = vi.fn((_db, now: Date) => {
      stop.abort(); // signal arrives mid-tick
      return fakeReport(now);
    });
    const result = await runWorkerLoop(db, { tick, signal: stop.signal, intervalMs: 60_000, log: () => {} });
    expect(result).toMatchObject({ ticks: 1, errors: 0 });
    expect(result.last).not.toBeNull();
  });

  it("runs the real tick end to end", async () => {
    const db = freshDb();
    const result = await runWorkerLoop(db, { once: true, limit: 200, clock: () => soon(), log: () => {} });
    expect(result.errors).toBe(0);
    expect(result.last!.run.succeeded).toBeGreaterThan(0);
  });
});
