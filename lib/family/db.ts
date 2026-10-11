/**
 * Tables and seed data for family cards. Owned by the family module.
 * Kids' cards hang off a parent credit account in the core `accounts` table;
 * approved charges also post to core `transactions` on that account.
 */
import type { DB } from "@/lib/db";
import type { DbModule } from "@/lib/db/modules";
import { postCharge } from "./service";
import type { CardCategory } from "./types";

const SCHEMA_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS family_members (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id),
  name         TEXT NOT NULL,
  age          INTEGER NOT NULL CHECK (age BETWEEN 0 AND 25),
  relationship TEXT NOT NULL DEFAULT 'child' CHECK (relationship = 'child'),
  color        TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_members_user ON family_members(user_id);

CREATE TABLE IF NOT EXISTS family_cards (
  id                       TEXT PRIMARY KEY,
  user_id                  TEXT NOT NULL REFERENCES users(id),
  member_id                TEXT NOT NULL REFERENCES family_members(id),
  parent_account_id        TEXT NOT NULL REFERENCES accounts(id),
  card_mask                TEXT NOT NULL,
  status                   TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','frozen')),
  monthly_limit_cents      INTEGER NOT NULL CHECK (monthly_limit_cents >= 0),
  per_purchase_limit_cents INTEGER NOT NULL CHECK (per_purchase_limit_cents >= 0),
  blocked_categories       TEXT NOT NULL DEFAULT '[]',
  alert_threshold_pct      INTEGER NOT NULL DEFAULT 80,
  created_at               TEXT NOT NULL,
  updated_at               TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_cards_user ON family_cards(user_id);

CREATE TABLE IF NOT EXISTS family_charges (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id),
  card_id        TEXT NOT NULL REFERENCES family_cards(id),
  posted_at      TEXT NOT NULL,
  merchant       TEXT NOT NULL,
  category       TEXT NOT NULL,
  amount_cents   INTEGER NOT NULL CHECK (amount_cents > 0),
  status         TEXT NOT NULL CHECK (status IN ('approved','declined')),
  decline_reason TEXT,
  transaction_id TEXT,
  CHECK ((status = 'approved') = (decline_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_charges_card ON family_charges(user_id, card_id, posted_at DESC);
`;

const DROP_SQL = /* sql */ `
DROP TABLE IF EXISTS family_charges;
DROP TABLE IF EXISTS family_cards;
DROP TABLE IF EXISTS family_members;
`;

const DAY_MS = 86_400_000;
type SeedCharge = [daysAgo: number, merchant: string, category: CardCategory, cents: number];

/** Seed history. Current-month charges are clamped into this month. */
const MAYA: SeedCharge[] = [
  [1, "Chipotle", "dining", 1_485], [2, "Sephora", "shopping", 3_900], [3, "Uber", "transport", 1_820],
  [4, "AMC Theatres", "entertainment", 2_450], [5, "Spotify", "subscriptions", 1_199], [6, "Target", "shopping", 4_675],
  [8, "Starbucks", "dining", 735], [9, "Barnes & Noble", "education", 2_899], [11, "Urban Outfitters", "shopping", 6_240],
  [13, "Sweetgreen", "dining", 1_650], [14, "Lyft", "transport", 2_210], [16, "Taco Bell", "dining", 1_120],
  [35, "Spotify", "subscriptions", 1_199], [38, "Target", "shopping", 3_420], [42, "Chipotle", "dining", 1_390],
];
const LEO: SeedCharge[] = [
  [1, "GameStop", "shopping", 1_999], [3, "Shake Shack", "dining", 1_340], [6, "Scholastic", "education", 1_250],
  [9, "Dunkin'", "dining", 690], [12, "Target", "shopping", 1_099], [36, "Scholastic", "education", 899],
];

function seedFamily(db: DB, asOf: Date): void {
  const now = asOf.toISOString();
  const dom = asOf.getUTCDate();
  const monthStart = Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), 1);
  // Days 0–30 land in the current month (clamped); older entries stay in earlier months.
  const at = (daysAgo: number, seq: number) => {
    const d = daysAgo < 30 ? Math.min(daysAgo, dom - 1) : daysAgo;
    const t = Math.max(asOf.getTime() - d * DAY_MS - (seq % 300) * 60_000, daysAgo < 30 ? monthStart : 0);
    return new Date(t).toISOString();
  };

  db.prepare(`INSERT INTO accounts
    (id, user_id, institution, name, type, mask, balance_cents, available_cents, capabilities, is_paper, updated_at)
    VALUES ('acct_alice_family_card', 'alice', 'Onera Demo Bank', 'Family Rewards Card', 'credit', '2207', 0, 0, '["view"]', 0, ?)`).run(now);

  const insMember = db.prepare(`INSERT INTO family_members (id, user_id, name, age, color, created_at) VALUES (?, 'alice', ?, ?, ?, ?)`);
  insMember.run("fm_alice_maya", "Maya", 16, "violet", now);
  insMember.run("fm_alice_leo", "Leo", 12, "amber", now);

  const insCard = db.prepare(`INSERT INTO family_cards
    (id, user_id, member_id, parent_account_id, card_mask, monthly_limit_cents, per_purchase_limit_cents,
     blocked_categories, alert_threshold_pct, created_at, updated_at)
    VALUES (?, 'alice', ?, 'acct_alice_family_card', ?, ?, ?, ?, 80, ?, ?)`);
  insCard.run("fc_alice_maya", "fm_alice_maya", "3318", 35_000, 7_500, "[]", now, now);
  insCard.run("fc_alice_leo", "fm_alice_leo", "6642", 15_000, 4_000, JSON.stringify(["gaming"]), now, now);

  const seed = (cardId: string, items: SeedCharge[]) =>
    items.forEach(([days, merchant, category, cents], i) =>
      postCharge(db, "alice", cardId, { merchant, category, amountCents: cents }, at(days, i), { audit: false, enforce: false }));
  seed("fc_alice_maya", MAYA);
  seed("fc_alice_leo", LEO);
  // A declined attempt in Leo's history: gaming is blocked.
  postCharge(db, "alice", "fc_alice_leo", { merchant: "Roblox", category: "gaming", amountCents: 4_999 }, at(2, 99), { audit: false });

  // Last month's statement was paid; the card balance is this month's spend.
  const { total } = db.prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM family_charges
    WHERE user_id = 'alice' AND status = 'approved' AND posted_at >= ?`).get(new Date(monthStart).toISOString()) as { total: number };
  db.prepare(`UPDATE accounts SET balance_cents = ?, available_cents = ? WHERE id = 'acct_alice_family_card'`).run(-total, -total);
}

export const familyModule: DbModule = {
  name: "family",
  schemaSql: SCHEMA_SQL,
  dropSql: DROP_SQL,
  seed: seedFamily,
};
