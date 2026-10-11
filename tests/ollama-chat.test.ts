// The local Ollama provider keeps the same boundary and gates as the Claude loop.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runChat } from "@/lib/ai/chat";
import { freshDb } from "./helpers";

type Msg = { role: string; content: string; tool_calls?: { function: { name: string; arguments: unknown } }[] };

function mockOllama(replies: Msg[]) {
  const bodies: { messages: Msg[]; tools: { function: { name: string } }[] }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ message: replies[bodies.length - 1] }), { status: 200 });
  }));
  return bodies;
}

const request = { messages: [{ role: "user" as const, content: "What accounts do I have?" }] };

beforeEach(() => vi.stubEnv("CLEARFI_AI_PROVIDER", "ollama"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ollama provider", () => {
  it("runs a read tool for the session user and returns a live, traced reply", async () => {
    const bodies = mockOllama([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "get_accounts", arguments: {} } }] },
      { role: "assistant", content: "<think>hmm</think>You have checking and savings." },
    ]);
    const out = await runChat(freshDb(), "alice", request);
    expect(out.mode).toBe("live");
    expect(out.reply).toContain("You have checking and savings.");
    expect(out.trace.map((t) => t.tool)).toEqual(["get_accounts"]);
    const sent = bodies[0].tools.map((t) => t.function.name);
    expect(sent).toContain("propose_transfer");
    for (const forbidden of ["approve_transfer", "execute_transfer", "update_controls", "verify_recipient"]) {
      expect(sent).not.toContain(forbidden);
    }
    expect(bodies[1].messages.at(-1)?.role).toBe("tool");
  });

  it("rejects privileged tool calls the model invents", async () => {
    mockOllama([
      { role: "assistant", content: "", tool_calls: [{ function: { name: "execute_transfer", arguments: { id: "x" } } }] },
      { role: "assistant", content: "I can't do that." },
    ]);
    const out = await runChat(freshDb(), "alice", request);
    expect(out.trace[0].ok).toBe(false);
    expect(out.proposedActionIds).toEqual([]);
  });

  it("falls back, labeled, when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("fetch failed"); }));
    const out = await runChat(freshDb(), "alice", request);
    expect(out.mode).toBe("fallback");
    expect(out.notice).toMatch(/Ollama/);
  });
});
