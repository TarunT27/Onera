import type { DbModule } from "@/lib/db/modules";
import { SEED_LINKS } from "./catalog";
import { link } from "./service";

/**
 * Tables and seed data for the providers module. Owned by the providers module.
 *
 * Linked accounts live in the core `accounts` table (connection_id, external_id)
 * and synced transactions in core `transactions` (provider_tx_id, unique per
 * account). This module only adds the connection record.
 */
export const providersModule: DbModule = {
  name: "providers",
  schemaSql: /* sql */ `
CREATE TABLE IF NOT EXISTS connections (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  institution_id TEXT NOT NULL,             -- simulated institution (lib/providers/catalog.ts)
  status         TEXT NOT NULL CHECK (status IN ('healthy','login_required','error','disconnected')),
  consent_scopes TEXT NOT NULL DEFAULT '[]', -- JSON array of granted (simulated) scopes
  cursor         TEXT,                       -- opaque sync cursor; NULL until the first sync
  history_start  TEXT NOT NULL,              -- start of the synced history window
  last_synced_at TEXT,
  last_error     TEXT,
  sync_count     INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (user_id, institution_id)
);
CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id);
`,
  dropSql: /* sql */ `
DROP TABLE IF EXISTS connections;
`,
  /** Pre-links simulated institutions for the demo users, synced up to asOf. No jobs are enqueued. */
  seed: (db, asOf) => {
    for (const { userId, institutionIds } of SEED_LINKS) {
      for (const institutionId of institutionIds) {
        link(db, userId, institutionId, { now: asOf, actor: "system", enqueue: false });
      }
    }
  },
};
