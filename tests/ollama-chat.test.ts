// The local Ollama provider keeps the same boundary as the Claude loop.
import { afterEach, describe, expect, it, vi } from "vitest";
import { runOllamaChat } from "@/lib/ai/ollama";
import { freshDb } from "./helpers";

type Msg = { role: string; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };

function mockOllama(replies: Msg[]) {
  const bodies: { messages: Msg[]; tools: { function: { name: string } }[] }[] = [];
  const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ message: replies[bodies.length - 1] }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return bodies;
}

const request = { messages: [{ role: "user" as const, content: "What accounts do I have?" }] };

afterEach(() => vi.unstubAllGlobals());

describe("ollama provider", () => {
  it("runs a read tool for the session user and returns a live, traced reply", async () => {
    const db = freshDb();
    const bodies = mockOllama([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "get_accounts", arguments: {} } }] },
      { role: "assistant", content: "<think>hmm</think>You have checking and savings." },
    ]);
    const out = await runOllamaChat({ db, userId: "alice", proposedActionIds: [] }, request);
    expect(out.mode).toBe("live");
    expect(out.reply).toBe("You have checking and savings.");
    expect(out.trace.map((t) => t.tool)).toEqual(["get_accounts"]);
    // Model sees exactly the assistant tool list: no approve/execute tools.
    expect(bodies[0].tools.map((t) => t.function.name)).not.toContain("execute_transfer");
    expect(bodies[1].messages.at(-1)?.role).toBe("tool");
  });

  it("rejects privileged tool calls the model invents", async () => {
    const db = freshDb();
    mockOllama([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "execute_transfer", arguments: { id: "x" } } }] },
      { role: "assistant", content: "I can't do that." },
    ]);
    const out = await runOllamaChat({ db, userId: "alice", proposedActionIds: [] }, request);
    expect(out.trace[0].ok).toBe(false);
    expect(out.proposedActionIds).toEqual([]);
  });

  it("falls back, labeled, when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const out = await runOllamaChat({ db: freshDb(), userId: "alice", proposedActionIds: [] }, request);
    expect(out.mode).toBe("fallback");
    expect(out.notice).toMatch(/Ollama/);
  });
});
