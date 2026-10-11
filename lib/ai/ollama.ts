/**
 * "Ask ClearFi" on a local Ollama model (CLEARFI_AI_PROVIDER=ollama).
 *
 * Same boundary as the Claude loop: the model only sees TOOL_DEFINITIONS, every
 * call goes through runTool with the session user, and the loop is bounded.
 * Nothing the model says can approve or execute a transfer.
 */
import { writeAudit } from "@/lib/audit";
import type { ChatRequest, ChatResponse, ToolTraceEntry } from "@/lib/types";
import { fallbackReply } from "./fallback";
import { SYSTEM_PROMPT } from "./prompt";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "./tools";

export const OLLAMA_HOST = (process.env.OLLAMA_HOST || "http://127.0.0.1:11434").replace(/\/+$/, "");
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3.8:27b";
const MAX_TURNS = 8;
const REQUEST_TIMEOUT_MS = 110_000;

interface OllamaToolCall {
  function: { name: string; arguments?: unknown };
}
interface OllamaMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_name?: string;
}
interface OllamaChatResult {
  message?: OllamaMessage;
}

const OLLAMA_TOOLS = TOOL_DEFINITIONS.map((t) => ({
  type: "function" as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}));

// Spoken answers should be short; the voice UI reads the reply aloud.
const VOICE_HINT = "\n\nReplies may be read aloud: keep them short and avoid markdown, tables and code.";

async function chatOnce(messages: OllamaMessage[]): Promise<OllamaChatResult> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      tools: OLLAMA_TOOLS,
      stream: false,
      think: false, // reasoning tokens make spoken replies too slow
      keep_alive: "30m",
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as OllamaChatResult;
}

export async function runOllamaChat(ctx: ToolContext, request: ChatRequest): Promise<ChatResponse> {
  const { db, userId } = ctx;
  const trace: ToolTraceEntry[] = [];
  const messages: OllamaMessage[] = [
    { role: "system", content: SYSTEM_PROMPT + VOICE_HINT },
    ...request.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  let final: OllamaMessage | undefined;
  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { message } = await chatOnce(messages);
      if (!message) throw new Error("Ollama returned no message");
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        final = message;
        break;
      }
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const outcome = runTool(ctx, call.function.name, call.function.arguments);
        trace.push(outcome.trace);
        messages.push({ role: "tool", tool_name: call.function.name, content: outcome.content });
      }
    }
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    const reason = timedOut
      ? `The local model (${OLLAMA_MODEL}) took too long to answer.`
      : `The local model (${OLLAMA_MODEL}) could not be reached at ${OLLAMA_HOST}. Is Ollama running?`;
    console.warn("[clearfi] ollama chat falling back:", err instanceof Error ? err.message : err);
    const fallback = fallbackReply(db, userId, request, reason);
    return { ...fallback, trace: [...trace, ...fallback.trace], proposedActionIds: ctx.proposedActionIds };
  }

  // Qwen can leak <think> blocks even with think:false; never show or speak them.
  const reply =
    (final?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim() ||
    "I wasn't able to finish that request within the tool-call limit. Please try a narrower question.";

  writeAudit(db, {
    userId, actor: "assistant", eventType: "assistant.reply",
    detail: { model: OLLAMA_MODEL, provider: "ollama", toolCalls: trace.length, proposedActionIds: ctx.proposedActionIds },
  });

  return { mode: "live", model: OLLAMA_MODEL, reply, trace, proposedActionIds: ctx.proposedActionIds };
}
