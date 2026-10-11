import type { DbModule } from "@/lib/db/modules";

/**
 * Tables for the agents module: the durable job queue, persisted insights, the
 * agent run log and worker heartbeats. Every user-data row carries user_id and
 * every query on it filters on it; heartbeats hold process status only.
 * No seed data: insights come from running the agents.
 */
export const agentsModule: DbModule = {
  name: "agents",
  schemaSql: /* sql */ `
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  type         TEXT NOT NULL,
  dedupe_key   TEXT NOT NULL UNIQUE,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued','running','succeeded','failed','dead')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3 CHECK (max_attempts >= 1),
  run_after    TEXT NOT NULL,          -- earliest time the next attempt may start
  locked_until TEXT,                   -- lease while running; expired leases are requeued
  payload      TEXT NOT NULL DEFAULT '{}',
  result       TEXT,
  last_error   TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_due ON jobs(status, run_after);
CREATE INDEX IF NOT EXISTS idx_jobs_user ON jobs(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS insights (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  agent_id      TEXT NOT NULL,
  type          TEXT NOT NULL,
  severity      TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL,
  evidence      TEXT NOT NULL DEFAULT '{}',  -- JSON InsightEvidence (record IDs)
  evidence_hash TEXT NOT NULL,               -- unchanged hash = no re-alert
  dedupe_key    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','seen','dismissed')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_insights_user ON insights(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  agent_id    TEXT NOT NULL,
  job_id      TEXT REFERENCES jobs(id),
  trigger     TEXT NOT NULL,
  status      TEXT NOT NULL CHECK (status IN ('running','succeeded','failed')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  summary     TEXT,
  error       TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id, started_at DESC);

-- Worker liveness (system status, no user data): one row per worker process, updated every tick.
CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_id     TEXT PRIMARY KEY,
  mode          TEXT NOT NULL CHECK (mode IN ('in-process','standalone')),
  pid           INTEGER NOT NULL,
  interval_ms   INTEGER NOT NULL,
  started_at    TEXT NOT NULL,
  last_beat_at  TEXT NOT NULL,
  ticks         INTEGER NOT NULL DEFAULT 0,
  tick_errors   INTEGER NOT NULL DEFAULT 0,
  last_summary  TEXT                      -- counts only
);
`,
  dropSql: /* sql */ `
DROP TABLE IF EXISTS worker_heartbeats;
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS insights;
DROP TABLE IF EXISTS jobs;
`,
};
