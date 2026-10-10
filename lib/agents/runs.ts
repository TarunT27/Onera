/** Agent run log: one row per job attempt, always scoped to the job's user. */
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { AGENT_REGISTRY } from "./registry";
import type { AgentRun } from "./types";

interface RunRow {
  id: string;
  user_id: string;
  agent_id: string;
  job_id: string | null;
  trigger: string;
  status: AgentRun["status"];
  started_at: string;
  finished_at: string | null;
  summary: string | null;
  error: string | null;
}

function toRun(r: RunRow): AgentRun {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    agentId: r.agent_id,
    jobId: r.job_id,
    trigger: r.trigger,
    status: r.status,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    summary: r.summary,
    error: r.error,
  };
}

export function startRun(
  db: DB,
  run: { userId: UserId; agentId: string; jobId: string | null; trigger: string },
  now: Date,
): string {
  const id = `run_${randomBytes(6).toString("hex")}`;
  db.prepare(
    `INSERT INTO agent_runs (id, user_id, agent_id, job_id, trigger, status, started_at)
     VALUES (?, ?, ?, ?, ?, 'running', ?)`,
  ).run(id, run.userId, run.agentId, run.jobId, run.trigger, now.toISOString());
  return id;
}

export function finishRun(
  db: DB,
  runId: string,
  outcome: { status: "succeeded" | "failed"; summary?: string | null; error?: string | null },
  now: Date,
): void {
  db.prepare(`UPDATE agent_runs SET status = ?, finished_at = ?, summary = ?, error = ? WHERE id = ?`).run(
    outcome.status, now.toISOString(), outcome.summary ?? null, outcome.error?.slice(0, 1000) ?? null, runId,
  );
}

export function listRuns(db: DB, userId: UserId, opts: { agentId?: string; limit?: number } = {}): AgentRun[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = opts.agentId
    ? db.prepare("SELECT * FROM agent_runs WHERE user_id = ? AND agent_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?")
        .all(userId, opts.agentId, limit)
    : db.prepare("SELECT * FROM agent_runs WHERE user_id = ? ORDER BY started_at DESC, rowid DESC LIMIT ?").all(userId, limit);
  return (rows as RunRow[]).map(toRun);
}

/** The latest run of every registered agent for this user (null if it never ran). */
export function lastRunByAgent(db: DB, userId: UserId): Record<string, AgentRun | null> {
  const stmt = db.prepare(
    "SELECT * FROM agent_runs WHERE user_id = ? AND agent_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1",
  );
  return Object.fromEntries(
    AGENT_REGISTRY.map((a) => {
      const row = stmt.get(userId, a.id) as RunRow | undefined;
      return [a.id, row ? toRun(row) : null];
    }),
  );
}
