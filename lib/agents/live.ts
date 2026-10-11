/**
 * Live view of the background agents for one user: what each agent is doing
 * now (running / queued / idle / failing), its recent runs, its open findings,
 * the user's job backlog and the worker's heartbeat. Read-only; every query on
 * user data filters on user_id.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { workerHealth, type WorkerHealth } from "./health";
import { AGENT_REGISTRY } from "./registry";
import { listRuns } from "./runs";
import type { AgentDefinition, AgentRun, InsightSeverity } from "./types";

export type AgentLiveState = "running" | "queued" | "idle" | "failing";

export interface AgentLive {
  id: AgentDefinition["id"];
  name: string;
  purpose: string;
  trigger: string;
  reads: AgentDefinition["reads"];
  writes: AgentDefinition["writes"];
  state: AgentLiveState;
  /** Jobs waiting (queued or retrying) for this agent. */
  queued: number;
  lastRun: AgentRun | null;
  /** Newest first. */
  recentRuns: AgentRun[];
  totalRuns: number;
  openFindings: Record<InsightSeverity, number>;
}

export interface Backlog {
  /** Due now and not yet started. */
  due: number;
  /** Scheduled for later (retry backoff). */
  waiting: number;
  running: number;
  dead: number;
}

export interface AgentsLive {
  now: string;
  worker: WorkerHealth;
  backlog: Backlog;
  agents: AgentLive[];
  /** Latest runs across all agents, newest first. */
  feed: AgentRun[];
}

const RECENT_RUNS = 16;

export function agentsLive(db: DB, userId: UserId, now: Date = new Date()): AgentsLive {
  const nowIso = now.toISOString();
  const jobRows = db
    .prepare(
      `SELECT type, status, run_after <= ? AS due, COUNT(*) AS n FROM jobs
       WHERE user_id = ? AND status IN ('queued','failed','running','dead') GROUP BY type, status, due`,
    )
    .all(nowIso, userId) as { type: string; status: string; due: number; n: number }[];

  const backlog: Backlog = { due: 0, waiting: 0, running: 0, dead: 0 };
  for (const r of jobRows) {
    if (r.status === "running") backlog.running += r.n;
    else if (r.status === "dead") backlog.dead += r.n;
    else if (r.due) backlog.due += r.n;
    else backlog.waiting += r.n;
  }
  const jobsFor = (a: AgentDefinition, statuses: string[]) =>
    jobRows
      .filter((r) => (a.jobTypes as string[]).includes(r.type) && statuses.includes(r.status))
      .reduce((n, r) => n + r.n, 0);

  const findingRows = db
    .prepare(
      `SELECT agent_id, severity, COUNT(*) AS n FROM insights WHERE user_id = ? AND status = 'new' GROUP BY agent_id, severity`,
    )
    .all(userId) as { agent_id: string; severity: InsightSeverity; n: number }[];
  const totals = db
    .prepare("SELECT agent_id, COUNT(*) AS n FROM agent_runs WHERE user_id = ? GROUP BY agent_id")
    .all(userId) as { agent_id: string; n: number }[];

  const agents = AGENT_REGISTRY.map((a): AgentLive => {
    const recentRuns = listRuns(db, userId, { agentId: a.id, limit: RECENT_RUNS });
    const lastRun = recentRuns[0] ?? null;
    const running = jobsFor(a, ["running"]) > 0 || lastRun?.status === "running";
    const queued = jobsFor(a, ["queued", "failed"]);
    const openFindings = { critical: 0, warning: 0, info: 0 };
    for (const f of findingRows) if (f.agent_id === a.id) openFindings[f.severity] += f.n;
    return {
      id: a.id,
      name: a.name,
      purpose: a.purpose,
      trigger: a.trigger,
      reads: a.reads,
      writes: a.writes,
      state: running ? "running" : queued > 0 ? "queued" : lastRun?.status === "failed" ? "failing" : "idle",
      queued,
      lastRun,
      recentRuns,
      totalRuns: totals.find((t) => t.agent_id === a.id)?.n ?? 0,
      openFindings,
    };
  });

  return {
    now: nowIso,
    worker: workerHealth(db, now),
    backlog,
    agents,
    feed: listRuns(db, userId, { limit: 25 }),
  };
}
