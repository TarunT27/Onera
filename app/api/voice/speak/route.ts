import { z } from "zod";
import { handler, readJson } from "@/lib/http";
import { synthesize } from "@/lib/voice";

export const maxDuration = 60;

const SpeakSchema = z.object({ text: z.string().min(1).max(8000) });

/** `{ text }` → audio/mpeg. The text is cleaned up and shortened for speech first. */
export const POST = handler(async (req: Request) => {
  const { text } = SpeakSchema.parse(await readJson(req));
  return new Response(await synthesize(text), {
    headers: { "content-type": "audio/mpeg", "cache-control": "no-store" },
  });
});
