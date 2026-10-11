/**
 * Family cards service. Every function takes the session user ID; another
 * user's cards are "not found". Only the parent (the signed-in user) changes
 * limits or freezes a card — no agent or assistant tool can.
 */
import { randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { notFound } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import { decidePurchase } from "./policy";
import {
  CARD_CATEGORIES,
  SimulatePurchaseSchema,
  UpdateCardSchema,
  type CardCategory,
  type CardCharge,
  type DeclineReason,
  type FamilyAlert,
  type FamilyCard,
  type FamilyMember,
  type FamilyOverview,
  type SimulatePurchaseInput,
} from "./types";
import { msg } from "@/lib/i18n/msg";

interface CardRow {
  id: string;
  user_id: string;
  member_id: string;
  parent_account_id: string;
  card_mask: string;
  status: "active" | "frozen";
  monthly_limit_cents: number;
  per_purchase_limit_cents: number;
  blocked_categories: string;
  alert_threshold_pct: number;
  m_name: string;
  m_age: number;
  m_color: FamilyMember["color"];
  a_name: string;
  a_institution: string;
  a_mask: string;
}

interface ChargeRow {
  id: string;
  card_id: string;
  posted_at: string;
  merchant: string;
  category: CardCategory;
  amount_cents: number;
  status: "approved" | "declined";
  decline_reason: DeclineReason | null;
  transaction_id: string | null;
}

const CARD_SELECT = /* sql */ `
  SELECT c.*, m.name AS m_name, m.age AS m_age, m.color AS m_color,
         a.name AS a_name, a.institution AS a_institution, a.mask AS a_mask
  FROM family_cards c
  JOIN family_members m ON m.id = c.member_id AND m.user_id = c.user_id
  JOIN accounts a ON a.id = c.parent_account_id AND a.user_id = c.user_id`;

const monthStartIso = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

function loadCardRow(db: DB, userId: UserId, cardId: string): CardRow {
  const row = db.prepare(`${CARD_SELECT} WHERE c.id = ? AND c.user_id = ?`).get(cardId, userId);
  if (!row) throw notFound("Card");
  return row as CardRow;
}

function spentThisMonth(db: DB, userId: UserId, cardId: string, now: Date): number {
  const { total } = db
    .prepare(`SELECT COALESCE(SUM(amount_cents), 0) AS total FROM family_charges
              WHERE user_id = ? AND card_id = ? AND status = 'approved' AND posted_at >= ?`)
    .get(userId, cardId, monthStartIso(now)) as { total: number };
  return total;
}

const toCharge = (r: ChargeRow): CardCharge => ({
  id: r.id,
  cardId: r.card_id,
  postedAt: r.posted_at,
  merchant: r.merchant,
  category: r.category,
  amountCents: r.amount_cents,
  status: r.status,
  declineReason: r.decline_reason,
  transactionId: r.transaction_id,
});

function toCard(db: DB, userId: UserId, row: CardRow, now: Date): FamilyCard {
  const start = monthStartIso(now);
  const monthRows = db
    .prepare(`SELECT * FROM family_charges WHERE user_id = ? AND card_id = ? AND posted_at >= ?`)
    .all(userId, row.id, start) as ChargeRow[];
  const approved = monthRows.filter((r) => r.status === "approved");
  const spent = approved.reduce((s, r) => s + r.amount_cents, 0);
  const byCat = new Map<CardCategory, number>();
  for (const r of approved) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount_cents);
  const declined = monthRows.length - approved.length;
  const pctUsed = row.monthly_limit_cents > 0 ? Math.round((spent / row.monthly_limit_cents) * 1000) / 10 : 0;

  const alerts: FamilyAlert[] = [];
  if (row.status === "frozen") alerts.push({ level: "info", message: msg("Card is frozen. New purchases are declined until you unfreeze it.") });
  if (pctUsed >= 100) alerts.push({ level: "critical", message: msg("Monthly limit reached. New purchases will be declined.") });
  else if (pctUsed >= row.alert_threshold_pct) alerts.push({ level: "warning", message: `${Math.round(pctUsed)}% of the monthly limit used.` });
  if (declined > 0) alerts.push({ level: "info", message: `${declined} declined purchase${declined === 1 ? "" : "s"} this month.` });

  const recent = db
    .prepare(`SELECT * FROM family_charges WHERE user_id = ? AND card_id = ? ORDER BY posted_at DESC, id DESC LIMIT 15`)
    .all(userId, row.id) as ChargeRow[];

  return {
    id: row.id,
    member: { id: row.member_id, name: row.m_name, age: row.m_age, relationship: "child", color: row.m_color },
    cardMask: row.card_mask,
    parentAccount: { id: row.parent_account_id, name: row.a_name, institution: row.a_institution, mask: row.a_mask },
    status: row.status,
    monthlyLimitCents: row.monthly_limit_cents,
    perPurchaseLimitCents: row.per_purchase_limit_cents,
    blockedCategories: JSON.parse(row.blocked_categories),
    alertThresholdPct: row.alert_threshold_pct,
    month: start.slice(0, 7),
    spentThisMonthCents: spent,
    remainingCents: Math.max(0, row.monthly_limit_cents - spent),
    pctUsed,
    byCategory: [...byCat.entries()]
      .map(([category, totalCents]) => ({ category, totalCents }))
      .sort((a, b) => b.totalCents - a.totalCents),
    declinedThisMonth: declined,
    recent: recent.map(toCharge),
    alerts,
    simulated: true,
  };
}

export function listFamilyCards(db: DB, userId: UserId, now: Date = new Date()): FamilyOverview {
  const rows = db.prepare(`${CARD_SELECT} WHERE c.user_id = ? ORDER BY m.age DESC, c.id`).all(userId) as CardRow[];
  return { cards: rows.map((r) => toCard(db, userId, r, now)), categories: CARD_CATEGORIES, asOf: now.toISOString() };
}

export function getFamilyCard(db: DB, userId: UserId, cardId: string, now: Date = new Date()): FamilyCard {
  return toCard(db, userId, loadCardRow(db, userId, cardId), now);
}

/** Parent-only settings change: limits, blocked categories, freeze/unfreeze. */
export function updateFamilyCard(db: DB, userId: UserId, cardId: string, input: unknown): FamilyCard {
  const patch = UpdateCardSchema.parse(input);
  const before = loadCardRow(db, userId, cardId);
  db.transaction(() => {
    db.prepare(
      `UPDATE family_cards SET
         monthly_limit_cents = COALESCE(?, monthly_limit_cents),
         per_purchase_limit_cents = COALESCE(?, per_purchase_limit_cents),
         blocked_categories = COALESCE(?, blocked_categories),
         status = COALESCE(?, status),
         alert_threshold_pct = COALESCE(?, alert_threshold_pct),
         updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(
      patch.monthlyLimitCents ?? null,
      patch.perPurchaseLimitCents ?? null,
      patch.blockedCategories ? JSON.stringify([...new Set(patch.blockedCategories)]) : null,
      patch.status ?? null,
      patch.alertThresholdPct ?? null,
      new Date().toISOString(),
      cardId,
      userId,
    );
    const eventType =
      patch.status === "frozen" && before.status !== "frozen" ? "family.card_frozen"
      : patch.status === "active" && before.status !== "active" ? "family.card_unfrozen"
      : "family.card_updated";
    writeAudit(db, { userId, actor: `user:${userId}`, eventType, detail: { cardId, member: before.m_name, patch } });
  })();
  return getFamilyCard(db, userId, cardId);
}

/**
 * Records one purchase on a kid's card. With enforce (the default) the rules
 * decide approve/decline; approved charges post to the parent card account.
 * Runs inside the caller's transaction when there is one.
 */
export function postCharge(
  db: DB,
  userId: UserId,
  cardId: string,
  purchase: SimulatePurchaseInput,
  postedAt: string,
  opts: { audit?: boolean; enforce?: boolean } = {},
): CardCharge {
  const card = loadCardRow(db, userId, cardId);
  const decline = opts.enforce === false
    ? null
    : decidePurchase({
        status: card.status,
        blockedCategories: JSON.parse(card.blocked_categories),
        perPurchaseLimitCents: card.per_purchase_limit_cents,
        monthlyLimitCents: card.monthly_limit_cents,
        spentThisMonthCents: spentThisMonth(db, userId, cardId, new Date(postedAt)),
        category: purchase.category,
        amountCents: purchase.amountCents,
      });
  const id = `fch_${randomBytes(6).toString("hex")}`;
  let transactionId: string | null = null;

  if (!decline) {
    transactionId = `tx_${id}`;
    db.prepare(
      `INSERT INTO transactions (id, account_id, user_id, posted_at, description, merchant, category, amount_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(transactionId, card.parent_account_id, userId, postedAt,
      `${purchase.merchant} · ${card.m_name}'s card ••${card.card_mask}`, purchase.merchant, purchase.category, -purchase.amountCents);
    db.prepare(
      `UPDATE accounts SET balance_cents = balance_cents - ?, available_cents = available_cents - ?, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(purchase.amountCents, purchase.amountCents, postedAt, card.parent_account_id, userId);
  }

  db.prepare(
    `INSERT INTO family_charges (id, user_id, card_id, posted_at, merchant, category, amount_cents, status, decline_reason, transaction_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, cardId, postedAt, purchase.merchant, purchase.category, purchase.amountCents,
    decline ? "declined" : "approved", decline, transactionId);

  if (opts.audit !== false) {
    writeAudit(db, {
      userId, actor: "system", eventType: decline ? "family.charge_declined" : "family.charge_approved",
      detail: { cardId, member: card.m_name, ...purchase, declineReason: decline, simulated: true },
    });
  }
  return toCharge(db.prepare("SELECT * FROM family_charges WHERE id = ?").get(id) as ChargeRow);
}

/** Demo: a kid tries a purchase. Declines are normal outcomes, not errors. */
export function simulateCardPurchase(
  db: DB,
  userId: UserId,
  cardId: string,
  input: unknown,
): { charge: CardCharge; card: FamilyCard } {
  const purchase = SimulatePurchaseSchema.parse(input);
  const charge = db.transaction(() => postCharge(db, userId, cardId, purchase, new Date().toISOString())).immediate();
  return { charge, card: getFamilyCard(db, userId, cardId) };
}
