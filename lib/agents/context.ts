/**
 * AgentContext — the only thing a monitor handler receives.
 *
 * Built from the agent's registry definition. It exposes user-scoped read
 * functions for the declared data scopes, an insight writer and (where
 * registered) a job enqueuer and connection sync. It never exposes the raw
 * database handle, and there is no operation that approves, executes, holds,
 * verifies or changes controls. A call outside the declared scope throws
 * ScopeViolationError and is recorded even if the handler swallows it.
 */
import type { DB } from "@/lib/db";
import {
  toAccount,
  toAction,
  toAuditEvent,
  toRecipient,
  toTransaction,
  type AccountRow,
  type ActionRow,
  type AuditRow,
  type RecipientRow,
  type TransactionRow,
} from "@/lib/db/rows";
import { usdConverter } from "@/lib/finance/fx";
import { detectSubscriptionIncreases } from "@/lib/finance/subscriptions";
import { getPortfolio, getQuote, type Portfolio, type Quote } from "@/lib/markets";
import { listConnections, syncConnection, type Connection, type SyncSummary } from "@/lib/providers";
import type {
  Account,
  ActionState,
  AuditEvent,
  CurrencyCode,
  Recipient,
  SubscriptionIncrease,
  Transaction,
  TransferAction,
  UserId,
} from "@/lib/types";
import { ScopeViolationError } from "./errors";
import { upsertInsight } from "./insights";
import { enqueueJob } from "./queue";
import type {
  AgentDefinition,
  DataScope,
  EnqueueResult,
  InsightDraft,
  JobType,
  UpsertOutcome,
  WriteScope,
} from "./types";

export interface AgentReads {
  accounts: { list(): Account[] };
  transactions: {
    /** Posted and pending transactions in [sinceIso, untilIso], oldest first. */
    list(opts?: { sinceIso?: string; untilIso?: string }): Transaction[];
    byIds(ids: string[]): Transaction[];
    earliestPostedAt(): string | null;
    /** Deterministic recurring-charge price increases (lib/finance/subscriptions). */
    subscriptionIncreases(): SubscriptionIncrease[];
  };
  recipients: { get(id: string): Recipient | null };
  actions: {
    get(id: string): TransferAction | null;
    list(opts?: { recipientId?: string; states?: ActionState[]; excludeId?: string; limit?: number }): TransferAction[];
  };
  portfolio: { get(): Portfolio; quote(symbol: string): Quote | null };
  connections: { list(): Connection[] };
  audit: {
    /** The user's own audit events created at or after sinceIso, oldest first. */
    list(opts?: { sinceIso?: string; limit?: number }): AuditEvent[];
  };
}

export interface AgentContext {
  readonly agent: AgentDefinition;
  readonly userId: UserId;
  readonly now: Date;
  readonly job: Readonly<{ id: string; type: string; payload: Record<string, unknown>; attempt: number }>;
  readonly read: AgentReads;
  readonly insights: { upsert(draft: InsightDraft): { id: string; outcome: UpsertOutcome } };
  readonly jobs: {
    /** Enqueue a follow-up job for this context's user. The key is namespaced as `${type}:${userId}:${dedupeKey}`. */
    enqueue(input: { type: JobType; dedupeKey: string; payload?: Record<string, unknown> }): EnqueueResult;
  };
  readonly connections: { sync(connectionId: string): SyncSummary };
  /** Converts an amount to USD cents with the dated demo FX rate (reference data, not user data). */
  toUsd(cents: number, currency: CurrencyCode): number;
}

/** What a handler returns. The runner adds insight and enqueue counts from the tracker. */
export interface AgentResult {
  summary: string;
  data?: Record<string, unknown>;
  /** Links the run's audit event to a transfer action (security sentinel). */
  auditActionId?: string;
}

export type AgentHandler = (ctx: AgentContext) => AgentResult;

/** What the runner learns about a run besides the handler's return value. */
export interface ContextTracker {
  violations: ScopeViolationError[];
  insights: { id: string; outcome: UpsertOutcome }[];
  enqueued: { jobId: string | null; type: JobType; deduplicated: boolean }[];
}

export function buildAgentContext(
  db: DB,
  agent: AgentDefinition,
  job: { id: string; userId: UserId; type: string; payload: Record<string, unknown>; attempt: number },
  now: Date,
): { ctx: AgentContext; tracker: ContextTracker } {
  const userId = job.userId;
  const tracker: ContextTracker = { violations: [], insights: [], enqueued: [] };

  const deny = (scope: string, message: string): never => {
    const err = new ScopeViolationError(scope, message, agent.id);
    tracker.violations.push(err);
    throw err;
  };
  const needRead = (scope: DataScope, op: string) => {
    if (!agent.reads.includes(scope)) deny(scope, `Agent ${agent.id} may not read "${scope}" (${op})`);
  };
  const needWrite = (scope: WriteScope, op: string) => {
    if (!agent.writes.includes(scope)) deny(scope, `Agent ${agent.id} may not write "${scope}" (${op})`);
  };

  const toUsdRaw = usdConverter(db);

  const read: AgentReads = {
    accounts: {
      list() {
        needRead("accounts", "accounts.list");
        const rows = db.prepare("SELECT * FROM accounts WHERE user_id = ? ORDER BY type, id").all(userId);
        return (rows as AccountRow[]).map(toAccount);
      },
    },
    transactions: {
      list(opts = {}) {
        needRead("transactions", "transactions.list");
        const rows = db
          .prepare(
            `SELECT * FROM transactions WHERE user_id = ? AND posted_at >= ? AND posted_at <= ?
             ORDER BY posted_at ASC, id ASC`,
          )
          .all(userId, opts.sinceIso ?? "", opts.untilIso ?? "9999");
        return (rows as TransactionRow[]).map(toTransaction);
      },
      byIds(ids) {
        needRead("transactions", "transactions.byIds");
        if (ids.length === 0) return [];
        const rows = db
          .prepare(`SELECT * FROM transactions WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
          .all(userId, ...ids);
        return (rows as TransactionRow[]).map(toTransaction);
      },
      earliestPostedAt() {
        needRead("transactions", "transactions.earliestPostedAt");
        const row = db.prepare("SELECT MIN(posted_at) AS t FROM transactions WHERE user_id = ?").get(userId) as {
          t: string | null;
        };
        return row.t;
      },
      subscriptionIncreases() {
        needRead("transactions", "transactions.subscriptionIncreases");
        return detectSubscriptionIncreases(db, userId, now);
      },
    },
    recipients: {
      get(id) {
        needRead("recipients", "recipients.get");
        const row = db.prepare("SELECT * FROM recipients WHERE id = ? AND user_id = ?").get(id, userId);
        return row ? toRecipient(row as RecipientRow) : null;
      },
    },
    actions: {
      get(id) {
        needRead("actions", "actions.get");
        const row = db.prepare("SELECT * FROM actions WHERE id = ? AND user_id = ?").get(id, userId);
        return row ? toAction(row as ActionRow) : null;
      },
      list(opts = {}) {
        needRead("actions", "actions.list");
        const clauses = ["user_id = ?"];
        const params: (string | number)[] = [userId];
        if (opts.recipientId) { clauses.push("recipient_id = ?"); params.push(opts.recipientId); }
        if (opts.excludeId) { clauses.push("id != ?"); params.push(opts.excludeId); }
        if (opts.states?.length) {
          clauses.push(`state IN (${opts.states.map(() => "?").join(",")})`);
          params.push(...opts.states);
        }
        const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
        const rows = db
          .prepare(`SELECT * FROM actions WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT ?`)
          .all(...params, limit);
        return (rows as ActionRow[]).map(toAction);
      },
    },
    portfolio: {
      get() {
        needRead("portfolio", "portfolio.get");
        return getPortfolio(db, userId, now);
      },
      quote(symbol) {
        needRead("portfolio", "portfolio.quote");
        return getQuote(symbol, now);
      },
    },
    connections: {
      list() {
        needRead("connections", "connections.list");
        return listConnections(db, userId);
      },
    },
    audit: {
      list(opts = {}) {
        needRead("audit", "audit.list");
        const limit = Math.min(Math.max(opts.limit ?? 1000, 1), 5000);
        // Newest `limit` rows in the window, returned oldest first.
        const rows = db
          .prepare(
            `SELECT * FROM (SELECT * FROM audit_events WHERE user_id = ? AND created_at >= ? ORDER BY id DESC LIMIT ?)
             ORDER BY id ASC`,
          )
          .all(userId, opts.sinceIso ?? "", limit);
        return (rows as AuditRow[]).map(toAuditEvent);
      },
    },
  };
  for (const group of Object.values(read)) Object.freeze(group);
  Object.freeze(read);

  const ctx: AgentContext = Object.freeze({
    agent,
    userId,
    now,
    job: Object.freeze({ id: job.id, type: job.type, payload: job.payload, attempt: job.attempt }),
    read,
    insights: Object.freeze({
      upsert(draft: InsightDraft) {
        needWrite("insights", "insights.upsert");
        const { insight, outcome } = upsertInsight(
          db,
          { ...draft, userId, agentId: agent.id, dedupeKey: `${agent.id}:${draft.dedupeKey}` },
          now,
        );
        tracker.insights.push({ id: insight.id, outcome });
        return { id: insight.id, outcome };
      },
    }),
    jobs: Object.freeze({
      enqueue(input: { type: JobType; dedupeKey: string; payload?: Record<string, unknown> }) {
        needWrite("jobs", `jobs.enqueue:${input.type}`);
        if (!agent.enqueues.includes(input.type)) {
          deny(`jobs:${input.type}`, `Agent ${agent.id} may not enqueue "${input.type}" jobs`);
        }
        const result = enqueueJob(db, {
          userId,
          type: input.type,
          dedupeKey: `${input.type}:${userId}:${input.dedupeKey}`,
          payload: input.payload,
          runAfter: now.toISOString(),
        });
        tracker.enqueued.push({ jobId: result.jobId, type: input.type, deduplicated: result.deduplicated });
        return result;
      },
    }),
    connections: Object.freeze({
      sync(connectionId: string) {
        needRead("connections", "connections.sync");
        needWrite("connection_sync", "connections.sync");
        return syncConnection(db, userId, connectionId, now);
      },
    }),
    toUsd: (cents: number, currency: CurrencyCode) => toUsdRaw(cents, currency),
  });
  return { ctx, tracker };
}
