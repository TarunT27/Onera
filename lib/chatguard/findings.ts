/**
 * Chat security findings: written by the background monitor, read by the
 * owning user only. Upserts are keyed by (user_id, dedupe_key) and occurrence
 * counts come from the finding↔event link table, so replaying events never
 * creates a second finding or inflates a count.
 */
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import { notFound } from "@/lib/errors";
import type { UserId } from "@/lib/types";
import {
  CHATGUARD_RULESET_VERSION,
  type ChatSecurityEvent,
  type ChatSecurityFinding,
  type FindingDraft,
  type FindingSeverity,
  type FindingStatus,
} from "./types";

interface FindingRow {
  id: string;
  user_id: string;
  conversation_id: string;
  rule_id: ChatSecurityFinding["ruleId"];
  severity: FindingSeverity;
  title: string;
  signal: string;
  explanation: string;
  method: ChatSecurityFinding["method"];
  status: FindingStatus;
  enforcement: ChatSecurityFinding["enforcement"];
  evidence_ids: string;
  dedupe_key: string;
  first_seen_at: string;
  last_seen_at: string;
  ruleset_version: string;
}

const SEVERITY_RANK: Record<FindingSeverity, number> = { info: 0, warning: 1, critical: 2 };
const STATUS_RANK: Record<FindingStatus, number> = { needs_review: 0, suspected: 1, confirmed_policy_violation: 2 };

function eventIdsFor(db: DB, findingId: string): number[] {
  return (
    db.prepare("SELECT event_id FROM chat_security_finding_events WHERE finding_id = ? ORDER BY event_id").all(findingId) as {
      event_id: number;
    }[]
  ).map((r) => r.event_id);
}

function toFinding(db: DB, r: FindingRow): ChatSecurityFinding {
  const eventIds = eventIdsFor(db, r.id);
  return {
    id: r.id,
    userId: r.user_id as UserId,
    conversationId: r.conversation_id,
    ruleId: r.rule_id,
    severity: r.severity,
    title: r.title,
    signal: r.signal,
    explanation: r.explanation,
    method: r.method,
    status: r.status,
    enforcement: r.enforcement,
    eventIds,
    evidenceIds: JSON.parse(r.evidence_ids),
    occurrences: eventIds.length,
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    rulesetVersion: r.ruleset_version,
  };
}

/**
 * Records that `event` supports the finding `draft`. Call inside the monitor's
 * batch transaction. Severity and status only ever escalate; first/last seen
 * come from event timestamps, so a replay leaves them unchanged.
 */
export function upsertFinding(db: DB, event: ChatSecurityEvent, draft: FindingDraft): { id: string; created: boolean } {
  // An AI reviewer's opinion can never confirm a violation (also a CHECK constraint).
  if (draft.method === "ai_review" && draft.status === "confirmed_policy_violation") {
    throw new Error("AI review cannot confirm a policy violation");
  }
  const existing = db
    .prepare("SELECT * FROM chat_security_findings WHERE user_id = ? AND dedupe_key = ?")
    .get(event.userId, draft.dedupeKey) as FindingRow | undefined;

  const evidence = [...new Set([...(existing ? (JSON.parse(existing.evidence_ids) as string[]) : []), ...(draft.evidenceIds ?? [])])];
  let id: string;
  let created = false;
  if (!existing) {
    id = `csf_${randomBytes(6).toString("hex")}`;
    created = true;
    db.prepare(
      `INSERT INTO chat_security_findings (id, user_id, conversation_id, rule_id, severity, title, signal, explanation,
         method, status, enforcement, evidence_ids, dedupe_key, first_seen_at, last_seen_at, ruleset_version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, event.userId, event.conversationId, draft.ruleId, draft.severity, draft.title, draft.signal,
      draft.explanation, draft.method, draft.status, draft.enforcement, JSON.stringify(evidence), draft.dedupeKey,
      event.createdAt, event.createdAt, CHATGUARD_RULESET_VERSION);
  } else {
    id = existing.id;
    const severity = SEVERITY_RANK[draft.severity] > SEVERITY_RANK[existing.severity] ? draft.severity : existing.severity;
    const status = STATUS_RANK[draft.status] > STATUS_RANK[existing.status] ? draft.status : existing.status;
    db.prepare(
      `UPDATE chat_security_findings
       SET severity = ?, status = ?, title = ?, signal = ?, explanation = ?, enforcement = ?, evidence_ids = ?,
           first_seen_at = MIN(first_seen_at, ?), last_seen_at = MAX(last_seen_at, ?), ruleset_version = ?
       WHERE id = ? AND user_id = ?`,
    ).run(severity, status, draft.title, draft.signal, draft.explanation, draft.enforcement, JSON.stringify(evidence),
      event.createdAt, event.createdAt, CHATGUARD_RULESET_VERSION, id, event.userId);
  }
  db.prepare("INSERT OR IGNORE INTO chat_security_finding_events (finding_id, event_id) VALUES (?, ?)").run(id, event.id);
  return { id, created };
}

/** The user's own findings, most recently seen first. */
export function listFindings(db: DB, userId: UserId, opts: { limit?: number } = {}): ChatSecurityFinding[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const rows = db
    .prepare("SELECT * FROM chat_security_findings WHERE user_id = ? ORDER BY last_seen_at DESC, rowid DESC LIMIT ?")
    .all(userId, limit) as FindingRow[];
  return rows.map((r) => toFinding(db, r));
}

/** One of the user's own findings. Another user's finding is "not found". */
export function getFinding(db: DB, userId: UserId, id: string): ChatSecurityFinding {
  const row = db
    .prepare("SELECT * FROM chat_security_findings WHERE id = ? AND user_id = ?")
    .get(id, userId) as FindingRow | undefined;
  if (!row) throw notFound("Finding");
  return toFinding(db, row);
}
