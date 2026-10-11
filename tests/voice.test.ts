// Voice is transport only: ElevenLabs turns speech into text and replies into
// speech, the key never reaches a client or an error message, and a spoken
// prompt changes reply style but not which tools the agent gets.
import { afterEach, describe, expect, it, vi } from "vitest";
import { routeVoiceCommand } from "@/app/components/voiceIntent";
import { ServiceError } from "@/lib/errors";
import { MAX_SPOKEN_CHARS, speechText, synthesize, transcribe, voiceStatus } from "@/lib/voice";
import { freshDb } from "./helpers";

const KEY = "xi-test-key-123";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function stubElevenLabs(response: () => Response) {
  vi.stubEnv("ELEVENLABS_API_KEY", KEY);
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function serviceError(promise: Promise<unknown>): Promise<ServiceError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ServiceError) return err;
    throw err;
  }
  throw new Error("Expected a ServiceError");
}

const audio = () => new File([new Uint8Array(2048)], "speech.webm", { type: "audio/webm" });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ElevenLabs voice I/O", () => {
  it("reports whether voice is configured without exposing the key", () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    expect(voiceStatus().configured).toBe(false);
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    const status = voiceStatus();
    expect(status).toMatchObject({ configured: true, provider: "ElevenLabs", sttModel: "scribe_v2", ttsModel: "eleven_flash_v2_5" });
    expect(JSON.stringify(status)).not.toContain(KEY);
  });

  it("refuses with 503 when no key is configured, without calling ElevenLabs", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const err = await serviceError(transcribe(audio()));
    expect(err.status).toBe(503);
    expect(err.code).toBe("UNSUPPORTED");
    expect((await serviceError(synthesize("Hello"))).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("transcribes with Scribe and the server-side key", async () => {
    const fetchMock = stubElevenLabs(() => json({ text: "  Pay Oak Street Properties $1,850 for rent. ", language_code: "eng" }));
    const result = await transcribe(audio());
    expect(result).toEqual({ text: "Pay Oak Street Properties $1,850 for rent.", languageCode: "eng" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.elevenlabs.io/v1/speech-to-text");
    expect(new Headers(init!.headers).get("xi-api-key")).toBe(KEY);
    const form = init!.body as FormData;
    expect(form.get("model_id")).toBe("scribe_v2");
    expect(form.get("tag_audio_events")).toBe("false");
    expect(form.get("file")).toBeInstanceOf(Blob);
  });

  it("rejects empty, oversized and non-audio uploads before calling ElevenLabs", async () => {
    const fetchMock = stubElevenLabs(() => json({ text: "x" }));
    expect((await serviceError(transcribe(new Blob([], { type: "audio/webm" })))).code).toBe("BAD_REQUEST");
    expect((await serviceError(transcribe(new Blob([new Uint8Array(11 * 1024 * 1024)], { type: "audio/webm" })))).code).toBe("BAD_REQUEST");
    expect((await serviceError(transcribe(new Blob(["hi"], { type: "text/plain" })))).code).toBe("BAD_REQUEST");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns upstream failures into clear errors that never echo the key", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    stubElevenLabs(() => json({ detail: { status: "invalid_api_key", message: "Invalid API key" } }, 401));
    const auth = await serviceError(transcribe(audio()));
    expect(auth.status).toBe(502);
    expect(auth.message).toContain("rejected the API key");
    expect(auth.message).not.toContain(KEY);

    stubElevenLabs(() => json({ detail: { message: "Quota exceeded" } }, 429));
    expect((await serviceError(synthesize("Hello"))).status).toBe(429);
  });

  it("synthesizes cleaned-up speech with the Flash model", async () => {
    const fetchMock = stubElevenLabs(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
    const stream = await synthesize("**Done.** Proposal act_123abc is awaiting your approval.");
    expect(new Uint8Array(await new Response(stream).arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(/^https:\/\/api\.elevenlabs\.io\/v1\/text-to-speech\/JBFqnCBsd6RMkjVDRZzb\?output_format=mp3_44100_128$/);
    const body = JSON.parse(String(init!.body));
    expect(body).toEqual({ text: "Done. Proposal is awaiting your approval.", model_id: "eleven_flash_v2_5" });
  });
});

describe("speechText", () => {
  it("drops markdown, links, URLs and record IDs and ends list items as sentences", () => {
    const reply = [
      "## Spending",
      "- **Groceries** $412.10 (txn_alice_0042)",
      "- Dining $96.00",
      "See [the card](https://example.com/x) or `act_9` for details",
    ].join("\n");
    expect(speechText(reply)).toBe("Spending. Groceries $412.10. Dining $96.00. See the card or for details.");
  });

  it("cuts long replies at a sentence and says the rest is on screen", () => {
    const long = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} is here.`).join(" ");
    const spoken = speechText(long);
    expect(spoken.length).toBeLessThanOrEqual(MAX_SPOKEN_CHARS + 40);
    expect(spoken).toMatch(/is here\. The full answer is on screen\.$/);
  });
});

describe("voice command routing (deterministic, no model)", () => {
  it("navigates on short page commands", () => {
    expect(routeVoiceCommand("Open transfers.")).toEqual({ kind: "navigate", href: "/transfers", label: "Transfers" });
    expect(routeVoiceCommand("Okay, take me to the trade page")).toMatchObject({ href: "/trade" });
    expect(routeVoiceCommand("Hey Onera, show me my accounts")).toMatchObject({ href: "/accounts" });
    expect(routeVoiceCommand("go home")).toMatchObject({ href: "/" });
    expect(routeVoiceCommand("Open the family tab")).toMatchObject({ href: "/family" });
    expect(routeVoiceCommand("Show me my spending")).toEqual({ kind: "ask", agent: "general" });
  });

  it("sends explicit buys and sells to the Trade drafter and everything else to the general assistant", () => {
    expect(routeVoiceCommand("Buy $250 of NVDA in my paper account.")).toEqual({ kind: "ask", agent: "drafter" });
    expect(routeVoiceCommand("Um, can you sell two shares of VTI?")).toEqual({ kind: "ask", agent: "drafter" });
    expect(routeVoiceCommand("Place a paper order for Apple")).toEqual({ kind: "ask", agent: "drafter" });
    expect(routeVoiceCommand("Is buying NVDA risky right now?")).toEqual({ kind: "ask", agent: "general" });
    expect(routeVoiceCommand("Pay Oak Street Properties $1,850 for rent")).toEqual({ kind: "ask", agent: "general" });
    // Approval is never a voice route: it reaches the assistant, which has no approve tool.
    expect(routeVoiceCommand("Approve the transfer")).toEqual({ kind: "ask", agent: "general" });
  });
});

describe("spoken chat prompts", () => {
  const reply = {
    id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5",
    content: [{ type: "text", text: "Your accounts look fine." }],
    stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
  };

  async function run(source?: "voice" | "text") {
    vi.resetModules();
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.stubEnv("CLEARFI_AI_MODE", "live");
    vi.stubEnv("CLEARFI_SERVER_FALLBACK", "false");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => json(reply));
    vi.stubGlobal("fetch", fetchMock);
    const { runChat, VOICE_BRIEF } = await import("@/lib/ai/chat");
    const db = freshDb();
    await runChat(db, "alice", { source, messages: [{ role: "user", content: "How are my accounts?" }] });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]!.body));
    const audit = db
      .prepare("SELECT detail AS d FROM audit_events WHERE user_id = 'alice' AND event_type = 'assistant.prompt' ORDER BY id DESC LIMIT 1")
      .get() as { d: string };
    db.close();
    return { body, audit: JSON.parse(audit.d), VOICE_BRIEF };
  }

  it("asks for a short spoken reply and audits the prompt as voice", async () => {
    const { body, audit, VOICE_BRIEF } = await run("voice");
    expect(body.system[1].text).toContain(VOICE_BRIEF);
    expect(audit.source).toBe("voice");
  });

  it("keeps the same tools for spoken and typed prompts", async () => {
    const voice = await run("voice");
    const text = await run();
    expect(text.body.system[1].text).not.toContain(text.VOICE_BRIEF);
    expect(text.audit.source).toBe("text");
    expect(voice.body.tools.map((t: { name: string }) => t.name)).toEqual(text.body.tools.map((t: { name: string }) => t.name));
  });
});
