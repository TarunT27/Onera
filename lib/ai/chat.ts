/**
 * "Ask Onera" — manual tool loop against the Claude API.
 *
 * The loop is bounded, tools are scoped to the session user, and the trace of
 * every tool call is returned to the UI so the demo shows what the model did.
 *
 * Inline gates (lib/chatguard) run before anything is released:
 *  - a per-user request rate limit, checked before any model or tool call;
 *  - a per-turn tool-call budget, enforced by the tool dispatcher;
 *  - an output gate on the fully buffered reply (never streamed): sensitive
 *    data patterns and transfer/order claims that contradict Onera's records
 *    withhold the reply. If the gate itself fails, the reply is withheld too.
 * Each stage is recorded as a chat security event for the background monitor.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { getAction } from "@/lib/actions/service";
import { writeAudit } from "@/lib/audit";
import {
  chatRateLimit,
  checkOutput,
  countRecentInputs,
  newConversationId,
  newTurnId,
  RATE_WINDOW_MS,
  rateLimitRecordedSince,
  recordEvent,
  referencedRecordIds,
  tryRecordEvent,
  withheldReply,
  type EventReason,
  type OutputDecision,
  type OutputEvidence,
  type RecordEvidence,
} from "@/lib/chatguard";
import type { DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { getOrder } from "@/lib/markets";
import { findInjectionMarkers, looksLikeQuotedOrEducational } from "@/lib/security/injection";
import { redact } from "@/lib/security/redact";
import type { ChatRequest, ChatResponse, ToolTraceEntry, UserId } from "@/lib/types";
import { assistantAgent, type AssistantAgent } from "./agents";
import { fallbackReply } from "./fallback";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOL_DEFINITIONS, type ToolContext, type ToolSecurityContext } from "./tools";

export const MODEL = process.env.CLEARFI_MODEL || "claude-opus-5-5";
const MAX_TURNS = 8;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// Optional beta: ordinary requests must work without account-specific access.
// If an opted-in account rejects it, retry once without it for this process.
let serverFallbackEnabled = process.env.CLEARFI_SERVER_FALLBACK === "true";

async function createMessage(messages: BetaMessageParam[], agent: AssistantAgent): Promise<BetaMessage> {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system: [
      // The shared prompt stays first and cached; the agent brief follows it.
      { type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } },
      { type: "text" as const, text: `Selected agent: ${agent.name}. ${agent.brief}` },
    ],
    tools: TOOL_DEFINITIONS.filter((t) => agent.tools.includes(t.name)),
    messages,
  };
  if (!serverFallbackEnabled) return getClient().beta.messages.create(params);
  try {
    // Re-runs on Anthropic's recommended model if a safety classifier declines.
    return await getClient().beta.messages.create({
      ...params,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (err) {
    if (err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
      console.warn("[clearfi] server-side fallback unavailable; continuing without it");
      serverFallbackEnabled = false;
      return getClient().beta.messages.create(params);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Output gate wiring
// ---------------------------------------------------------------------------

/** Proposals from this turn plus records the reply cites by ID, read with user-scoped services. */
function outputEvidence(db: DB, userId: UserId, reply: string, actionIds: string[], orderIds: string[]): OutputEvidence {
  const records: RecordEvidence[] = [];
  const seen = new Set<string>();
  const addAction = (id: string, proposedThisTurn: boolean) => {
    if (seen.has(id)) return;
    try {
      const a = getAction(db, userId, id);
      seen.add(id);
      records.push({ kind: "transfer", id, state: a.state, amountCents: a.amountCents,
        label: `to ${a.destination.displayName}`, holdReasons: a.holdReasons, proposedThisTurn });
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err; // another user's or unknown ID: not evidence
    }
  };
  const addOrder = (id: string, proposedThisTurn: boolean) => {
    if (seen.has(id)) return;
    try {
      const o = getOrder(db, userId, id);
      seen.add(id);
      records.push({ kind: "order", id, state: o.state, amountCents: o.notionalCents,
        label: `paper ${o.side} ${o.symbol}`, holdReasons: o.holdReasons, proposedThisTurn });
    } catch (err) {
      if (!(err instanceof ServiceError)) throw err;
    }
  };
  for (const id of actionIds) addAction(id, true);
  for (const id of orderIds) addOrder(id, true);
  for (const id of referencedRecordIds(reply)) {
    if (id.startsWith("act_")) addAction(id, false);
    else addOrder(id, false);
  }
  return { records };
}

interface GateResult {
  reply: string;
  withheld: boolean;
  reasons: EventReason[];
}

/**
 * Runs the output gate on a fully buffered reply and records the output event.
 * A gate that throws withholds the reply: required checks are never skipped.
 */
function gateReply(
  db: DB,
  userId: UserId,
  sec: ToolSecurityContext,
  reply: string,
  proposals: { actionIds: string[]; orderIds: string[] },
): GateResult {
  let evidence: OutputEvidence = { records: [] };
  let decision: OutputDecision;
  try {
    evidence = outputEvidence(db, userId, reply, proposals.actionIds, proposals.orderIds);
    decision = checkOutput(reply, evidence);
  } catch (err) {
    console.error("[clearfi] output gate unavailable; withholding reply", err);
    tryRecordEvent(db, {
      userId, conversationId: sec.conversationId, turnId: sec.turnId, agent: sec.agent,
      stage: "output", outcome: "deny", reasons: ["INLINE_CHECK_UNAVAILABLE"],
      evidenceIds: [...proposals.actionIds, ...proposals.orderIds],
    });
    return {
      reply: withheldReply({ sensitive: [], issues: [] }, evidence, { checkUnavailable: true }),
      withheld: true,
      reasons: ["INLINE_CHECK_UNAVAILABLE"],
    };
  }

  const ambiguous = decision.reasons.includes("AMBIGUOUS_CLAIM");
  tryRecordEvent(db, {
    userId, conversationId: sec.conversationId, turnId: sec.turnId, agent: sec.agent,
    stage: "output",
    outcome: decision.release ? "allow" : "deny",
    reasons: decision.reasons,
    evidenceIds: decision.evidenceIds,
    signals: {
      sensitive: decision.sensitive,
      issues: decision.issues.map((i) => ({ reason: i.reason, recordId: i.recordId, claimed: i.claimed, actual: i.actual })),
    },
    // Minimize stored text: only withheld or unverifiable replies keep a (redacted) excerpt.
    excerpt: !decision.release || ambiguous ? reply : null,
  });
  if (decision.release) return { reply, withheld: false, reasons: decision.reasons };
  return { reply: withheldReply(decision, evidence), withheld: true, reasons: decision.reasons };
}

function guardInfo(sec: ToolSecurityContext, gate: GateResult): NonNullable<ChatResponse["guard"]> {
  return {
    withheld: gate.withheld,
    reasons: gate.reasons,
    blockedToolCalls: sec.blocked,
    untrustedInstructions: sec.untrustedInstructions,
  };
}

// ---------------------------------------------------------------------------
// Chat turn
// ---------------------------------------------------------------------------

export async function runChat(db: DB, userId: UserId, request: ChatRequest): Promise<ChatResponse> {
  const agent = assistantAgent(request.agent);
  const conversationId = request.conversationId ?? newConversationId();
  const turnId = newTurnId();
  const lastUser = request.messages[request.messages.length - 1]?.content ?? "";
  const sec: ToolSecurityContext = {
    conversationId, turnId, agent: agent.id, toolCalls: 0, blocked: 0, untrustedInstructions: false,
  };
  const event = { userId, conversationId, turnId, agent: agent.id };

  // --- Gate: per-user rate limit, before any model or tool call ---------------
  const limit = chatRateLimit();
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  if (countRecentInputs(db, userId, since) >= limit) {
    // One refusal event per window: a script hammering the endpoint can't flood the event table.
    if (!rateLimitRecordedSince(db, userId, since)) {
      tryRecordEvent(db, { ...event, stage: "input", outcome: "deny", reasons: ["RATE_LIMITED"], signals: { limit } });
    }
    throw new ServiceError("RATE_LIMITED", `Too many chat requests. The limit is ${limit} per minute; try again shortly.`, 429,
      { limit, windowSeconds: RATE_WINDOW_MS / 1000 });
  }

  // --- Input stage: recorded (redacted), never blocked on pattern matches -----
  const markers = findInjectionMarkers(lastUser);
  const quoted = markers.length > 0 && looksLikeQuotedOrEducational(lastUser);
  // The rate limiter counts these rows, so this one write is required, not best effort.
  recordEvent(db, {
    ...event, stage: "input", outcome: "allow",
    reasons: markers.length === 0 ? [] : quoted ? ["QUOTED_ATTACK_TEXT"] : ["INJECTION_MARKERS"],
    signals: { markers, messages: request.messages.length },
    excerpt: markers.length > 0 ? lastUser : null,
  });
  writeAudit(db, {
    userId, actor: `user:${userId}`, eventType: "assistant.prompt",
    detail: { text: redact(lastUser, 500), agent: agent.id },
  });

  const finish = (response: ChatResponse): ChatResponse => {
    const gate = gateReply(db, userId, sec, response.reply, {
      actionIds: response.proposedActionIds, orderIds: response.proposedOrderIds,
    });
    return { ...response, reply: gate.reply, conversationId, guard: guardInfo(sec, gate) };
  };

  if (process.env.CLEARFI_AI_MODE === "fallback") {
    const fallback = fallbackReply(db, userId, request, "Fallback mode is forced by CLEARFI_AI_MODE.");
    writeAudit(db, {
      userId,
      actor: "assistant",
      eventType: "assistant.reply",
      detail: { mode: "fallback", reason: "forced", agent: agent.id, toolCalls: fallback.trace.length, proposedActionIds: [] },
    });
    return finish(fallback);
  }

  const ctx: ToolContext = {
    db, userId, proposedActionIds: [], proposedOrderIds: [], allowedTools: new Set(agent.tools), security: sec,
  };
  const trace: ToolTraceEntry[] = [];
  const messages: BetaMessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));

  let response: BetaMessage | null = null;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      response = await createMessage(messages, agent);

      if (response.stop_reason === "refusal") break;
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      const toolUses = response.content.filter((b): b is BetaToolUseBlock => b.type === "tool_use");
      if (response.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: response.content });
      const results: BetaToolResultBlockParam[] = toolUses.map((use) => {
        const outcome = runTool(ctx, use.name, use.input);
        trace.push(outcome.trace);
        return { type: "tool_result", tool_use_id: use.id, content: outcome.content, is_error: outcome.isError };
      });
      // All results for one assistant turn go back in a single user message.
      messages.push({ role: "user", content: results });
    }
  } catch (err) {
    const reason =
      err instanceof Anthropic.AuthenticationError ? "No valid Claude API credentials are configured."
      : err instanceof Anthropic.RateLimitError ? "The Claude API rate limit was reached."
      : err instanceof Anthropic.APIConnectionError ? "The Claude API could not be reached."
      : err instanceof Anthropic.APIError ? `Claude API error ${err.status ?? ""}`.trim() + "."
      : err instanceof Error && /api key|apiKey|authToken|credentials/i.test(err.message)
        ? "No Claude API credentials are configured."
      : null;
    if (!reason) throw err;
    console.warn("[clearfi] chat falling back:", err instanceof Error ? err.message : err);
    tryRecordEvent(db, { ...event, stage: "health", outcome: "observe", reasons: ["MODEL_UNAVAILABLE"], signals: { reason } });
    const fallback = fallbackReply(db, userId, request, reason, ctx.proposedActionIds);
    // Keep any real tool activity (e.g. a proposal) that happened before the failure.
    const result = {
      ...fallback, trace: [...trace, ...fallback.trace], proposedOrderIds: ctx.proposedOrderIds ?? [],
    };
    writeAudit(db, {
      userId,
      actor: "assistant",
      eventType: "assistant.reply",
      detail: {
        mode: "fallback", reason, agent: agent.id, toolCalls: result.trace.length,
        proposedActionIds: result.proposedActionIds, proposedOrderIds: result.proposedOrderIds,
      },
    });
    return finish(result);
  }

  const text = (response?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  if (response?.stop_reason === "refusal") {
    tryRecordEvent(db, { ...event, stage: "output", outcome: "observe", reasons: ["MODEL_REFUSAL"] });
  }
  const reply =
    response?.stop_reason === "refusal" ? "I can't help with that request."
    : text || "I wasn't able to finish that request within the tool-call limit. Please try a narrower question.";

  const proposedOrderIds = ctx.proposedOrderIds ?? [];
  const released = finish({
    mode: "live",
    model: response?.model ?? MODEL,
    reply,
    trace,
    proposedActionIds: ctx.proposedActionIds,
    proposedOrderIds,
    agent: agent.id,
  });

  writeAudit(db, {
    userId, actor: "assistant", eventType: "assistant.reply",
    detail: { model: response?.model ?? MODEL, stopReason: response?.stop_reason, toolCalls: trace.length,
      agent: agent.id, proposedActionIds: ctx.proposedActionIds, proposedOrderIds,
      withheld: released.guard?.withheld ?? false },
  });
  return released;
}
