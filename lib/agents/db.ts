import type { DbModule } from "@/lib/db/modules";

/**
 * Tables for the agents module: the durable job queue, persisted insights and
 * the agent run log. Every row carries user_id; every query filters on it.
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
`,
  dropSql: /* sql */ `
DROP TABLE IF EXISTS agent_runs;
DROP TABLE IF EXISTS insights;
DROP TABLE IF EXISTS jobs;
`,
};
