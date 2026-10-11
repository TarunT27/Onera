import type { DB } from "@/lib/db";
import type { DbModule } from "@/lib/db/modules";
import { MICROS_PER_SHARE, mulDiv } from "./math";
import { simulateQuote } from "./simulator";

/**
 * Tables and seed data for the markets module. Owned by the markets module.
 * Money is integer cents; share quantities are integer micro-shares.
 */
const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS positions (
  user_id          TEXT NOT NULL REFERENCES users(id),
  account_id       TEXT NOT NULL REFERENCES accounts(id),
  symbol           TEXT NOT NULL,
  quantity_micros  INTEGER NOT NULL CHECK (quantity_micros > 0),
  cost_basis_cents INTEGER NOT NULL CHECK (cost_basis_cents >= 0),
  updated_at       TEXT NOT NULL,
  UNIQUE (account_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);

CREATE TABLE IF NOT EXISTS trading_controls (
  user_id                 TEXT PRIMARY KEY REFERENCES users(id),
  per_order_limit_cents   INTEGER NOT NULL CHECK (per_order_limit_cents >= 0),
  daily_order_limit_cents INTEGER NOT NULL CHECK (daily_order_limit_cents >= 0),
  updated_at              TEXT NOT NULL
);

-- Bounded authority for a background agent to place paper buy orders. Created and revoked by the user only.
CREATE TABLE IF NOT EXISTS mandates (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  agent_id        TEXT NOT NULL,
  account_id      TEXT NOT NULL REFERENCES accounts(id),
  symbols         TEXT NOT NULL,          -- JSON array of symbols
  side            TEXT NOT NULL DEFAULT 'buy' CHECK (side = 'buy'),
  max_order_cents INTEGER NOT NULL CHECK (max_order_cents > 0),
  max_daily_cents INTEGER NOT NULL CHECK (max_daily_cents > 0),
  expires_at      TEXT NOT NULL,
  revoked_at      TEXT,
  created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mandates_user ON mandates(user_id, created_at DESC);

-- An account linked to Alpaca. Created only by the signed-in user ("Connect Alpaca").
-- Keys live in the server environment, never here.
CREATE TABLE IF NOT EXISTS broker_links (
  account_id          TEXT PRIMARY KEY REFERENCES accounts(id),
  user_id             TEXT NOT NULL REFERENCES users(id),
  broker              TEXT NOT NULL CHECK (broker = 'alpaca'),
  env                 TEXT NOT NULL CHECK (env IN ('paper','live')),
  external_account_id TEXT NOT NULL,      -- Alpaca account UUID
  account_number_mask TEXT NOT NULL,      -- last 4 of the Alpaca account number
  connected_at        TEXT NOT NULL,
  last_synced_at      TEXT,
  last_sync_error     TEXT,
  UNIQUE (user_id, env)
);

-- Market data cache (Alpaca mode). Shared by the web server and the worker process.
CREATE TABLE IF NOT EXISTS market_quotes (
  symbol           TEXT PRIMARY KEY,
  price_cents      INTEGER NOT NULL CHECK (price_cents > 0),
  prev_close_cents INTEGER NOT NULL CHECK (prev_close_cents > 0),
  as_of            TEXT NOT NULL,         -- trade time
  fetched_at       TEXT NOT NULL,
  source           TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS market_bars (
  symbol      TEXT NOT NULL,
  date        TEXT NOT NULL,              -- UTC YYYY-MM-DD
  close_cents INTEGER NOT NULL CHECK (close_cents > 0),
  source      TEXT NOT NULL,
  PRIMARY KEY (symbol, date)
);
-- Searchable US equities from Alpaca (Alpaca mode only; refreshed daily). Catalog symbols live in code.
CREATE TABLE IF NOT EXISTS market_assets (
  symbol       TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  exchange     TEXT,
  type         TEXT NOT NULL CHECK (type IN ('stock','etf')),
  fractionable INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_market_assets_name ON market_assets(name);

-- Symbols a user added to their Trade watchlist (on top of the built-in catalog).
CREATE TABLE IF NOT EXISTS watchlist (
  user_id  TEXT NOT NULL REFERENCES users(id),
  symbol   TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS market_data_state (
  key        TEXT PRIMARY KEY,            -- 'clock' | 'bars:<SYMBOL>'
  value      TEXT NOT NULL,               -- JSON
  fetched_at TEXT NOT NULL
);

-- Orders mirror the actions table lifecycle; Alpaca orders add SUBMITTING/SUBMITTED/CANCELED.
CREATE TABLE IF NOT EXISTS orders (
  id                 TEXT PRIMARY KEY,
  user_id            TEXT NOT NULL REFERENCES users(id),
  state              TEXT NOT NULL CHECK (state IN
                       ('PROPOSED','HELD','AWAITING_APPROVAL','APPROVED','SUBMITTING','SUBMITTED',
                        'EXECUTED','CANCELED','FAILED')),
  venue              TEXT NOT NULL DEFAULT 'onera_paper'
                       CHECK (venue IN ('onera_paper','alpaca_paper','alpaca_live')),
  version            INTEGER NOT NULL DEFAULT 1,
  account_id         TEXT NOT NULL REFERENCES accounts(id),
  symbol             TEXT NOT NULL,
  side               TEXT NOT NULL CHECK (side IN ('buy','sell')),
  quantity_micros    INTEGER CHECK (quantity_micros IS NULL OR quantity_micros > 0),
  notional_cents     INTEGER CHECK (notional_cents IS NULL OR notional_cents > 0),
  quote_price_cents  INTEGER,             -- quote captured at evaluation
  price_bound_cents  INTEGER,             -- buy: max price; sell: min price
  created_by         TEXT NOT NULL CHECK (created_by IN ('user','assistant') OR created_by LIKE 'agent:_%'),
  mandate_id         TEXT REFERENCES mandates(id),
  hold_reasons       TEXT NOT NULL DEFAULT '[]',
  policy             TEXT,                -- JSON OrderPolicyResult from last evaluation
  approval_hash      TEXT,                -- server-computed; never sent to clients
  approved_version   INTEGER,
  approved_at        TEXT,
  approved_by        TEXT,                -- 'user:<id>' | 'mandate:<id>'
  fill               TEXT,                -- JSON OrderFill
  filled_gross_cents INTEGER,             -- cash moved by the fill; used for daily limits
  executed_at        TEXT,
  failure_reason     TEXT,
  -- Alpaca only. client_order_id = '<id>-v<version>' makes a submission idempotent at the broker.
  client_order_id          TEXT UNIQUE,
  broker_order_id          TEXT,
  broker_status            TEXT,
  broker_qty_micros        INTEGER,       -- quantity sent (notional buys converted at the price bound)
  broker_filled_qty_micros INTEGER,
  reserved_cents           INTEGER,       -- worst-case value held against the daily limit while open
  submitted_at             TEXT,
  cancel_requested_at      TEXT,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL,
  -- Exactly one sizing field.
  CHECK ((quantity_micros IS NULL) <> (notional_cents IS NULL)),
  -- No shorting via notional sells: sells are by quantity.
  CHECK (side = 'buy' OR quantity_micros IS NOT NULL),
  -- An executed order carries exactly one fill.
  CHECK ((state = 'EXECUTED') = (fill IS NOT NULL AND executed_at IS NOT NULL AND filled_gross_cents IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_mandate ON orders(mandate_id, executed_at);
CREATE INDEX IF NOT EXISTS idx_orders_open ON orders(state) WHERE state IN ('SUBMITTING','SUBMITTED');
`;

const DROP_SQL = /* sql */ `
DROP TABLE IF EXISTS orders;
DROP TABLE IF EXISTS market_data_state;
DROP TABLE IF EXISTS watchlist;
DROP TABLE IF EXISTS market_assets;
DROP TABLE IF EXISTS market_bars;
DROP TABLE IF EXISTS market_quotes;
DROP TABLE IF EXISTS broker_links;
DROP TABLE IF EXISTS mandates;
DROP TABLE IF EXISTS trading_controls;
DROP TABLE IF EXISTS positions;
`;

/** Default trading controls for the demo users. */
export const DEFAULT_TRADING_CONTROLS = { perOrderLimitCents: 50_000, dailyOrderLimitCents: 100_000 };

interface SeedHolding {
  accountId: string;
  symbol: string;
  /** Market value at seed-time simulated prices. */
  targetValueCents: number;
  /** Cost basis as a percentage of that value (100 = break-even). */
  costBasisPct: number;
}

/** Alice's Northwind import (~$355,000, view-only) and a small paper position. */
const SEED_HOLDINGS: SeedHolding[] = [
  { accountId: "acct_alice_brokerage", symbol: "VTI", targetValueCents: 15_000_000, costBasisPct: 82 },
  { accountId: "acct_alice_brokerage", symbol: "AAPL", targetValueCents: 7_800_000, costBasisPct: 64 },
  { accountId: "acct_alice_brokerage", symbol: "MSFT", targetValueCents: 7_000_000, costBasisPct: 71 },
  { accountId: "acct_alice_brokerage", symbol: "BND", targetValueCents: 5_700_000, costBasisPct: 104 },
  { accountId: "acct_alice_paper", symbol: "VOO", targetValueCents: 60_000, costBasisPct: 97 },
];

function seedMarkets(db: DB, asOf: Date): void {
  const now = asOf.toISOString();
  const owner = db.prepare("SELECT user_id FROM accounts WHERE id = ?");
  const insPosition = db.prepare(
    `INSERT INTO positions (user_id, account_id, symbol, quantity_micros, cost_basis_cents, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const h of SEED_HOLDINGS) {
    const account = owner.get(h.accountId) as { user_id: string } | undefined;
    const quote = simulateQuote(h.symbol, asOf);
    if (!account || !quote) continue;
    // Whole thousandths of a share, sized to the target value at seed-time prices.
    const quantityMicros = mulDiv(h.targetValueCents, MICROS_PER_SHARE / 1_000, quote.priceCents, "round") * 1_000;
    const costBasisCents = mulDiv(h.targetValueCents, h.costBasisPct, 100, "round");
    insPosition.run(account.user_id, h.accountId, h.symbol, quantityMicros, costBasisCents, now);
  }

  const insControls = db.prepare(
    `INSERT INTO trading_controls (user_id, per_order_limit_cents, daily_order_limit_cents, updated_at)
     VALUES (?, ?, ?, ?)`,
  );
  const users = db.prepare("SELECT id FROM users ORDER BY id").all() as { id: string }[];
  for (const u of users) {
    insControls.run(u.id, DEFAULT_TRADING_CONTROLS.perOrderLimitCents, DEFAULT_TRADING_CONTROLS.dailyOrderLimitCents, now);
  }
  // No mandates are seeded: autonomous trading always starts with an explicit user grant.
}

export const marketsModule: DbModule = {
  name: "markets",
  schemaSql: SCHEMA_SQL,
  dropSql: DROP_SQL,
  seed: seedMarkets,
};
