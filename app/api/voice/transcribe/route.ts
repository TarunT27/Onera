import { NextResponse } from "next/server";
import { badRequest } from "@/lib/errors";
import { handler } from "@/lib/http";
import { transcribe } from "@/lib/voice";

export const maxDuration = 60;

/** multipart/form-data with an `audio` file → `{ text, languageCode }`. Transcribes only; nothing is acted on. */
export const POST = handler(async (req: Request) => {
  const form = await req.formData().catch(() => {
    throw badRequest("Send the recording as multipart form data with an `audio` file");
  });
  const audio = form.get("audio");
  if (!(audio instanceof Blob)) throw badRequest("Missing `audio` file");
  return NextResponse.json(await transcribe(audio));
});
