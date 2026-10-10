/**
 * Simulated aggregation connectors: link, cursor sync, idempotent upsert,
 * internal-transfer matching, connection health and disconnect.
 *
 * Every function takes the session user ID from the server and filters every
 * query on it. Another user's connection is "not found". Nothing here moves
 * money or touches actions/approvals: linked accounts and their transactions
 * are synthetic reads, and transfer capabilities only make an account
 * *eligible* for the governed transfer lifecycle in lib/actions.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { enqueueJob } from "@/lib/agents";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { toAccount, type AccountRow } from "@/lib/db/rows";
import { conflict, notFound } from "@/lib/errors";
import type { Account, AccountCapability, UserId } from "@/lib/types";
import {
  accountIdFor,
  connectionIdFor,
  findProfile,
  PROFILES,
  recipientIdFor,
  slugOf,
  type AccountTemplate,
} from "./catalog";
import {
  cardOpeningCents,
  DAY_MS,
  depositOpeningCents,
  eventsBetween,
  HISTORY_DAYS,
  HOLD_REMOVAL_MS,
  maskFor,
  worldFor,
  type ProviderEvent,
  type World,
} from "./generator";
import { fnv1a } from "./prng";
import type { Connection, ConnectionStatus, Institution, SyncSummary } from "./types";

/**
 * Each sync re-delivers the last 12 hours of events, as real aggregators may
 * repeat webhooks/pages. Must stay below the shortest pending→posted/removed
 * delay so a re-delivered "added" can never resurrect a removed hold.
 */
export const REDELIVERY_OVERLAP_MS = 12 * 3_600_000;
if (REDELIVERY_OVERLAP_MS >= HOLD_REMOVAL_MS) throw new Error("Redelivery overlap must be shorter than hold removal");

/** Legs of a move between the user's own accounts settle within this window. */
export const TRANSFER_MATCH_WINDOW_MS = 3 * DAY_MS;

export const LinkInstitutionSchema = z.object({ institutionId: z.string().min(1).max(64) });
export const SimulateScenarioSchema = z.object({ scenario: z.enum(["login_required", "error"]) });
export type SimulatedScenario = z.infer<typeof SimulateScenarioSchema>["scenario"];

export interface ProviderOpts {
  now?: Date;
  /** Audit actor: "user:<id>" for user requests, "system" for background/seed. */
  actor?: string;
  /** Enqueue downstream review jobs after a sync with new posted transactions. */
  enqueue?: boolean;
}

interface ConnectionRow {
  id: string;
  user_id: string;
  institution_id: string;
  status: ConnectionStatus;
  consent_scopes: string;
  cursor: string | null;
  history_start: string;
  last_synced_at: string | null;
  last_error: string | null;
  sync_count: number;
  created_at: string;
  updated_at: string;
}

const SIMULATED_ERRORS: Record<SimulatedScenario, string> = {
  login_required:
    "Simulated: the institution requires you to sign in again (for example, a changed password or expired MFA). Reconnect to resume syncing.",
  error: "Simulated: the institution is temporarily unavailable. The next sync retries.",
};

// ---------------------------------------------------------------------------
// Institutions
// ---------------------------------------------------------------------------

export function listInstitutions(): Institution[] {
  return PROFILES.map((p) => ({ ...p.institution, products: [...p.institution.products] }));
}

export function getInstitution(institutionId: string): Institution {
  const p = findProfile(institutionId);
  if (!p) throw notFound("Institution");
  return { ...p.institution, products: [...p.institution.products] };
}

function scopesFor(inst: Institution): string[] {
  const base = ["accounts:read", "balances:read", "transactions:read"];
  return inst.supportsTransfers ? [...base, "identity:account_ownership"] : base;
}

/** Visibility never implies transfer support: only USD accounts at transfer-capable institutions. */
export function capabilitiesFor(inst: Institution, t: AccountTemplate): AccountCapability[] {
  if (inst.currency !== "USD" || !inst.supportsTransfers) return ["view"];
  if (t.type === "credit") return ["view", "transfer_destination"];
  return ["view", "transfer_source", "transfer_destination"];
}

// ---------------------------------------------------------------------------
// Connections (scoped reads)
// ---------------------------------------------------------------------------

function loadConnectionRow(db: DB, userId: UserId, connectionId: string): ConnectionRow {
  const row = db.prepare("SELECT * FROM connections WHERE id = ? AND user_id = ?").get(connectionId, userId);
  if (!row) throw notFound("Connection");
  return row as ConnectionRow;
}

function toConnection(db: DB, row: ConnectionRow): Connection {
  const accountIds = (db
    .prepare("SELECT id FROM accounts WHERE user_id = ? AND connection_id = ? ORDER BY id")
    .all(row.user_id, row.id) as { id: string }[]).map((r) => r.id);
  return {
    id: row.id,
    userId: row.user_id as UserId,
    institutionId: row.institution_id,
    institutionName: findProfile(row.institution_id)?.institution.name ?? row.institution_id,
    status: row.status,
    consentScopes: JSON.parse(row.consent_scopes) as string[],
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    accountIds,
    createdAt: row.created_at,
    simulated: true,
  };
}

export function listConnections(db: DB, userId: UserId): Connection[] {
  const rows = db
    .prepare("SELECT * FROM connections WHERE user_id = ? ORDER BY created_at, id")
    .all(userId) as ConnectionRow[];
  return rows.map((r) => toConnection(db, r));
}

export function getConnection(db: DB, userId: UserId, connectionId: string): Connection {
  return toConnection(db, loadConnectionRow(db, userId, connectionId));
}

export function listConnectionAccounts(db: DB, userId: UserId, connectionId: string): Account[] {
  loadConnectionRow(db, userId, connectionId); // ownership check
  const rows = db
    .prepare("SELECT * FROM accounts WHERE user_id = ? AND connection_id = ? ORDER BY type, id")
    .all(userId, connectionId) as AccountRow[];
  return rows.map(toAccount);
}

// ---------------------------------------------------------------------------
// Link
// ---------------------------------------------------------------------------

function requireWorld(userId: UserId, institutionId: string): World {
  const w = worldFor(userId, institutionId);
  if (!w) throw notFound("Institution");
  return w;
}

function externalAccountId(userId: UserId, institutionId: string, key: string): string {
  return `${slugOf(institutionId)}_acc_${fnv1a(`${userId}|${institutionId}|${key}`).toString(36)}`;
}

/**
 * Links a simulated institution: creates (or re-activates) the connection,
 * its accounts and own-account recipients, then runs the initial 90-day sync.
 */
export function link(
  db: DB,
  userId: UserId,
  institutionId: string,
  opts: ProviderOpts = {},
): { connection: Connection; sync: SyncSummary } {
  const w = requireWorld(userId, institutionId);
  const inst = w.profile.institution;
  const now = opts.now ?? new Date();
  const nowIso = now.toISOString();
  const actor = opts.actor ?? `user:${userId}`;

  const sync = db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM connections WHERE user_id = ? AND institution_id = ?")
      .get(userId, institutionId) as ConnectionRow | undefined;
    if (existing && existing.status !== "disconnected") {
      throw conflict("INVALID_STATE", `${inst.name} is already linked`, { connectionId: existing.id, status: existing.status });
    }
    const connectionId = existing?.id ?? connectionIdFor(userId, institutionId);
    const scopes = JSON.stringify(scopesFor(inst));

    if (existing) {
      db.prepare(
        `UPDATE connections SET status = 'healthy', consent_scopes = ?, last_error = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      ).run(scopes, nowIso, connectionId, userId);
    } else {
      const historyStart = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
      db.prepare(
        `INSERT INTO connections (id, user_id, institution_id, status, consent_scopes, cursor, history_start,
           last_synced_at, last_error, sync_count, created_at, updated_at)
         VALUES (?, ?, ?, 'healthy', ?, NULL, ?, NULL, NULL, 0, ?, ?)`,
      ).run(connectionId, userId, institutionId, scopes, historyStart, nowIso, nowIso);
    }
    const row = loadConnectionRow(db, userId, connectionId);
    const historyStartMs = Date.parse(row.history_start);

    const insAccount = db.prepare(
      `INSERT INTO accounts (id, user_id, institution, name, type, currency, mask, balance_cents, available_cents,
         capabilities, connection_id, external_id, is_paper, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET capabilities = excluded.capabilities, updated_at = excluded.updated_at
       WHERE accounts.user_id = excluded.user_id AND accounts.connection_id = excluded.connection_id`,
    );
    const insRecipient = db.prepare(
      `INSERT OR IGNORE INTO recipients (id, user_id, display_name, kind, account_id, details, version,
         verified_version, previous_details, change_note, updated_at)
       VALUES (?, ?, ?, 'own_account', ?, ?, 1, 1, NULL, NULL, ?)`,
    );
    const accountIds: string[] = [];
    for (const t of w.accounts) {
      const id = accountIdFor(userId, institutionId, t.key);
      const mask = maskFor(userId, institutionId, t.key);
      const caps = capabilitiesFor(inst, t);
      const opening = t.type === "credit" ? cardOpeningCents(w, t.key, historyStartMs) : depositOpeningCents(w, t);
      const available = t.type === "credit" ? (t.creditLimitCents ?? 0) + opening : opening;
      insAccount.run(id, userId, inst.name, t.name, t.type, inst.currency, mask, opening, available,
        JSON.stringify(caps), connectionId, externalAccountId(userId, institutionId, t.key), nowIso);
      accountIds.push(id);
      // Ownership of a linked USD account is verified by the (simulated) connection itself.
      if (caps.includes("transfer_destination")) {
        insRecipient.run(
          recipientIdFor(userId, institutionId, t.key), userId,
          `My ${inst.brand} ${t.name} (verified via simulated link)`, id,
          JSON.stringify({ institution: inst.name, accountMask: mask, routingMask: null }), nowIso,
        );
      }
    }

    writeAudit(db, {
      userId, actor, eventType: existing ? "connection.relinked" : "connection.linked",
      detail: { connectionId, institutionId, institution: inst.name, accountIds, consentScopes: scopesFor(inst),
        simulated: true },
    });
    return performSync(db, userId, loadConnectionRow(db, userId, connectionId), now, actor, opts.enqueue ?? true);
  })();

  return { connection: getConnection(db, userId, sync.connectionId), sync };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

const CURSOR_PREFIX = "cur1_";
const encodeCursor = (ms: number) => `${CURSOR_PREFIX}${ms.toString(36)}`;

function decodeCursor(cursor: string | null): number | null {
  if (!cursor?.startsWith(CURSOR_PREFIX)) return null;
  const ms = parseInt(cursor.slice(CURSOR_PREFIX.length), 36);
  return Number.isFinite(ms) ? ms : null;
}

const txIdFor = (accountId: string, providerTxId: string) => `tx_${accountId.slice("acct_".length)}_${providerTxId}`;

export interface ApplyResult {
  added: number;
  modified: number;
  removed: number;
  newTransactionIds: string[];
}

interface ExistingTx {
  id: string;
  status: string;
  amount_cents: number;
  description: string;
  merchant: string | null;
  category: string;
  posted_at: string;
}

/**
 * Applies provider events idempotently. Events are collapsed to the latest
 * state per transaction; "added" never overwrites an existing row (it may be a
 * duplicate or stale delivery), "modified" upserts, "removed" deletes.
 * Applying the same batch twice changes nothing the second time.
 */
export function applyProviderEvents(db: DB, userId: UserId, connectionId: string, events: ProviderEvent[]): ApplyResult {
  const row = loadConnectionRow(db, userId, connectionId);
  const accounts = new Set(
    (db.prepare("SELECT id FROM accounts WHERE user_id = ? AND connection_id = ?").all(userId, connectionId) as { id: string }[])
      .map((r) => r.id),
  );
  const latest = new Map<string, ProviderEvent>();
  for (const e of events) latest.set(`${e.accountKey}|${e.providerTxId}`, e);

  const find = db.prepare(
    `SELECT id, status, amount_cents, description, merchant, category, posted_at FROM transactions
     WHERE user_id = ? AND account_id = ? AND provider_tx_id = ?`,
  );
  const cols = `(id, account_id, user_id, posted_at, description, merchant, category, amount_cents, currency, status,
     transfer_group_id, action_id, provider_tx_id)
     VALUES (@id, @accountId, @userId, @postedAt, @description, @merchant, @category, @amountCents, @currency, @status,
     @transferGroupId, NULL, @providerTxId)`;
  const insertOnly = db.prepare(
    `INSERT INTO transactions ${cols} ON CONFLICT(account_id, provider_tx_id) WHERE provider_tx_id IS NOT NULL DO NOTHING`,
  );
  const upsert = db.prepare(
    `INSERT INTO transactions ${cols}
     ON CONFLICT(account_id, provider_tx_id) WHERE provider_tx_id IS NOT NULL DO UPDATE SET
       posted_at = excluded.posted_at, description = excluded.description, merchant = excluded.merchant,
       category = excluded.category, amount_cents = excluded.amount_cents, status = excluded.status,
       transfer_group_id = COALESCE(excluded.transfer_group_id, transactions.transfer_group_id)
     WHERE transactions.user_id = excluded.user_id`,
  );
  const remove = db.prepare("DELETE FROM transactions WHERE user_id = ? AND account_id = ? AND provider_tx_id = ?");

  const result: ApplyResult = { added: 0, modified: 0, removed: 0, newTransactionIds: [] };
  for (const e of latest.values()) {
    const accountId = accountIdFor(userId, row.institution_id, e.accountKey);
    if (!accounts.has(accountId)) continue;
    const existing = find.get(userId, accountId, e.providerTxId) as ExistingTx | undefined;

    if (e.type === "removed") {
      if (existing && remove.run(userId, accountId, e.providerTxId).changes === 1) result.removed++;
      continue;
    }
    const tx = e.tx!;
    const params = { id: txIdFor(accountId, e.providerTxId), accountId, userId, providerTxId: e.providerTxId, ...tx };
    if (!existing) {
      if ((e.type === "added" ? insertOnly : upsert).run(params).changes === 1) {
        result.added++;
        if (tx.status === "posted") result.newTransactionIds.push(params.id);
      }
      continue;
    }
    if (e.type === "added") continue; // duplicate or stale delivery
    const changed = existing.status !== tx.status || existing.amount_cents !== tx.amountCents
      || existing.description !== tx.description || existing.merchant !== tx.merchant
      || existing.category !== tx.category || existing.posted_at !== tx.postedAt;
    if (!changed) continue;
    upsert.run(params);
    result.modified++;
    if (existing.status !== "posted" && tx.status === "posted") result.newTransactionIds.push(existing.id);
  }
  return result;
}

/**
 * Pairs both legs of moves between the user's own accounts (card payments,
 * cross-institution transfers) that the provider did not already group:
 * posted "transfer" transactions of equal amount and opposite sign, same
 * currency, different accounts, within 3 days. Returns the number of new pairs.
 */
export function matchInternalTransfers(db: DB, userId: UserId): number {
  const rows = db
    .prepare(
      `SELECT id, account_id, posted_at, amount_cents, currency FROM transactions
       WHERE user_id = ? AND transfer_group_id IS NULL AND status = 'posted' AND category = 'transfer'
         AND provider_tx_id IS NOT NULL
       ORDER BY posted_at, id`,
    )
    .all(userId) as { id: string; account_id: string; posted_at: string; amount_cents: number; currency: string }[];
  const inflows = rows.filter((r) => r.amount_cents > 0);
  const used = new Set<string>();
  const setGroup = db.prepare(
    "UPDATE transactions SET transfer_group_id = ? WHERE user_id = ? AND id IN (?, ?) AND transfer_group_id IS NULL",
  );
  let pairs = 0;
  for (const out of rows.filter((r) => r.amount_cents < 0)) {
    const t = Date.parse(out.posted_at);
    let best: (typeof rows)[number] | null = null;
    for (const inn of inflows) {
      if (used.has(inn.id) || inn.account_id === out.account_id || inn.currency !== out.currency) continue;
      if (inn.amount_cents !== -out.amount_cents) continue;
      const gap = Math.abs(Date.parse(inn.posted_at) - t);
      if (gap > TRANSFER_MATCH_WINDOW_MS) continue;
      if (!best || gap < Math.abs(Date.parse(best.posted_at) - t)) best = inn;
    }
    if (!best) continue;
    used.add(best.id);
    const group = `tg_${userId}_m_${createHash("sha256").update(`${out.id}|${best.id}`).digest("hex").slice(0, 12)}`;
    if (setGroup.run(group, userId, out.id, best.id).changes === 2) pairs++;
  }
  return pairs;
}

/**
 * Balances as of sync: opening balance at the start of the synced history plus
 * posted activity (including ClearFi-simulated transfers). Available = balance
 * plus pending holds/charges; for cards, available credit = limit + balance + pending.
 */
function refreshBalances(db: DB, userId: UserId, row: ConnectionRow, now: Date): void {
  const w = requireWorld(userId, row.institution_id);
  const historyStartMs = Date.parse(row.history_start);
  const sums = db.prepare(
    `SELECT COALESCE(SUM(CASE WHEN status = 'posted' THEN amount_cents END), 0) AS posted,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN amount_cents END), 0) AS pending
     FROM transactions WHERE user_id = ? AND account_id = ?`,
  );
  const update = db.prepare(
    "UPDATE accounts SET balance_cents = ?, available_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?",
  );
  for (const t of w.accounts) {
    const id = accountIdFor(userId, row.institution_id, t.key);
    const { posted, pending } = sums.get(userId, id) as { posted: number; pending: number };
    const opening = t.type === "credit" ? cardOpeningCents(w, t.key, historyStartMs) : depositOpeningCents(w, t);
    const balance = opening + posted;
    const available = t.type === "credit" ? (t.creditLimitCents ?? 0) + balance + pending : balance + pending;
    update.run(balance, available, now.toISOString(), id, userId);
  }
}

/** Runs one cursor sync. Must be called inside a transaction with a sync-able connection. */
function performSync(db: DB, userId: UserId, row: ConnectionRow, now: Date, actor: string, enqueue: boolean): SyncSummary {
  const historyStartMs = Date.parse(row.history_start);
  const cursorMs = decodeCursor(row.cursor);
  const fromMs = cursorMs === null ? historyStartMs - 1 : Math.max(historyStartMs - 1, cursorMs - REDELIVERY_OVERLAP_MS);
  const toMs = now.getTime();
  const events = eventsBetween(userId, row.institution_id, historyStartMs, fromMs, toMs);
  const applied = applyProviderEvents(db, userId, row.id, events);
  const matchedPairs = matchInternalTransfers(db, userId);
  refreshBalances(db, userId, row, now);

  const syncedAt = now.toISOString();
  const nextCursor = encodeCursor(Math.max(cursorMs ?? 0, toMs));
  db.prepare(
    `UPDATE connections SET status = 'healthy', last_error = NULL, cursor = ?, last_synced_at = ?,
       sync_count = sync_count + 1, updated_at = ?
     WHERE id = ? AND user_id = ?`,
  ).run(nextCursor, syncedAt, syncedAt, row.id, userId);

  writeAudit(db, {
    userId, actor, eventType: "connection.synced",
    detail: {
      connectionId: row.id, institutionId: row.institution_id, added: applied.added, modified: applied.modified,
      removed: applied.removed, newPosted: applied.newTransactionIds.length, eventsDelivered: events.length,
      matchedTransferPairs: matchedPairs, ...(row.status === "error" ? { recoveredFrom: "error" } : {}),
      simulated: true,
    },
  });

  if (enqueue && applied.newTransactionIds.length > 0) {
    const payload = { connectionId: row.id, syncedAt, newTransactionIds: applied.newTransactionIds };
    enqueueJob(db, { userId, type: "spending_review", dedupeKey: `spending_review:${userId}:${row.id}:${syncedAt}`, payload });
    enqueueJob(db, { userId, type: "subscription_review", dedupeKey: `subscription_review:${userId}:${row.id}:${syncedAt}`, payload });
  }

  return {
    connectionId: row.id,
    status: "healthy",
    added: applied.added,
    modified: applied.modified,
    removed: applied.removed,
    newTransactionIds: applied.newTransactionIds,
    syncedAt,
  };
}

/**
 * Cursor sync: pulls provider events newer than the stored cursor (plus a
 * short re-delivery overlap) up to `now`. Refused while the connection needs
 * re-authentication or is disconnected. A connection in "error" retries and
 * recovers (the simulated outage is transient).
 */
export function sync(db: DB, userId: UserId, connectionId: string, opts: ProviderOpts = {}): SyncSummary {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? "system";
  const row = loadConnectionRow(db, userId, connectionId);
  if (row.status === "login_required" || row.status === "disconnected") {
    writeAudit(db, {
      userId, actor, eventType: "connection.sync_blocked",
      detail: { connectionId, status: row.status, simulated: true },
    });
    throw row.status === "login_required"
      ? conflict("INVALID_STATE", "This connection needs you to sign in again. Reconnect it before syncing.",
          { status: row.status, requiredAction: "reconnect" })
      : conflict("INVALID_STATE", "This connection is disconnected. Link the institution again to resume syncing.",
          { status: row.status, requiredAction: "link" });
  }
  return db.transaction(() => performSync(db, userId, loadConnectionRow(db, userId, connectionId), now, actor,
    opts.enqueue ?? true))();
}

// ---------------------------------------------------------------------------
// Health: disconnect, reconnect, simulated failures
// ---------------------------------------------------------------------------

/**
 * Revokes the simulated consent. History stays visible; linked accounts become
 * view-only so they can no longer be used as transfer endpoints.
 */
export function disconnect(db: DB, userId: UserId, connectionId: string, opts: ProviderOpts = {}): Connection {
  const row = loadConnectionRow(db, userId, connectionId);
  if (row.status === "disconnected") return toConnection(db, row);
  const nowIso = (opts.now ?? new Date()).toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE connections SET status = 'disconnected', consent_scopes = '[]', last_error = NULL, updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(nowIso, connectionId, userId);
    const accounts = db
      .prepare(`UPDATE accounts SET capabilities = '["view"]', updated_at = ? WHERE user_id = ? AND connection_id = ?`)
      .run(nowIso, userId, connectionId);
    writeAudit(db, {
      userId, actor: opts.actor ?? `user:${userId}`, eventType: "connection.disconnected",
      detail: { connectionId, institutionId: row.institution_id, previousStatus: row.status,
        accountsMadeViewOnly: accounts.changes, historyKept: true, simulated: true },
    });
  })();
  return getConnection(db, userId, connectionId);
}

/** Simulated re-authentication (Plaid "update mode"): restores a healthy connection. */
export function reconnect(db: DB, userId: UserId, connectionId: string, opts: ProviderOpts = {}): Connection {
  const row = loadConnectionRow(db, userId, connectionId);
  if (row.status === "disconnected") {
    throw conflict("INVALID_STATE", "This connection is disconnected. Link the institution again instead.",
      { status: row.status, requiredAction: "link" });
  }
  const nowIso = (opts.now ?? new Date()).toISOString();
  db.transaction(() => {
    db.prepare(
      `UPDATE connections SET status = 'healthy', last_error = NULL, updated_at = ? WHERE id = ? AND user_id = ?`,
    ).run(nowIso, connectionId, userId);
    writeAudit(db, {
      userId, actor: opts.actor ?? `user:${userId}`, eventType: "connection.reconnected",
      detail: { connectionId, institutionId: row.institution_id, previousStatus: row.status, simulated: true },
    });
  })();
  return getConnection(db, userId, connectionId);
}

/** Demo-only: forces a connection into login_required or error. */
export function simulateIssue(
  db: DB,
  userId: UserId,
  connectionId: string,
  scenario: SimulatedScenario,
  opts: ProviderOpts = {},
): Connection {
  const row = loadConnectionRow(db, userId, connectionId);
  if (row.status === "disconnected") {
    throw conflict("INVALID_STATE", "This connection is disconnected.", { status: row.status });
  }
  const nowIso = (opts.now ?? new Date()).toISOString();
  db.transaction(() => {
    db.prepare(`UPDATE connections SET status = ?, last_error = ?, updated_at = ? WHERE id = ? AND user_id = ?`)
      .run(scenario, SIMULATED_ERRORS[scenario], nowIso, connectionId, userId);
    writeAudit(db, {
      userId, actor: opts.actor ?? `user:${userId}`, eventType: "connection.status_simulated",
      detail: { connectionId, scenario, previousStatus: row.status, demoOnly: true, simulated: true },
    });
  })();
  return getConnection(db, userId, connectionId);
}
