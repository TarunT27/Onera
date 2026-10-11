/**
 * "Ask ClearFi" on a local Ollama model (CLEARFI_AI_PROVIDER=ollama).
 *
 * Same boundary as the Claude loop: the model only sees the agent's tool
 * definitions, every call goes through runTool with the session user, and the
 * loop is bounded. chat.ts runs the same gates on its reply as on Claude's.
 */
import type { BetaTool } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ChatRequest, ToolTraceEntry } from "@/lib/types";
import { runTool, type ToolContext } from "./tools";

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

type OllamaTool = { type: "function"; function: { name: string; description?: string; parameters: unknown } };

async function chatOnce(messages: OllamaMessage[], tools: OllamaTool[]): Promise<OllamaChatResult> {
  const res = await fetch(`${OLLAMA_HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      messages,
      tools,
      stream: false,
      think: false, // reasoning tokens make spoken replies too slow
      keep_alive: "30m",
      options: { temperature: 0.2 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as OllamaChatResult;
}

export type OllamaOutcome =
  | { ok: true; model: string; reply: string }
  | { ok: false; timedOut: boolean };

/**
 * One model turn on Ollama. The caller supplies the system text and the agent's
 * tool definitions; every call still goes through runTool, which enforces
 * ToolContext.allowedTools and the session user. Tool activity is appended to
 * `trace`. The caller runs the output gate and writes the audit entries.
 */
export async function runOllamaTurn(
  ctx: ToolContext,
  request: ChatRequest,
  system: string,
  toolDefs: readonly BetaTool[],
  trace: ToolTraceEntry[],
): Promise<OllamaOutcome> {
  const tools: OllamaTool[] = toolDefs.map((t) => ({
    type: "function" as const,
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
  const messages: OllamaMessage[] = [
    { role: "system", content: system },
    ...request.messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const { message } = await chatOnce(messages, tools);
      if (!message) throw new Error("Ollama returned no message");
      const calls = message.tool_calls ?? [];
      if (calls.length === 0) {
        // Qwen can leak <think> blocks even with think:false; never show or speak them.
        const reply = (message.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
        return { ok: true, model: OLLAMA_MODEL, reply };
      }
      messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
      for (const call of calls) {
        const outcome = runTool(ctx, call.function.name, call.function.arguments);
        trace.push(outcome.trace);
        messages.push({ role: "tool", tool_name: call.function.name, content: outcome.content });
      }
    }
    return { ok: true, model: OLLAMA_MODEL, reply: "" }; // tool-call limit; caller words the notice
  } catch (err) {
    console.warn("[clearfi] ollama chat failed:", err instanceof Error ? err.message : err);
    return { ok: false, timedOut: err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError") };
  }
}
