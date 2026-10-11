/**
 * Core SQLite schema. Owned by the finance/security role — coordinate changes.
 * Every private table carries user_id; every query must filter on it.
 *
 * Feature modules (providers, markets, agents) add their own tables through
 * lib/db/modules.ts; they never edit this file.
 */

/** Bump when any schema (core or module) changes. Local demo DBs are rebuilt and reseeded. */
export const SCHEMA_VERSION = 4;

export const SUPPORTED_CURRENCIES = ["USD", "EUR", "GBP", "CAD"] as const;

export const CORE_SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL,
  home_currency TEXT NOT NULL DEFAULT 'USD'
);

CREATE TABLE IF NOT EXISTS accounts (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  institution     TEXT NOT NULL,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('checking','savings','brokerage','credit')),
  currency        TEXT NOT NULL DEFAULT 'USD' CHECK (currency IN ('USD','EUR','GBP','CAD')),
  mask            TEXT NOT NULL,
  balance_cents   INTEGER NOT NULL,
  available_cents INTEGER NOT NULL,
  capabilities    TEXT NOT NULL,          -- JSON array of AccountCapability
  connection_id   TEXT,                   -- provider connection (lib/providers); NULL = built-in demo account
  external_id     TEXT,                   -- provider's account ID
  is_paper        INTEGER NOT NULL DEFAULT 0, -- paper-trading money; excluded from net worth
  updated_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                TEXT PRIMARY KEY,
  account_id        TEXT NOT NULL REFERENCES accounts(id),
  user_id           TEXT NOT NULL REFERENCES users(id),
  posted_at         TEXT NOT NULL,
  description       TEXT NOT NULL,
  merchant          TEXT,
  category          TEXT NOT NULL,
  amount_cents      INTEGER NOT NULL,     -- negative = outflow, in the account's currency
  currency          TEXT NOT NULL DEFAULT 'USD',
  status            TEXT NOT NULL DEFAULT 'posted' CHECK (status IN ('posted','pending')),
  transfer_group_id TEXT,                 -- links both legs of an internal transfer
  action_id         TEXT,
  provider_tx_id    TEXT                  -- provider's transaction ID; makes repeated syncs idempotent
);
CREATE INDEX IF NOT EXISTS idx_tx_user_posted ON transactions(user_id, posted_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_provider ON transactions(account_id, provider_tx_id)
  WHERE provider_tx_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS recipients (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id),
  display_name     TEXT NOT NULL,
  kind             TEXT NOT NULL CHECK (kind IN ('own_account','external')),
  account_id       TEXT REFERENCES accounts(id),
  details          TEXT NOT NULL,         -- JSON RecipientDetails (current)
  version          INTEGER NOT NULL DEFAULT 1,
  verified_version INTEGER,               -- NULL = never verified
  previous_details TEXT,                  -- JSON RecipientDetails at last verified version
  change_note      TEXT,
  updated_at       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recipients_user ON recipients(user_id);

CREATE TABLE IF NOT EXISTS actions (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  type              TEXT NOT NULL DEFAULT 'transfer' CHECK (type = 'transfer'),
  state             TEXT NOT NULL CHECK (state IN
                      ('PROPOSED','HELD','AWAITING_APPROVAL','APPROVED','EXECUTED','FAILED')),
  version           INTEGER NOT NULL DEFAULT 1,
  source_account_id TEXT NOT NULL REFERENCES accounts(id),
  recipient_id      TEXT NOT NULL REFERENCES recipients(id),
  recipient_version INTEGER NOT NULL,
  destination       TEXT NOT NULL,        -- JSON snapshot of recipient details at proposal
  amount_cents      INTEGER NOT NULL CHECK (amount_cents > 0),
  currency          TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  memo              TEXT NOT NULL DEFAULT '',
  created_by        TEXT NOT NULL CHECK (created_by IN ('user','assistant')),
  hold_reasons      TEXT NOT NULL DEFAULT '[]',
  policy            TEXT,                 -- JSON PolicyResult from last evaluation
  approval_hash     TEXT,                 -- server-computed; never sent to clients
  approved_version  INTEGER,
  approved_at       TEXT,
  receipt           TEXT,                 -- JSON ExecutionReceipt
  executed_at       TEXT,
  failure_reason    TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  -- An executed action must carry exactly one receipt.
  CHECK ((state = 'EXECUTED') = (receipt IS NOT NULL AND executed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_actions_user ON actions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS user_controls (
  user_id                  TEXT PRIMARY KEY REFERENCES users(id),
  per_transfer_limit_cents INTEGER NOT NULL,
  daily_limit_cents        INTEGER NOT NULL,
  paused                   INTEGER NOT NULL DEFAULT 0,
  updated_at               TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    TEXT NOT NULL REFERENCES users(id),
  actor      TEXT NOT NULL,
  event_type TEXT NOT NULL,
  action_id  TEXT,
  detail     TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_events(user_id, id DESC);

-- Dated demo FX rates. rate_micros = units of USD per 1 unit of currency × 1,000,000.
CREATE TABLE IF NOT EXISTS fx_rates (
  currency    TEXT PRIMARY KEY CHECK (currency IN ('USD','EUR','GBP','CAD')),
  rate_micros INTEGER NOT NULL CHECK (rate_micros > 0),
  as_of       TEXT NOT NULL,
  source      TEXT NOT NULL
);
`;

export const CORE_DROP_SQL = /* sql */ `
DROP TABLE IF EXISTS fx_rates;
DROP TABLE IF EXISTS audit_events;
DROP TABLE IF EXISTS user_controls;
DROP TABLE IF EXISTS actions;
DROP TABLE IF EXISTS recipients;
DROP TABLE IF EXISTS transactions;
DROP TABLE IF EXISTS accounts;
DROP TABLE IF EXISTS users;
`;
