import type { DbModule } from "@/lib/db/modules";

/**
 * Tables for the chatguard module: server-recorded chat security events, the
 * findings the background monitor derives from them, and the monitor's
 * durable cursor/heartbeat. Every event and finding carries user_id; user
 * reads always filter on it. Events hold redacted, bounded excerpts only.
 */
export const chatguardModule: DbModule = {
  name: "chatguard",
  schemaSql: /* sql */ `
CREATE TABLE IF NOT EXISTS chat_security_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT NOT NULL,
  turn_id         TEXT NOT NULL,
  stage           TEXT NOT NULL
                    CHECK (stage IN ('input','retrieved_content','tool_request','tool_result','output','health')),
  agent           TEXT NOT NULL,
  tool            TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('allow','deny','observe')),
  reasons         TEXT NOT NULL DEFAULT '[]',   -- JSON EventReason[]
  evidence_ids    TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (the user's own records)
  signals         TEXT NOT NULL DEFAULT '{}',   -- JSON small facts (marker IDs, counts, codes)
  excerpt         TEXT,                         -- redacted, bounded
  ruleset_version TEXT NOT NULL,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cse_user ON chat_security_events(user_id, id);
CREATE INDEX IF NOT EXISTS idx_cse_turn ON chat_security_events(turn_id, id);
CREATE INDEX IF NOT EXISTS idx_cse_rate ON chat_security_events(user_id, stage, created_at);

CREATE TABLE IF NOT EXISTS chat_security_findings (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  conversation_id TEXT NOT NULL,
  rule_id         TEXT NOT NULL,
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical')),
  title           TEXT NOT NULL,
  signal          TEXT NOT NULL,
  explanation     TEXT NOT NULL,
  method          TEXT NOT NULL CHECK (method IN ('fixed_rule','ai_review')),
  status          TEXT NOT NULL CHECK (status IN ('suspected','confirmed_policy_violation','needs_review')),
  enforcement     TEXT NOT NULL
                    CHECK (enforcement IN ('blocked_before_release','blocked_before_tool','observed_after_event','not_observed')),
  evidence_ids    TEXT NOT NULL DEFAULT '[]',
  dedupe_key      TEXT NOT NULL,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  ruleset_version TEXT NOT NULL,
  -- An AI reviewer's opinion alone can never confirm a violation.
  CHECK (NOT (method = 'ai_review' AND status = 'confirmed_policy_violation')),
  UNIQUE (user_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_csf_user ON chat_security_findings(user_id, last_seen_at DESC);

-- Which events support a finding. The primary key makes replays idempotent:
-- occurrence counts are COUNT(*) here, so reprocessing an event never inflates them.
CREATE TABLE IF NOT EXISTS chat_security_finding_events (
  finding_id TEXT NOT NULL REFERENCES chat_security_findings(id) ON DELETE CASCADE,
  event_id   INTEGER NOT NULL,
  PRIMARY KEY (finding_id, event_id)
);

-- One row: the background monitor's durable progress and health.
CREATE TABLE IF NOT EXISTS chat_monitor_state (
  id                     TEXT PRIMARY KEY CHECK (id = 'chat_security'),
  cursor                 INTEGER NOT NULL DEFAULT 0,   -- last processed event id
  heartbeat_at           TEXT,
  last_completed_at      TEXT,
  lease_owner            TEXT,
  lease_until            TEXT,
  reviewer_calls         INTEGER NOT NULL DEFAULT 0,
  reviewer_last_error    TEXT,
  reviewer_last_error_at TEXT,
  updated_at             TEXT NOT NULL
);

-- Events the monitor could not process. Kept for review instead of silently dropped.
CREATE TABLE IF NOT EXISTS chat_monitor_failures (
  event_id   INTEGER PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  attempts   INTEGER NOT NULL,
  last_error TEXT NOT NULL,
  gave_up    INTEGER NOT NULL DEFAULT 0,
  failed_at  TEXT NOT NULL
);
`,
  dropSql: /* sql */ `
DROP TABLE IF EXISTS chat_monitor_failures;
DROP TABLE IF EXISTS chat_monitor_state;
DROP TABLE IF EXISTS chat_security_finding_events;
DROP TABLE IF EXISTS chat_security_findings;
DROP TABLE IF EXISTS chat_security_events;
`,
};
