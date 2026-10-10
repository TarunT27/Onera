import { afterEach, describe, expect, it, vi } from "vitest";
import { freshDb } from "./helpers";

const reply = {
  id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
  content: [{ type: "text", text: "Your synthetic accounts are ready to review." }],
  stop_reason: "end_turn", stop_sequence: null,
  usage: { input_tokens: 10, output_tokens: 10 },
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json" },
});

async function setup(beta = false) {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("CLEARFI_AI_MODE", "live");
  vi.stubEnv("CLEARFI_MODEL", "claude-opus-5-5");
  vi.stubEnv("CLEARFI_SERVER_FALLBACK", beta ? "true" : "false");
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => json(reply));
  vi.stubGlobal("fetch", fetchMock);
  const { runChat } = await import("@/lib/ai/chat");
  return { runChat, fetchMock };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Claude request compatibility (mocked HTTP; no live API calls)", () => {
  it("uses the configured valid model without optional effort or beta flags by default", async () => {
    const { runChat, fetchMock } = await setup();
    const db = freshDb();
    const response = await runChat(db, "alice", { messages: [{ role: "user", content: "Read my accounts" }] });

    expect(response.mode).toBe("live");
    expect(response.proposedActionIds).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const options = fetchMock.mock.calls[0][1]!;
    const body = JSON.parse(String(options.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("betas");
    expect(body).not.toHaveProperty("fallbacks");
    expect(new Headers(options.headers).has("anthropic-beta")).toBe(false);
    db.close();
  });

  it("retries an opted-in rejected fallback beta once, then keeps using ordinary requests", async () => {
    const { runChat, fetchMock } = await setup(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => json({
      type: "error", error: { type: "invalid_request_error", message: "Server-side fallback beta unavailable" },
    }, 400));
    const db = freshDb();
    const question = { messages: [{ role: "user" as const, content: "Read my accounts" }] };

    expect((await runChat(db, "alice", question)).mode).toBe("live");
    expect((await runChat(db, "alice", question)).mode).toBe("live");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const requests = fetchMock.mock.calls.map(([, options]) => ({
      body: JSON.parse(String(options!.body)), headers: new Headers(options!.headers),
    }));
    expect(requests[0].body.fallbacks).toBe("default");
    expect(requests[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
    for (const request of requests.slice(1)) {
      expect(request.body).not.toHaveProperty("fallbacks");
      expect(request.headers.has("anthropic-beta")).toBe(false);
    }
    db.close();
  });

  it("returns labeled read-only fallback if the API rejects a model", async () => {
    const { runChat, fetchMock } = await setup();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    fetchMock.mockImplementationOnce(async () => json({
      type: "error", error: { type: "not_found_error", message: "Unknown model" },
    }, 404));
    const db = freshDb();
    const response = await runChat(db, "alice", {
      messages: [{ role: "user", content: "Pay Oak Street Properties $1,850 for rent" }],
    });

    expect(response.mode).toBe("fallback");
    expect(response.proposedActionIds).toEqual([]);
    expect(response.trace.every((entry) => entry.tool !== "propose_transfer")).toBe(true);
    expect(db.prepare("SELECT COUNT(*) AS n FROM actions WHERE user_id = ?").get("alice")).toEqual({ n: 0 });
    db.close();
  });
});
