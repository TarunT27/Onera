/**
 * "Ask ClearFi" — manual tool loop against the Claude API.
 *
 * The loop is bounded, tools are scoped to the session user, and the trace of
 * every tool call is returned to the UI so the demo shows what the model did.
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaMessage,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { writeAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import type { ChatRequest, ChatResponse, ToolTraceEntry, UserId } from "@/lib/types";
import { fallbackReply } from "./fallback";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "./tools";

export const MODEL = process.env.CLEARFI_MODEL || "claude-opus-5-5";
const MAX_TURNS = 8;

let client: Anthropic | null = null;
const getClient = () => (client ??= new Anthropic());

// Optional beta: ordinary requests must work without account-specific access.
// If an opted-in account rejects it, retry once without it for this process.
let serverFallbackEnabled = process.env.CLEARFI_SERVER_FALLBACK === "true";

async function createMessage(messages: BetaMessageParam[]): Promise<BetaMessage> {
  const params = {
    model: MODEL,
    max_tokens: 16000,
    system: [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }],
    tools: TOOL_DEFINITIONS,
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

export async function runChat(db: DB, userId: UserId, request: ChatRequest): Promise<ChatResponse> {
  const lastUser = request.messages[request.messages.length - 1]?.content ?? "";
  writeAudit(db, { userId, actor: `user:${userId}`, eventType: "assistant.prompt", detail: { text: lastUser.slice(0, 500) } });

  if (process.env.CLEARFI_AI_MODE === "fallback") {
    const fallback = fallbackReply(db, userId, request, "Fallback mode is forced by CLEARFI_AI_MODE.");
    writeAudit(db, {
      userId,
      actor: "assistant",
      eventType: "assistant.reply",
      detail: { mode: "fallback", reason: "forced", toolCalls: fallback.trace.length, proposedActionIds: [] },
    });
    return fallback;
  }

  const ctx: ToolContext = { db, userId, proposedActionIds: [] };
  const trace: ToolTraceEntry[] = [];
  const messages: BetaMessageParam[] = request.messages.map((m) => ({ role: m.role, content: m.content }));

  let response: BetaMessage | null = null;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      response = await createMessage(messages);

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
    const fallback = fallbackReply(db, userId, request, reason, ctx.proposedActionIds);
    // Keep any real tool activity (e.g. a proposal) that happened before the failure.
    const result = { ...fallback, trace: [...trace, ...fallback.trace] };
    writeAudit(db, {
      userId,
      actor: "assistant",
      eventType: "assistant.reply",
      detail: { mode: "fallback", reason, toolCalls: result.trace.length, proposedActionIds: result.proposedActionIds },
    });
    return result;
  }

  const text = (response?.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();

  const reply =
    response?.stop_reason === "refusal" ? "I can't help with that request."
    : text || "I wasn't able to finish that request within the tool-call limit. Please try a narrower question.";

  writeAudit(db, {
    userId, actor: "assistant", eventType: "assistant.reply",
    detail: { model: response?.model ?? MODEL, stopReason: response?.stop_reason, toolCalls: trace.length,
      proposedActionIds: ctx.proposedActionIds },
  });

  return {
    mode: "live",
    model: response?.model ?? MODEL,
    reply,
    trace,
    proposedActionIds: ctx.proposedActionIds,
  };
}
