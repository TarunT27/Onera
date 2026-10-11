import { z } from "zod";
import { handler, readJson } from "@/lib/http";
import { MAX_SPEAK_INPUT_CHARS, synthesize } from "@/lib/voice";

export const maxDuration = 60;

const SpeakSchema = z.object({ text: z.string().min(1).max(MAX_SPEAK_INPUT_CHARS) });

/** `{ text }` → audio/mpeg. Takes a full chat reply; it is cleaned up and shortened for speech first. */
export const POST = handler(async (req: Request) => {
  const { text } = SpeakSchema.parse(await readJson(req));
  return new Response(await synthesize(text), {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
});
