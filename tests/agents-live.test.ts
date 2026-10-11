// Agents: worker heartbeat (live / stale / offline) and the per-user live status behind the Agents page.
import { describe, expect, it } from "vitest";
import { agentsLive, enqueueJob, runPendingJobs, runWorkerLoop, workerHealth, WORKER_STALE_AFTER_MS } from "@/lib/agents";
import { freshDb } from "./helpers";

const soon = (offsetMs = 0) => new Date(Date.now() + 1000 + offsetMs);

describe("worker heartbeat", () => {
  it("is offline before any worker runs, live after a tick and stale once it stops beating", async () => {
    const db = freshDb();
    expect(workerHealth(db).status).toBe("offline");

    const t0 = soon();
    await runWorkerLoop(db, {
      once: true, limit: 200, clock: () => t0, log: () => {},
      heartbeat: { workerId: "test-worker", mode: "standalone" },
    });
    const live = workerHealth(db, t0);
    expect(live).toMatchObject({ status: "live", liveWorkers: 1 });
    expect(live.latest).toMatchObject({ workerId: "test-worker", mode: "standalone", ticks: 1, tickErrors: 0 });
    expect(live.latest!.lastSummary).toMatch(/processed=\d+/);

    expect(workerHealth(db, new Date(t0.getTime() + WORKER_STALE_AFTER_MS + 1)).status).toBe("stale");
  });

  it("counts failed ticks without stopping the heartbeat", async () => {
    const db = freshDb();
    await runWorkerLoop(db, {
      maxTicks: 2, sleep: async () => {}, log: () => {}, logError: () => {},
      tick: () => { throw new Error("boom"); },
      heartbeat: { workerId: "w", mode: "in-process" },
    });
    expect(workerHealth(db).latest).toMatchObject({ ticks: 2, tickErrors: 2 });
  });

  it("writes no heartbeat unless asked", async () => {
    const db = freshDb();
    await runWorkerLoop(db, { once: true, log: () => {} });
    expect(workerHealth(db).status).toBe("offline");
  });
});

describe("agentsLive", () => {
  it("reports queued work, then runs and findings, for the session user only", () => {
    const db = freshDb();
    enqueueJob(db, { userId: "alice", type: "spending_review", dedupeKey: "spending_review:alice:live" });

    const before = agentsLive(db, "alice", soon());
    const spending = before.agents.find((a) => a.id === "spending_monitor")!;
    expect(spending).toMatchObject({ state: "queued", queued: 1, lastRun: null, totalRuns: 0 });
    expect(before.backlog).toMatchObject({ due: 1, running: 0 });
    expect(before.agents.map((a) => a.id)).toContain("threat_monitor");

    runPendingJobs(db, { now: soon() });
    const after = agentsLive(db, "alice", soon());
    const ran = after.agents.find((a) => a.id === "spending_monitor")!;
    expect(ran.state).toBe("idle");
    expect(ran.totalRuns).toBe(1);
    expect(ran.recentRuns[0]).toMatchObject({ agentId: "spending_monitor", status: "succeeded", userId: "alice" });
    expect(after.feed.every((r) => r.userId === "alice")).toBe(true);
    expect(after.backlog.due).toBe(0);

    // Bob sees none of alice's jobs or runs.
    const bob = agentsLive(db, "bob", soon());
    expect(bob.feed).toEqual([]);
    expect(bob.backlog).toEqual({ due: 0, waiting: 0, running: 0, dead: 0 });
    expect(bob.agents.every((a) => a.totalRuns === 0 && a.queued === 0)).toBe(true);
  });
});
