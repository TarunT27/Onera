/**
 * Chat security contract: the events the chat pipeline records at each stage,
 * and the findings the background monitor derives from them. Owned by the
 * chatguard module (docs/api/chat-security.md).
 */
import type { UserId } from "@/lib/types";

/** Bumped when event fields or rule semantics change; stored on every event and finding. */
export const CHATGUARD_RULESET_VERSION = "chatguard-1";

export const EVENT_STAGES = ["input", "retrieved_content", "tool_request", "tool_result", "output", "health"] as const;
export type EventStage = (typeof EVENT_STAGES)[number];

/** The server's decision for this stage. "observe" = recorded only, no gate applies. */
export type EventOutcome = "allow" | "deny" | "observe";

/** Machine-readable reasons the server recorded (deny reasons and observed signals). */
export type EventReason =
  // input
  | "RATE_LIMITED"
  | "INJECTION_MARKERS"
  | "QUOTED_ATTACK_TEXT"
  // retrieved content
  | "UNTRUSTED_INSTRUCTIONS"
  // tool request (gated before dispatch)
  | "UNKNOWN_TOOL"
  | "NOT_ALLOWED_FOR_AGENT"
  | "INVALID_INPUT"
  | "TOOL_BUDGET_EXCEEDED"
  // tool result (refused by a service during dispatch)
  | "NOT_FOUND"
  | "SERVICE_REFUSED"
  | "PROPOSAL_CREATED"
  // output
  | "SENSITIVE_DATA"
  | "UNSUPPORTED_EXECUTION_CLAIM"
  | "AMOUNT_MISMATCH"
  | "AMBIGUOUS_CLAIM"
  | "INLINE_CHECK_UNAVAILABLE"
  | "MODEL_REFUSAL"
  // health
  | "MODEL_UNAVAILABLE";

/** A server-recorded chat security event. Users and models can't write these. */
export interface ChatSecurityEvent {
  id: number;
  userId: UserId;
  conversationId: string;
  turnId: string;
  stage: EventStage;
  /** Assistant agent that handled the turn (general, research, …). */
  agent: string;
  tool: string | null;
  outcome: EventOutcome;
  reasons: EventReason[];
  /** IDs of authoritative records involved (actions, orders, documents). Never another user's. */
  evidenceIds: string[];
  /** Small, non-sensitive facts: marker IDs, sensitive-pattern IDs, counts, error codes. */
  signals: Record<string, unknown>;
  /** Redacted, bounded excerpt, or null. */
  excerpt: string | null;
  rulesetVersion: string;
  createdAt: string;
}

export interface EventInput {
  userId: UserId;
  conversationId: string;
  turnId: string;
  stage: EventStage;
  agent: string;
  tool?: string | null;
  outcome: EventOutcome;
  reasons?: EventReason[];
  evidenceIds?: string[];
  signals?: Record<string, unknown>;
  /** Raw text; redacted and bounded before it is stored. */
  excerpt?: string | null;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export type FindingSeverity = "info" | "warning" | "critical";
export type CheckMethod = "fixed_rule" | "ai_review";
/** AI review alone never yields confirmed_policy_violation. */
export type FindingStatus = "suspected" | "confirmed_policy_violation" | "needs_review";
export type EnforcementOutcome =
  | "blocked_before_release"
  | "blocked_before_tool"
  | "observed_after_event"
  | "not_observed";

export const FINDING_RULES = [
  "instruction_override_attempt",
  "untrusted_content_instructions",
  "injection_followed_by_proposal",
  "sensitive_output_withheld",
  "sensitive_tool_input_blocked",
  "foreign_resource_request",
  "forbidden_tool_request",
  "malformed_tool_call",
  "unsupported_execution_claim",
  "amount_contradiction",
  "ambiguous_financial_claim",
  "request_rate_exceeded",
  "tool_budget_exceeded",
  "inline_gate_unavailable",
  "reviewer_flagged",
] as const;
export type FindingRule = (typeof FINDING_RULES)[number];

export interface ChatSecurityFinding {
  id: string;
  userId: UserId;
  conversationId: string;
  ruleId: FindingRule;
  severity: FindingSeverity;
  /** Plain-words title, e.g. "Possible unsafe instruction detected". */
  title: string;
  /** What was observed. Never contains raw secrets or another user's data. */
  signal: string;
  explanation: string;
  method: CheckMethod;
  status: FindingStatus;
  enforcement: EnforcementOutcome;
  /** Events behind the finding (first one is the anchor). */
  eventIds: number[];
  evidenceIds: string[];
  occurrences: number;
  firstSeenAt: string;
  lastSeenAt: string;
  rulesetVersion: string;
}

/** What a rule hands to the finding writer. */
export interface FindingDraft {
  ruleId: FindingRule;
  severity: FindingSeverity;
  title: string;
  signal: string;
  explanation: string;
  method: CheckMethod;
  status: FindingStatus;
  enforcement: EnforcementOutcome;
  /** Stable identity: replaying the same events never creates a second finding. */
  dedupeKey: string;
  evidenceIds?: string[];
}

// ---------------------------------------------------------------------------
// Monitor health
// ---------------------------------------------------------------------------

export type MonitorHealth = "active" | "lagging" | "degraded" | "not_running";

export interface MonitorStatus {
  health: MonitorHealth;
  /** Plain-words label for the UI. Never an "all clear" while events are pending. */
  label: string;
  heartbeatAt: string | null;
  lastCompletedAt: string | null;
  /** This user's events not yet processed. */
  pendingEvents: number;
  /** This user's events whose processing failed (kept for review). */
  failedEvents: number;
  /** Seconds between the oldest pending event and now, or null when nothing is pending. */
  lagSeconds: number | null;
  reviewer: {
    enabled: boolean;
    calls: number;
    lastError: string | null;
    lastErrorAt: string | null;
  };
  staleAfterSeconds: number;
  pollSeconds: number;
  limitations: string[];
}

export interface BatchReport {
  processed: number;
  findingsWritten: number;
  reviewerCalls: number;
  reviewerFailures: number;
  failedEvents: number;
  cursor: number;
  /** True when another process held the lease, so this call did nothing. */
  skipped: boolean;
}
