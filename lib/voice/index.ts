/**
 * Voice I/O through ElevenLabs: speech-to-text (Scribe) and text-to-speech.
 *
 * Voice is only a transport. The UI sends a transcript to POST /api/chat like
 * typed text, so the same agents, tool scoping, policy checks and exact-version
 * approval apply. Nothing here reads or writes user data, and the API key never
 * leaves the server.
 */
import { badRequest, ServiceError } from "@/lib/errors";

const API = "https://api.elevenlabs.io/v1";

/** About two minutes of browser-recorded Opus; far more than one command needs. */
export const MAX_AUDIO_BYTES = 10 * 1024 * 1024;
/** Longer replies are cut at a sentence boundary before synthesis. The full text stays on screen. */
export const MAX_SPOKEN_CHARS = 900;

function config() {
  return {
    apiKey: process.env.ELEVENLABS_API_KEY?.trim() ?? "",
    // "George", one of ElevenLabs' default voices.
    voiceId: process.env.ELEVENLABS_VOICE_ID?.trim() || "JBFqnCBsd6RMkjVDRZzb",
    ttsModel: process.env.ELEVENLABS_TTS_MODEL?.trim() || "eleven_flash_v2_5",
    sttModel: process.env.ELEVENLABS_STT_MODEL?.trim() || "scribe_v2",
  };
}

export interface VoiceStatus {
  configured: boolean;
  provider: "ElevenLabs";
  sttModel: string;
  ttsModel: string;
}

export function voiceStatus(): VoiceStatus {
  const { apiKey, sttModel, ttsModel } = config();
  return { configured: apiKey !== "", provider: "ElevenLabs", sttModel, ttsModel };
}

function requireKey(): string {
  const { apiKey } = config();
  if (!apiKey) {
    throw new ServiceError(
      "UNSUPPORTED",
      "Voice is not configured. Add ELEVENLABS_API_KEY to .env.local and restart the server.",
      503,
    );
  }
  return apiKey;
}

/** Calls ElevenLabs and turns any failure into a ServiceError that never echoes the key. */
async function callElevenLabs(url: string, init: RequestInit, what: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: "no-store" });
  } catch (err) {
    console.warn(`[clearfi] ElevenLabs ${what} unreachable:`, err instanceof Error ? err.message : err);
    throw new ServiceError("INTERNAL", "ElevenLabs could not be reached.", 502);
  }
  if (res.ok) return res;

  const raw = await res.text().catch(() => "");
  console.warn(`[clearfi] ElevenLabs ${what} failed: ${res.status} ${raw.slice(0, 300)}`);
  let detail = "";
  try {
    const body = JSON.parse(raw) as { detail?: { message?: unknown } | string };
    const message = typeof body.detail === "string" ? body.detail : body.detail?.message;
    if (typeof message === "string") detail = message.slice(0, 200);
  } catch {
    /* non-JSON error body */
  }
  const status = res.status === 429 ? 429 : 502;
  const reason =
    res.status === 401 || res.status === 403 ? "ElevenLabs rejected the API key. Check ELEVENLABS_API_KEY."
    : res.status === 429 ? "ElevenLabs rate limit or quota reached."
    : `ElevenLabs ${what} failed (${res.status}).`;
  throw new ServiceError("INTERNAL", detail ? `${reason} ${detail}` : reason, status);
}

export interface Transcript {
  text: string;
  /** ISO language code ElevenLabs detected, if any. */
  languageCode: string | null;
}

export async function transcribe(audio: Blob): Promise<Transcript> {
  const apiKey = requireKey();
  if (audio.size === 0) throw badRequest("The recording is empty");
  if (audio.size > MAX_AUDIO_BYTES) throw badRequest("The recording is too long. Keep voice commands under a minute.");
  if (audio.type && !/^(audio|video)\//.test(audio.type)) throw badRequest("The recording must be an audio file");

  const form = new FormData();
  form.append("model_id", config().sttModel);
  // Bracketed tags like "(laughter)" would otherwise end up in the prompt.
  form.append("tag_audio_events", "false");
  form.append("file", audio, audio instanceof File && audio.name ? audio.name : "speech.webm");

  const res = await callElevenLabs(`${API}/speech-to-text`, {
    method: "POST", headers: { "xi-api-key": apiKey }, body: form,
  }, "transcription");
  const body = (await res.json()) as { text?: unknown; language_code?: unknown };
  return {
    text: typeof body.text === "string" ? body.text.trim() : "",
    languageCode: typeof body.language_code === "string" ? body.language_code : null,
  };
}

/** Synthesizes a reply. Returns the upstream MP3 stream so the route can pass it through. */
export async function synthesize(text: string): Promise<ReadableStream<Uint8Array>> {
  const apiKey = requireKey();
  const spoken = speechText(text);
  if (!spoken) throw badRequest("There is nothing to say");
  const { voiceId, ttsModel } = config();
  const res = await callElevenLabs(
    `${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
      body: JSON.stringify({ text: spoken, model_id: ttsModel }),
    },
    "speech",
  );
  if (!res.body) throw new ServiceError("INTERNAL", "ElevenLabs returned no audio.", 502);
  return res.body;
}

/**
 * Turns a chat reply into something worth hearing: no markdown, links, URLs or
 * snake_case record IDs, and at most MAX_SPOKEN_CHARS, ending on a sentence.
 */
export function speechText(text: string): string {
  const lines = text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,!?:;]|$)/gm, "$1$2")
    .replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/gi, " ")
    .split("\n")
    .map((line) =>
      line
        .replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+•]\s+|\d+[.)]\s+)/, "")
        .replace(/\|/g, ", ")
        .replace(/^[\s,:-]+|[\s,]+$/g, "")
        .replace(/\s{2,}/g, " ")
        .replace(/\(\s*\)/g, "")
        .trim(),
    )
    .filter((line) => /[a-z0-9]/i.test(line))
    .map((line) => (/[.!?:;]$/.test(line) ? line : `${line}.`));

  const spoken = lines.join(" ").replace(/\s+([.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
  if (spoken.length <= MAX_SPOKEN_CHARS) return spoken;
  const cut = spoken.slice(0, MAX_SPOKEN_CHARS);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const head = end > MAX_SPOKEN_CHARS / 3 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  return `${head} The full answer is on screen.`;
}
