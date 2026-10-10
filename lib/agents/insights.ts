/**
 * Persisted, evidence-linked insights.
 *
 * Upsert by (user_id, dedupe_key) with an evidence hash:
 *  - new finding                → inserted with status "new"
 *  - same finding, same evidence → untouched (no re-alert; status and updated_at kept)
 *  - same finding, new evidence  → updated and reset to "new"
 *
 * Evidence IDs are checked against the insight's owner, so an insight can
 * never cite another user's records.
 */
import { createHash, randomBytes } from "node:crypto";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import { ScopeViolationError } from "./errors";
import {
  INSIGHT_STATUSES,
  type Insight,
  type InsightDraft,
  type InsightEvidence,
  type InsightStatus,
  type UpsertOutcome,
} from "./types";

interface InsightRow {
  id: string;
  user_id: string;
  agent_id: string;
  type: string;
  severity: Insight["severity"];
  title: string;
  body: string;
  evidence: string;
  evidence_hash: string;
  dedupe_key: string;
  status: InsightStatus;
  created_at: string;
  updated_at: string;
}

function toInsight(r: InsightRow): Insight {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    agentId: r.agent_id,
    type: r.type,
    severity: r.severity,
    title: r.title,
    body: r.body,
    evidence: JSON.parse(r.evidence) as InsightEvidence,
    status: r.status,
    deterministic: true,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** JSON with object keys sorted recursively, so equal evidence hashes equally. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${canonicalJson(x)}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

export function evidenceHash(evidence: InsightEvidence): string {
  return createHash("sha256").update(canonicalJson(evidence)).digest("hex");
}

const OWNED_ID_TABLES = [
  ["transactionIds", "transactions"],
  ["actionIds", "actions"],
  ["accountIds", "accounts"],
  ["auditEventIds", "audit_events"],
] as const;

/** Throws if any cited transaction, action, account or audit event is not owned by userId. */
function assertEvidenceOwned(db: DB, userId: UserId, evidence: InsightEvidence): void {
  for (const [field, table] of OWNED_ID_TABLES) {
    const ids = [...new Set<string | number>(evidence[field] ?? [])];
    if (ids.length === 0) continue;
    const { n } = db
      .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
      .get(userId, ...ids) as { n: number };
    if (n !== ids.length) {
      throw new ScopeViolationError(`evidence.${field}`, "Insight evidence cites records outside the user's scope");
    }
  }
}

export interface UpsertInsightInput extends InsightDraft {
  userId: UserId;
  agentId: string;
}

export function upsertInsight(
  db: DB,
  input: UpsertInsightInput,
  now: Date = new Date(),
): { insight: Insight; outcome: UpsertOutcome } {
  assertEvidenceOwned(db, input.userId, input.evidence);
  const hash = evidenceHash(input.evidence);
  const nowIso = now.toISOString();

  return db.transaction(() => {
    const existing = db
      .prepare("SELECT * FROM insights WHERE user_id = ? AND dedupe_key = ?")
      .get(input.userId, input.dedupeKey) as InsightRow | undefined;

    if (!existing) {
      const id = `ins_${randomBytes(6).toString("hex")}`;
      db.prepare(
        `INSERT INTO insights (id, user_id, agent_id, type, severity, title, body, evidence, evidence_hash, dedupe_key,
           status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)`,
      ).run(id, input.userId, input.agentId, input.type, input.severity, input.title, input.body,
        JSON.stringify(input.evidence), hash, input.dedupeKey, nowIso, nowIso);
      return { insight: getInsightOrThrow(db, input.userId, id), outcome: "created" as const };
    }

    if (existing.evidence_hash === hash) {
      return { insight: toInsight(existing), outcome: "unchanged" as const };
    }

    db.prepare(
      `UPDATE insights SET agent_id = ?, type = ?, severity = ?, title = ?, body = ?, evidence = ?, evidence_hash = ?,
         status = 'new', updated_at = ?
       WHERE id = ? AND user_id = ?`,
    ).run(input.agentId, input.type, input.severity, input.title, input.body, JSON.stringify(input.evidence), hash,
      nowIso, existing.id, input.userId);
    return { insight: getInsightOrThrow(db, input.userId, existing.id), outcome: "updated" as const };
  })();
}

function getInsightOrThrow(db: DB, userId: UserId, id: string): Insight {
  const row = db.prepare("SELECT * FROM insights WHERE id = ? AND user_id = ?").get(id, userId) as InsightRow | undefined;
  if (!row) throw notFound("Insight");
  return toInsight(row);
}

export function getInsight(db: DB, userId: UserId, id: string): Insight {
  return getInsightOrThrow(db, userId, id);
}

export function parseInsightStatus(v: string | null | undefined): InsightStatus | "all" | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (v === "all" || (INSIGHT_STATUSES as readonly string[]).includes(v)) return v as InsightStatus | "all";
  throw badRequest("status must be one of new, seen, dismissed, all");
}

/**
 * Newest first. With no status filter, dismissed insights are left out
 * (the inbox view); pass "all" to include them.
 */
export function listInsights(
  db: DB,
  userId: UserId,
  opts: { status?: InsightStatus | "all"; agentId?: string; limit?: number } = {},
): Insight[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const clauses = ["user_id = ?"];
  const params: (string | number)[] = [userId];
  if (opts.status === undefined) clauses.push("status != 'dismissed'");
  else if (opts.status !== "all") { clauses.push("status = ?"); params.push(opts.status); }
  if (opts.agentId) { clauses.push("agent_id = ?"); params.push(opts.agentId); }
  const rows = db
    .prepare(`SELECT * FROM insights WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, rowid DESC LIMIT ?`)
    .all(...params, limit) as InsightRow[];
  return rows.map(toInsight);
}

/** The user marks an insight seen or dismissed. Another user's insight is "not found". */
export function setInsightStatus(
  db: DB,
  userId: UserId,
  id: string,
  status: Exclude<InsightStatus, "new">,
): Insight {
  return db.transaction(() => {
    const before = getInsightOrThrow(db, userId, id);
    if (before.status === status) return before;
    db.prepare("UPDATE insights SET status = ? WHERE id = ? AND user_id = ?").run(status, id, userId);
    writeAudit(db, {
      userId, actor: `user:${userId}`, eventType: `insight.${status}`,
      detail: { insightId: id, agentId: before.agentId, from: before.status, to: status },
    });
    return getInsightOrThrow(db, userId, id);
  })();
}
