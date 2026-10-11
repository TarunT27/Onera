// C07 (inline part): when a mandatory output check can't complete, the reply is withheld, never released unchecked.
import { describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";

vi.mock("@/lib/chatguard/gates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatguard/gates")>()),
  checkOutput: () => {
    throw new Error("validator crashed");
  },
}));

vi.stubEnv("ANTHROPIC_API_KEY", "test-key-not-real");
vi.stubEnv("CLEARFI_AI_MODE", "live");
vi.stubEnv("CLEARFI_SERVER_FALLBACK", "false");
vi.stubGlobal("fetch", vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
  id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
  content: [{ type: "text", text: "Your spending is up 4% this month." }],
  stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 },
}), { status: 200, headers: { "content-type": "application/json" } })));

const { runChat } = await import("@/lib/ai/chat");
const { listFindings, processChatSecurityBatch } = await import("@/lib/chatguard");

describe("C07 inline gate unavailable", () => {
  it("withholds the reply with a safe message and records the outage", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = freshDb();
    const res = await runChat(db, "alice", { messages: [{ role: "user", content: "How is my spending?" }] });

    expect(res.reply).toMatch(/^I can't show that reply because a required safety check couldn't complete\./);
    expect(res.reply).not.toContain("up 4%");
    expect(res.guard).toMatchObject({ withheld: true, reasons: ["INLINE_CHECK_UNAVAILABLE"] });

    await processChatSecurityBatch(db, { reviewer: null });
    expect(listFindings(db, "alice")).toEqual([
      expect.objectContaining({ ruleId: "inline_gate_unavailable", severity: "critical", enforcement: "blocked_before_release" }),
    ]);
  });
});
