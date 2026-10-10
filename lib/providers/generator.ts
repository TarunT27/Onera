/**
 * Deterministic synthetic history for the simulated connectors.
 *
 * The simulated "bank" for (user, institution) is a pure function of time:
 * every scheduled occurrence is anchored to absolute UTC days and keyed by a
 * seeded PRNG (no Math.random). A sync asks for the provider events that
 * happened in a time window, Plaid-style:
 *
 *   added    — a new transaction (pending or posted)
 *   modified — a pending transaction posted (restaurant tips change the amount)
 *   removed  — a pending authorization hold was dropped
 *
 * Because the stream depends only on time, syncing in many small steps or one
 * big step converges on the same rows.
 */
import type { CurrencyCode, TransactionStatus, UserId } from "@/lib/types";
import {
  findProfile,
  slugOf,
  USER_WORLD,
  type AccountTemplate,
  type AmountSpec,
  type InstitutionProfile,
  type Schedule,
  type TxStream,
  type WorldOverride,
} from "./catalog";
import { draw, drawInt } from "./prng";

export const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** Synced history on first link. */
export const HISTORY_DAYS = 90;
/** Pending authorization holds are removed this long after they appear (and the final charge posts). */
export const HOLD_REMOVAL_MS = 26 * HOUR_MS;
/** Pending card/debit purchases post 24–48h after they appear. */
const POST_DELAY_MIN_MS = 24 * HOUR_MS;
const POST_DELAY_RANGE_MS = 24 * HOUR_MS;
/** Upper bound on how long after an occurrence its last event can arrive. */
export const MAX_EVENT_LAG_MS = 3 * DAY_MS;

export interface TxSnapshot {
  postedAt: string;
  description: string;
  merchant: string | null;
  category: string;
  amountCents: number;
  currency: CurrencyCode;
  status: TransactionStatus;
  transferGroupId: string | null;
}

export type Lifecycle =
  | { type: "posted"; amountCents: number }
  | { type: "pending_post"; pendingCents: number; finalCents: number; postAtMs: number }
  | { type: "hold"; amountCents: number; removeAtMs: number };

export interface Occurrence {
  accountKey: string;
  providerTxId: string;
  atMs: number;
  description: string;
  merchant: string | null;
  category: string;
  currency: CurrencyCode;
  transferGroupId: string | null;
  lifecycle: Lifecycle;
  /** Card purchase that counts toward the statement balance. */
  purchase: boolean;
}

export type ProviderEventType = "added" | "modified" | "removed";

export interface ProviderEvent {
  type: ProviderEventType;
  accountKey: string;
  providerTxId: string;
  atMs: number;
  /** Full transaction state after the event; null for removals. */
  tx: TxSnapshot | null;
}

export interface World {
  userId: UserId;
  profile: InstitutionProfile;
  accounts: AccountTemplate[];
  override: WorldOverride | undefined;
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export function worldFor(userId: UserId, institutionId: string): World | null {
  const profile = findProfile(institutionId);
  if (!profile) return null;
  const override = USER_WORLD[userId]?.[institutionId];
  const accounts = override?.accounts
    ? profile.accounts.filter((a) => override.accounts!.includes(a.key))
    : profile.accounts;
  return { userId, profile, accounts, override };
}

const hasAccount = (w: World, key: string) => w.accounts.some((a) => a.key === key);
const instId = (w: World) => w.profile.institution.id;

export function maskFor(userId: UserId, institutionId: string, key: string): string {
  return String(drawInt(1000, 9999, "mask", userId, institutionId, key));
}

/** Per-user scale (0.85–1.15) so two users at the same bank see different amounts. */
function userScale(w: World, streamId: string): number {
  return 0.85 + 0.3 * draw("scale", w.userId, instId(w), streamId);
}

export function depositOpeningCents(w: World, t: AccountTemplate): number {
  return Math.round(((t.openingCents ?? 0) * userScale(w, `open:${t.key}`)) / 100) * 100;
}

// ---------------------------------------------------------------------------
// Schedules and amounts
// ---------------------------------------------------------------------------

const dayOf = (ms: number) => Math.floor(ms / DAY_MS);

/** Occurrence days (with index k) of a schedule within [fromDay, toDay]. */
function scheduleDays(w: World, streamId: string, s: Schedule, fromDay: number, toDay: number) {
  const out: { k: number; day: number }[] = [];
  if (s.kind === "every") {
    const phase = Math.floor(draw("phase", w.userId, instId(w), streamId) * s.days);
    const kMin = Math.floor((fromDay - s.jitter - phase) / s.days) - 1;
    const kMax = Math.floor((toDay - phase) / s.days) + 1;
    for (let k = kMin; k <= kMax; k++) {
      const jitter = Math.floor(draw("jitter", w.userId, instId(w), streamId, k) * (s.jitter + 1));
      const day = k * s.days + phase + jitter;
      if (day >= fromDay && day <= toDay) out.push({ k, day });
    }
  } else {
    const from = new Date(fromDay * DAY_MS);
    let y = from.getUTCFullYear();
    let m = from.getUTCMonth() - 1;
    for (;;) {
      const day = dayOf(Date.UTC(y, m, s.day));
      if (day > toDay) break;
      if (day >= fromDay) out.push({ k: y * 12 + m, day });
      m++;
      if (m > 11) { m = 0; y++; }
    }
  }
  return out;
}

/** Positive magnitude in minor units. */
function magnitude(w: World, streamId: string, spec: AmountSpec, k: number, outflow: boolean): number {
  if ("fixed" in spec) return spec.fixed; // stable prices, same for everyone
  const scale = userScale(w, streamId);
  if (spec.spread === 0) return Math.round((spec.base * scale) / 100) * 100;
  let m = Math.round((spec.base + draw("amount", w.userId, instId(w), streamId, k) * spec.spread) * scale);
  // Parity of the last cent follows k: consecutive charges never repeat an amount.
  if (outflow) m = m - (m % 2) + (Math.abs(k) % 2);
  return Math.max(m, 1);
}

function timeOfDay(w: World, streamId: string, k: number, fromHour: number, toHour: number): number {
  return Math.floor((fromHour + draw("tod", w.userId, instId(w), streamId, k) * (toHour - fromHour)) * HOUR_MS);
}

const providerId = (w: World, streamId: string, k: number, suffix = "") =>
  `${slugOf(instId(w))}-${streamId}-${k}${suffix}`;

const groupId = (w: World, streamId: string, k: number) =>
  `tg_${w.userId}_${slugOf(instId(w))}_${streamId}_${k}`;

// ---------------------------------------------------------------------------
// Occurrences
// ---------------------------------------------------------------------------

function txStreamOccurrences(w: World, s: TxStream, fromDay: number, toDay: number): Occurrence[] {
  if (!hasAccount(w, s.account)) return [];
  const currency = w.profile.institution.currency;
  const outflow = s.direction === "out";
  const sign = outflow ? -1 : 1;
  const card = w.accounts.find((a) => a.key === s.account)?.type === "credit";
  const out: Occurrence[] = [];
  for (const { k, day } of scheduleDays(w, s.id, s.schedule, fromDay, toDay)) {
    const base = {
      accountKey: s.account,
      description: s.description,
      merchant: s.merchant,
      category: s.category,
      currency,
      transferGroupId: null,
      purchase: card && outflow,
    };
    const amount = magnitude(w, s.id, s.amount, k, outflow);
    if (s.lifecycle === "posted") {
      const [h0, h1] = outflow ? [7, 11] : [6, 7];
      out.push({ ...base, providerTxId: providerId(w, s.id, k), atMs: day * DAY_MS + timeOfDay(w, s.id, k, h0, h1),
        lifecycle: { type: "posted", amountCents: sign * amount } });
      continue;
    }
    const atMs = day * DAY_MS + timeOfDay(w, s.id, k, 8, 21);
    if (s.hold && draw("hold", w.userId, instId(w), s.id, k) < s.hold.chance) {
      // Authorization hold appears pending, is removed, and the final charge posts at removal time.
      out.push({ ...base, purchase: false, providerTxId: providerId(w, s.id, k, "-auth"), atMs,
        description: s.hold.description,
        lifecycle: { type: "hold", amountCents: -s.hold.amountCents, removeAtMs: atMs + HOLD_REMOVAL_MS } });
      out.push({ ...base, providerTxId: providerId(w, s.id, k), atMs: atMs + HOLD_REMOVAL_MS,
        lifecycle: { type: "posted", amountCents: sign * amount } });
      continue;
    }
    const pending = s.tipPct ? Math.round(amount / (1 + s.tipPct)) : amount;
    const postAtMs = atMs + POST_DELAY_MIN_MS + Math.floor(draw("post", w.userId, instId(w), s.id, k) * POST_DELAY_RANGE_MS);
    out.push({ ...base, providerTxId: providerId(w, s.id, k), atMs,
      lifecycle: { type: "pending_post", pendingCents: sign * pending, finalCents: sign * amount, postAtMs } });
  }
  return out;
}

/** Card purchases (final amounts) in [fromMs, toMs). */
function cardPurchasesCents(w: World, cardKey: string, fromMs: number, toMs: number): number {
  let total = 0;
  for (const s of w.profile.streams) {
    if (s.kind !== "tx" || s.account !== cardKey || s.direction !== "out") continue;
    for (const o of txStreamOccurrences(w, s, dayOf(fromMs) - 2, dayOf(toMs))) {
      if (!o.purchase || o.atMs < fromMs || o.atMs >= toMs) continue;
      const l = o.lifecycle;
      total += -(l.type === "pending_post" ? l.finalCents : l.type === "posted" ? l.amountCents : 0);
    }
  }
  return total;
}

interface CardPayment {
  k: number;
  cycleStartMs: number;
  cycleEndMs: number;
  amountCents: number;
  debitAtMs: number;
  creditAtMs: number;
}

/** How a card is paid in this user's world: same-institution autopay or a cross-institution payer. */
function cardPlan(w: World, cardKey: string): { streamId: string; day: number; lagDays: number; payer: { institutionId: string; account: string } } | null {
  const cross = w.override?.cardPayer;
  if (cross && cross.card === cardKey) {
    return { streamId: "xpay", day: cross.day, lagDays: cross.lagDays,
      payer: { institutionId: cross.institutionId, account: cross.account } };
  }
  const s = w.profile.streams.find((x) => x.kind === "card_payment" && x.card === cardKey);
  if (!s || s.kind !== "card_payment" || !hasAccount(w, s.payer)) return null;
  return { streamId: s.id, day: s.day, lagDays: 0, payer: { institutionId: instId(w), account: s.payer } };
}

/** Monthly autopay of the previous statement cycle [day P of month k-1, day P of month k). */
function cardPayments(w: World, cardKey: string, fromDay: number, toDay: number): CardPayment[] {
  const plan = cardPlan(w, cardKey);
  if (!plan) return [];
  const out: CardPayment[] = [];
  // Payment days whose debit or (lagged) credit can land in the window.
  for (const { k, day } of scheduleDays(w, plan.streamId, { kind: "monthly", day: plan.day }, fromDay - plan.lagDays - 1, toDay)) {
    const y = Math.floor(k / 12);
    const m = k % 12;
    const cycleStartMs = Date.UTC(y, m - 1, plan.day);
    const cycleEndMs = day * DAY_MS;
    const amountCents = cardPurchasesCents(w, cardKey, cycleStartMs, cycleEndMs);
    if (amountCents <= 0) continue;
    const debitAtMs = day * DAY_MS + timeOfDay(w, plan.streamId, k, 9, 10);
    const creditAtMs = plan.lagDays === 0
      ? debitAtMs
      : (day + plan.lagDays) * DAY_MS + timeOfDay(w, `${plan.streamId}:in`, k, 6, 7);
    out.push({ k, cycleStartMs, cycleEndMs, amountCents, debitAtMs, creditAtMs });
  }
  return out;
}

/**
 * All occurrences for (user, institution) with atMs in [fromMs, toMs).
 * Includes transfers, card autopay legs and cross-institution payer legs.
 */
export function occurrencesBetween(userId: UserId, institutionId: string, fromMs: number, toMs: number): Occurrence[] {
  const w = worldFor(userId, institutionId);
  if (!w) return [];
  const fromDay = dayOf(fromMs) - 3;
  const toDay = dayOf(toMs);
  const currency = w.profile.institution.currency;
  const out: Occurrence[] = [];
  const mask = (key: string) => maskFor(userId, institutionId, key);

  for (const s of w.profile.streams) {
    if (s.kind === "tx") {
      out.push(...txStreamOccurrences(w, s, fromDay, toDay));
    } else if (s.kind === "transfer") {
      if (!hasAccount(w, s.from) || !hasAccount(w, s.to)) continue;
      for (const { k, day } of scheduleDays(w, s.id, s.schedule, fromDay, toDay)) {
        const atMs = day * DAY_MS + timeOfDay(w, s.id, k, 9, 10);
        const g = groupId(w, s.id, k);
        const fill = (d: string) => d.replace("{toMask}", mask(s.to)).replace("{fromMask}", mask(s.from));
        const leg = { merchant: null, category: "transfer", currency, transferGroupId: g, purchase: false, atMs };
        out.push({ ...leg, accountKey: s.from, providerTxId: providerId(w, s.id, k, "-out"),
          description: fill(s.outDescription), lifecycle: { type: "posted", amountCents: -s.amountCents } });
        out.push({ ...leg, accountKey: s.to, providerTxId: providerId(w, s.id, k, "-in"),
          description: fill(s.inDescription), lifecycle: { type: "posted", amountCents: s.amountCents } });
      }
    }
  }

  // Card autopay: credit legs on this institution's cards (and debit legs when paid in-house).
  for (const card of w.accounts.filter((a) => a.type === "credit")) {
    const plan = cardPlan(w, card.key);
    if (!plan) continue;
    const sameInstitution = plan.payer.institutionId === institutionId;
    for (const p of cardPayments(w, card.key, fromDay, toDay)) {
      const leg = { merchant: null, category: "transfer", currency, purchase: false };
      const g = sameInstitution ? groupId(w, plan.streamId, p.k) : null;
      out.push({ ...leg, accountKey: card.key, providerTxId: providerId(w, plan.streamId, p.k, "-in"),
        atMs: p.creditAtMs, transferGroupId: g, description: "AUTOPAY PAYMENT — THANK YOU",
        lifecycle: { type: "posted", amountCents: p.amountCents } });
      if (sameInstitution) {
        out.push({ ...leg, accountKey: plan.payer.account, providerTxId: providerId(w, plan.streamId, p.k, "-out"),
          atMs: p.debitAtMs, transferGroupId: g, description: `Credit card autopay ••${mask(card.key)}`,
          lifecycle: { type: "posted", amountCents: -p.amountCents } });
      }
    }
  }

  // Cross-institution payer legs: cards at other institutions autopaid from an account here.
  for (const [cardInstitutionId, o] of Object.entries(USER_WORLD[userId] ?? {})) {
    const cross = o?.cardPayer;
    if (!cross || cross.institutionId !== institutionId || !hasAccount(w, cross.account)) continue;
    const cw = worldFor(userId, cardInstitutionId);
    if (!cw || !hasAccount(cw, cross.card)) continue;
    const cardMask = maskFor(userId, cardInstitutionId, cross.card);
    for (const p of cardPayments(cw, cross.card, fromDay, toDay)) {
      out.push({ accountKey: cross.account, providerTxId: providerId(w, `xpay_${slugOf(cardInstitutionId)}`, p.k, "-out"),
        atMs: p.debitAtMs, merchant: null, category: "transfer", currency, transferGroupId: null, purchase: false,
        description: `${cw.profile.institution.name} card payment ••${cardMask}`,
        lifecycle: { type: "posted", amountCents: -p.amountCents } });
    }
  }

  return out.filter((o) => o.atMs >= fromMs && o.atMs < toMs);
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

function snapshot(o: Occurrence, amountCents: number, status: TransactionStatus): TxSnapshot {
  return {
    postedAt: new Date(o.atMs).toISOString(),
    description: o.description,
    merchant: o.merchant,
    category: o.category,
    amountCents,
    currency: o.currency,
    status,
    transferGroupId: o.transferGroupId,
  };
}

function occurrenceEvents(o: Occurrence): ProviderEvent[] {
  const base = { accountKey: o.accountKey, providerTxId: o.providerTxId };
  const l = o.lifecycle;
  switch (l.type) {
    case "posted":
      return [{ ...base, type: "added", atMs: o.atMs, tx: snapshot(o, l.amountCents, "posted") }];
    case "pending_post":
      return [
        { ...base, type: "added", atMs: o.atMs, tx: snapshot(o, l.pendingCents, "pending") },
        { ...base, type: "modified", atMs: l.postAtMs, tx: snapshot(o, l.finalCents, "posted") },
      ];
    case "hold":
      return [
        { ...base, type: "added", atMs: o.atMs, tx: snapshot(o, l.amountCents, "pending") },
        { ...base, type: "removed", atMs: l.removeAtMs, tx: null },
      ];
  }
}

const TYPE_ORDER: Record<ProviderEventType, number> = { added: 0, modified: 1, removed: 2 };

/**
 * Provider events with atMs in (fromExclusiveMs, toInclusiveMs], limited to
 * transactions that occurred on or after historyStartMs. Sorted by time.
 */
export function eventsBetween(
  userId: UserId,
  institutionId: string,
  historyStartMs: number,
  fromExclusiveMs: number,
  toInclusiveMs: number,
): ProviderEvent[] {
  if (toInclusiveMs <= fromExclusiveMs) return [];
  const occStart = Math.max(historyStartMs, fromExclusiveMs - MAX_EVENT_LAG_MS);
  return occurrencesBetween(userId, institutionId, occStart, toInclusiveMs + 1)
    .flatMap(occurrenceEvents)
    .filter((e) => e.atMs > fromExclusiveMs && e.atMs <= toInclusiveMs)
    .sort((a, b) => a.atMs - b.atMs || a.providerTxId.localeCompare(b.providerTxId) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
}

/**
 * Card balance (negative = owed) at the start of the synced history: purchases
 * already made whose statement payment had not yet arrived.
 */
export function cardOpeningCents(w: World, cardKey: string, historyStartMs: number): number {
  const plan = cardPlan(w, cardKey);
  if (!plan) return 0;
  const startDay = dayOf(historyStartMs);
  let owed = 0;
  for (const p of cardPayments(w, cardKey, startDay - 40, startDay + 40)) {
    if (p.cycleStartMs < historyStartMs && p.creditAtMs >= historyStartMs) {
      owed += cardPurchasesCents(w, cardKey, p.cycleStartMs, Math.min(p.cycleEndMs, historyStartMs));
    }
  }
  return -owed;
}
