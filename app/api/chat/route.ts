import { NextResponse } from "next/server";
import { runChat } from "@/lib/ai/chat";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";
import { ChatRequestSchema } from "@/lib/types";

export const maxDuration = 120;

export const POST = handler(async (req: Request) => {
  const request = ChatRequestSchema.parse(await readJson(req));
  const response = await runChat(getDb(), await getSessionUserId(), request);
  return NextResponse.json(response);
});
