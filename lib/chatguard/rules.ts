/**
 * Fixed rules the background monitor applies to each chat security event.
 *
 * Rules read only event metadata the server recorded (stage, outcome, reasons,
 * evidence IDs, marker and pattern IDs) plus earlier events in the same
 * conversation. They never decide what was allowed — the inline gates already
 * did — they explain it and group repeats. Detection is fallible: no finding
 * does not prove no attack happened.
 */
import { injectionMarkerLabel } from "@/lib/security/injection";
import { sensitiveLabel } from "@/lib/security/redact";
import type { ChatSecurityEvent, FindingDraft } from "./types";

export const RULE_THRESHOLDS = {
  /** Not-found refusals in one conversation before the alert becomes a warning. */
  notFoundWarning: 3,
  /** Forbidden tool requests in one conversation before the alert becomes critical. */
  forbiddenCritical: 3,
} as const;

export interface RuleContext {
  /** The user's own events in the same conversation, up to and including this one, oldest first. */
  conversation: ChatSecurityEvent[];
}

export interface RuleResult {
  drafts: FindingDraft[];
  /** Ambiguous: worth an optional AI review (never required, never authorization). */
  reviewCandidate: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const markers = (e: ChatSecurityEvent): string[] =>
  Array.isArray(e.signals.markers) ? (e.signals.markers as unknown[]).map(String) : [];
const has = (e: ChatSecurityEvent, reason: string) => (e.reasons as string[]).includes(reason);

function inputRules(e: ChatSecurityEvent): RuleResult {
  if (e.outcome === "deny" && has(e, "RATE_LIMITED")) {
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "request_rate_exceeded",
        severity: "warning",
        title: "Chat request limit reached",
        signal: `More chat requests than the per-minute limit (${String(e.signals.limit ?? "?")}).`,
        explanation:
          "The server refused the request before any model or tool call ran. The limit is fixed on the server; " +
          "the assistant can't raise it.",
        method: "fixed_rule",
        status: "confirmed_policy_violation",
        enforcement: "blocked_before_tool",
        // Per user and hour, not per client-chosen conversation ID, so varying IDs can't multiply findings.
        dedupeKey: `rate:${e.createdAt.slice(0, 13)}`,
      }],
    };
  }
  if (has(e, "INJECTION_MARKERS")) {
    const m = markers(e);
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "instruction_override_attempt",
        severity: "warning",
        title: "Possible unsafe instruction detected",
        signal: `A chat message ${m.map(injectionMarkerLabel).join(", ") || "tries to instruct the assistant"}.`,
        explanation:
          "Pattern match on the message, not proof of an attack. Nothing was blocked at this stage: the assistant's " +
          "tools stay restricted and every proposal still needs policy checks and your exact-version approval.",
        method: "fixed_rule",
        status: "suspected",
        enforcement: "observed_after_event",
        dedupeKey: `override:${e.conversationId}`,
      }],
    };
  }
  // Quoted or educational mention of an attack: no automatic verdict, but worth a second look if a reviewer is on.
  return { drafts: [], reviewCandidate: has(e, "QUOTED_ATTACK_TEXT") };
}

function retrievedRules(e: ChatSecurityEvent): RuleResult {
  if (!has(e, "UNTRUSTED_INSTRUCTIONS")) return { drafts: [], reviewCandidate: false };
  const source = String(e.signals.source ?? e.evidenceIds[0] ?? "document");
  return {
    reviewCandidate: false,
    drafts: [{
      ruleId: "untrusted_content_instructions",
      severity: "warning",
      title: "Instructions found inside untrusted content",
      signal: `${source} ${markers(e).map(injectionMarkerLabel).join(", ") || "contains instructions aimed at an AI"}.`,
      explanation:
        "Retrieved documents are data, not instructions: they grant no permissions. Whether the model refused is a " +
        "separate result from the server's own checks, which run on every tool call regardless.",
      method: "fixed_rule",
      status: "suspected",
      enforcement: "observed_after_event",
      dedupeKey: `untrusted:${e.conversationId}:${source}`,
      evidenceIds: e.evidenceIds,
    }],
  };
}

function toolRequestRules(e: ChatSecurityEvent, ctx: RuleContext): RuleResult {
  if (e.outcome !== "deny") return { drafts: [], reviewCandidate: false };
  if (has(e, "SENSITIVE_DATA")) {
    const patterns = Array.isArray(e.signals.sensitive) ? (e.signals.sensitive as unknown[]).map(String) : [];
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "sensitive_tool_input_blocked",
        severity: "critical",
        title: "Tool call blocked: sensitive data in its arguments",
        signal: `The assistant tried to pass ${patterns.map(sensitiveLabel).join(", ") || "a sensitive pattern"} to ${e.tool ?? "a tool"}.`,
        explanation:
          "The dispatcher refused the call before it ran, and the arguments were redacted before they reached the " +
          "activity trace or the audit log, so nothing was shown or stored.",
        method: "fixed_rule",
        status: "confirmed_policy_violation",
        enforcement: "blocked_before_tool",
        dedupeKey: `sensitive_tool:${e.id}`,
      }],
    };
  }
  if (has(e, "UNKNOWN_TOOL") || has(e, "NOT_ALLOWED_FOR_AGENT")) {
    const attempts = ctx.conversation.filter(
      (c) => c.stage === "tool_request" && c.outcome === "deny" && (has(c, "UNKNOWN_TOOL") || has(c, "NOT_ALLOWED_FOR_AGENT")),
    );
    const tools = [...new Set(attempts.map((c) => c.tool ?? "?"))];
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "forbidden_tool_request",
        severity: attempts.length >= RULE_THRESHOLDS.forbiddenCritical ? "critical" : "warning",
        title: "Attempted tool use blocked",
        signal: `The assistant asked for ${tools.join(", ")} ${plural(attempts.length, "time")} in this conversation.`,
        explanation:
          has(e, "UNKNOWN_TOOL")
            ? "No such tool exists for the assistant. The tool dispatcher refused it before anything ran."
            : "That tool belongs to a different assistant agent. The dispatcher refused it before anything ran.",
        method: "fixed_rule",
        status: "confirmed_policy_violation",
        enforcement: "blocked_before_tool",
        dedupeKey: `forbidden_tool:${e.conversationId}`,
      }],
    };
  }
  if (has(e, "TOOL_BUDGET_EXCEEDED")) {
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "tool_budget_exceeded",
        severity: "warning",
        title: "Tool-call budget reached",
        signal: `The assistant reached the limit of ${String(e.signals.limit ?? "?")} tool calls in one turn.`,
        explanation: "Further tool calls were refused by the server. The model can't extend its own budget.",
        method: "fixed_rule",
        status: "confirmed_policy_violation",
        enforcement: "blocked_before_tool",
        dedupeKey: `budget:${e.turnId}`,
      }],
    };
  }
  if (has(e, "INVALID_INPUT")) {
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "malformed_tool_call",
        severity: "info",
        title: "Malformed tool call rejected",
        signal: `${e.tool ?? "A tool"} was called with arguments that failed validation.`,
        explanation: "Typed argument validation rejected the call before it ran. Often a model mistake rather than an attack.",
        method: "fixed_rule",
        status: "suspected",
        enforcement: "blocked_before_tool",
        dedupeKey: `malformed:${e.conversationId}`,
      }],
    };
  }
  return { drafts: [], reviewCandidate: false };
}

function toolResultRules(e: ChatSecurityEvent, ctx: RuleContext): RuleResult {
  if (e.outcome === "deny" && has(e, "NOT_FOUND")) {
    const refusals = ctx.conversation.filter((c) => c.stage === "tool_result" && c.outcome === "deny" && has(c, "NOT_FOUND"));
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "foreign_resource_request",
        severity: refusals.length >= RULE_THRESHOLDS.notFoundWarning ? "warning" : "info",
        title:
          refusals.length >= RULE_THRESHOLDS.notFoundWarning
            ? "Repeated requests for unavailable records"
            : "Request for an unavailable record",
        // Never says whether the record exists or who owns it.
        signal: `${plural(refusals.length, "tool call")} in this conversation asked for accounts, recipients or records that don't exist or aren't yours.`,
        explanation:
          "The server derives identity from your session and checks ownership before any read. Each call was refused " +
          "as \"not found\" and no data was returned.",
        method: "fixed_rule",
        status: "suspected",
        enforcement: "blocked_before_tool",
        dedupeKey: `not_found:${e.conversationId}`,
      }],
    };
  }
  if (e.outcome === "allow" && has(e, "PROPOSAL_CREATED")) {
    const earlier = ctx.conversation.filter(
      (c) => c.turnId === e.turnId && c.id < e.id &&
        ((c.stage === "input" && (has(c, "INJECTION_MARKERS") || has(c, "QUOTED_ATTACK_TEXT"))) ||
          (c.stage === "retrieved_content" && has(c, "UNTRUSTED_INSTRUCTIONS"))),
    );
    if (earlier.length === 0) return { drafts: [], reviewCandidate: false };
    return {
      reviewCandidate: false,
      drafts: [{
        ruleId: "injection_followed_by_proposal",
        severity: "critical",
        title: "Assistant drafted a proposal after injected instructions",
        signal: `${e.tool ?? "A proposal tool"} ran in the same turn as ${earlier.some((c) => c.stage === "retrieved_content") ? "untrusted content with" : "a message with"} embedded instructions.`,
        explanation:
          "A model-layer slip worth checking: the proposal moves nothing. Policy checks still ran, and it needs your " +
          "exact-version approval in the app before anything executes.",
        method: "fixed_rule",
        status: "suspected",
        enforcement: "observed_after_event",
        dedupeKey: `inj_proposal:${e.turnId}`,
        evidenceIds: e.evidenceIds,
      }],
    };
  }
  return { drafts: [], reviewCandidate: false };
}

function outputRules(e: ChatSecurityEvent): RuleResult {
  const drafts: FindingDraft[] = [];
  if (has(e, "SENSITIVE_DATA")) {
    const patterns = Array.isArray(e.signals.sensitive) ? (e.signals.sensitive as unknown[]).map(String) : [];
    drafts.push({
      ruleId: "sensitive_output_withheld",
      severity: "critical",
      title: "Reply withheld: sensitive data",
      signal: `A draft reply contained ${patterns.map(sensitiveLabel).join(", ") || "a sensitive pattern"}.`,
      explanation:
        "The reply was buffered and checked before release, then replaced with a safe message. No part of it reached " +
        "the browser. Only a redacted excerpt is stored.",
      method: "fixed_rule",
      status: "confirmed_policy_violation",
      enforcement: "blocked_before_release",
      dedupeKey: `sensitive:${e.id}`,
      evidenceIds: e.evidenceIds,
    });
  }
  const issues = Array.isArray(e.signals.issues) ? (e.signals.issues as { reason?: string; claimed?: string; actual?: string }[]) : [];
  const describe = (reason: string) =>
    issues.filter((i) => i.reason === reason).map((i) => `claimed ${i.claimed}${i.actual ? `; records say ${i.actual}` : ""}`).join(". ");
  if (has(e, "UNSUPPORTED_EXECUTION_CLAIM")) {
    drafts.push({
      ruleId: "unsupported_execution_claim",
      severity: "warning",
      title: "Reply withheld: unsupported execution claim",
      signal: describe("UNSUPPORTED_EXECUTION_CLAIM") || "The draft reply claimed money moved.",
      explanation:
        "The assistant can't approve or execute. The claim contradicted Onera's own records, so the reply was " +
        "replaced with the verified status before display.",
      method: "fixed_rule",
      status: "confirmed_policy_violation",
      enforcement: "blocked_before_release",
      dedupeKey: `exec_claim:${e.id}`,
      evidenceIds: e.evidenceIds,
    });
  }
  if (has(e, "AMOUNT_MISMATCH")) {
    drafts.push({
      ruleId: "amount_contradiction",
      severity: "warning",
      title: "Reply withheld: amount didn't match the proposal",
      signal: describe("AMOUNT_MISMATCH") || "The draft reply stated a different amount than the proposal.",
      explanation: "Amounts are checked against the structured proposal the server created; the verified amount was shown instead.",
      method: "fixed_rule",
      status: "confirmed_policy_violation",
      enforcement: "blocked_before_release",
      dedupeKey: `amount:${e.id}`,
      evidenceIds: e.evidenceIds,
    });
  }
  if (has(e, "INLINE_CHECK_UNAVAILABLE")) {
    drafts.push({
      ruleId: "inline_gate_unavailable",
      severity: "critical",
      title: "Safety check unavailable: reply withheld",
      signal: "A required output check couldn't complete for this reply.",
      explanation: "When a mandatory check fails, the reply is withheld rather than released unchecked. Protections are never removed to restore chat.",
      method: "fixed_rule",
      status: "needs_review",
      enforcement: "blocked_before_release",
      dedupeKey: `gate_down:${e.id}`,
    });
  }
  let reviewCandidate = false;
  if (has(e, "AMBIGUOUS_CLAIM") && e.outcome !== "deny") {
    reviewCandidate = true;
    drafts.push({
      ruleId: "ambiguous_financial_claim",
      severity: "info",
      title: "Status claim couldn't be verified automatically",
      signal: describe("AMBIGUOUS_CLAIM") || "The reply described a completed transfer or order without naming one.",
      explanation:
        "Free-form statements can't always be matched to a record. The reply was released; check the Transfers or " +
        "Trade page for the authoritative status.",
      method: "fixed_rule",
      status: "needs_review",
      enforcement: "observed_after_event",
      dedupeKey: `ambiguous:${e.id}`,
      evidenceIds: e.evidenceIds,
    });
  }
  return { drafts, reviewCandidate };
}

export function applyRules(event: ChatSecurityEvent, ctx: RuleContext): RuleResult {
  switch (event.stage) {
    case "input": return inputRules(event);
    case "retrieved_content": return retrievedRules(event);
    case "tool_request": return toolRequestRules(event, ctx);
    case "tool_result": return toolResultRules(event, ctx);
    case "output": return outputRules(event);
    case "health": return { drafts: [], reviewCandidate: false };
  }
}
