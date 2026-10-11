/**
 * Server-side writer and readers for chat security events.
 *
 * Only server code in the chat pipeline (lib/ai/chat.ts, lib/ai/tools.ts)
 * records events, with the user ID from the session and the outcome the server
 * itself decided. There is no route that accepts events from a client and no
 * tool that lets the model write one, so events can't be fabricated.
 *
 * Excerpts are redacted and bounded before they are stored.
 */
import { randomBytes } from "node:crypto";
import type { DB } from "@/lib/db";
import { redact } from "@/lib/security/redact";
import type { UserId } from "@/lib/types";
import { CHATGUARD_RULESET_VERSION, type ChatSecurityEvent, type EventInput } from "./types";

export const EXCERPT_MAX = 500;

export interface EventRow {
  id: number;
  user_id: string;
  conversation_id: string;
  turn_id: string;
  stage: ChatSecurityEvent["stage"];
  agent: string;
  tool: string | null;
  outcome: ChatSecurityEvent["outcome"];
  reasons: string;
  evidence_ids: string;
  signals: string;
  excerpt: string | null;
  ruleset_version: string;
  created_at: string;
}

export function toEvent(r: EventRow): ChatSecurityEvent {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    conversationId: r.conversation_id,
    turnId: r.turn_id,
    stage: r.stage,
    agent: r.agent,
    tool: r.tool,
    outcome: r.outcome,
    reasons: JSON.parse(r.reasons),
    evidenceIds: JSON.parse(r.evidence_ids),
    signals: JSON.parse(r.signals),
    excerpt: r.excerpt,
    rulesetVersion: r.ruleset_version,
    createdAt: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// Wake-ups: an in-process monitor consumes new events on arrival
// ---------------------------------------------------------------------------

type Listener = () => void;
const wake = globalThis as unknown as { __clearfiChatguardListeners?: Set<Listener> };
const listeners = (wake.__clearfiChatguardListeners ??= new Set<Listener>());

/** Called by the in-process monitor loop. Returns an unsubscribe function. */
export function onNewEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const l of listeners) {
    try {
      l();
    } catch (err) {
      console.error("[chatguard] wake listener failed", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

export function newTurnId(): string {
  return `turn_${randomBytes(6).toString("hex")}`;
}

export function newConversationId(): string {
  return `conv_${randomBytes(8).toString("hex")}`;
}

/** Records one event. `excerpt` is redacted and bounded here, never stored raw. */
export function recordEvent(db: DB, e: EventInput, now: Date = new Date()): number {
  const result = db
    .prepare(
      `INSERT INTO chat_security_events (user_id, conversation_id, turn_id, stage, agent, tool, outcome, reasons,
         evidence_ids, signals, excerpt, ruleset_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      e.userId, e.conversationId, e.turnId, e.stage, e.agent, e.tool ?? null, e.outcome,
      JSON.stringify(e.reasons ?? []), JSON.stringify(e.evidenceIds ?? []), JSON.stringify(e.signals ?? {}),
      e.excerpt ? redact(e.excerpt, EXCERPT_MAX) : null, CHATGUARD_RULESET_VERSION, now.toISOString(),
    );
  notify();
  return Number(result.lastInsertRowid);
}

/** Best-effort variant for paths where recording must never change the user-visible outcome. */
export function tryRecordEvent(db: DB, e: EventInput, now?: Date): number | null {
  try {
    return recordEvent(db, e, now);
  } catch (err) {
    console.error("[chatguard] could not record event", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** This user's input events since `sinceIso` (used by the rate limiter). */
export function countRecentInputs(db: DB, userId: UserId, sinceIso: string): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM chat_security_events
       WHERE user_id = ? AND stage = 'input' AND outcome != 'deny' AND created_at >= ?`,
    )
    .get(userId, sinceIso) as { n: number };
  return row.n;
}

/** Whether a rate-limit refusal was already recorded for this user since `sinceIso` (one per window is enough). */
export function rateLimitRecordedSince(db: DB, userId: UserId, sinceIso: string): boolean {
  return Boolean(
    db.prepare(
      `SELECT 1 FROM chat_security_events
       WHERE user_id = ? AND stage = 'input' AND outcome = 'deny' AND created_at >= ? LIMIT 1`,
    ).get(userId, sinceIso),
  );
}

/** The user's own events in a turn, oldest first. */
export function listTurnEvents(db: DB, userId: UserId, turnId: string): ChatSecurityEvent[] {
  const rows = db
    .prepare("SELECT * FROM chat_security_events WHERE user_id = ? AND turn_id = ? ORDER BY id")
    .all(userId, turnId) as EventRow[];
  return rows.map(toEvent);
}

/** The user's own events in a conversation up to and including `uptoId`, oldest first (bounded). */
export function listConversationEvents(
  db: DB,
  userId: UserId,
  conversationId: string,
  uptoId: number,
  limit = 200,
): ChatSecurityEvent[] {
  const rows = db
    .prepare(
      `SELECT * FROM (SELECT * FROM chat_security_events WHERE user_id = ? AND conversation_id = ? AND id <= ?
         ORDER BY id DESC LIMIT ?) ORDER BY id`,
    )
    .all(userId, conversationId, uptoId, limit) as EventRow[];
  return rows.map(toEvent);
}

/** The user's own events, newest first (for the Security page timeline). */
export function listUserEvents(db: DB, userId: UserId, limit = 50): ChatSecurityEvent[] {
  const rows = db
    .prepare("SELECT * FROM chat_security_events WHERE user_id = ? ORDER BY id DESC LIMIT ?")
    .all(userId, Math.min(Math.max(limit, 1), 200)) as EventRow[];
  return rows.map(toEvent);
}
