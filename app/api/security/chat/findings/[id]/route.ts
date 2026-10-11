import { NextResponse } from "next/server";
import { getFinding } from "@/lib/chatguard";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

/** One of the session user's findings. Another user's finding is 404, never 403. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const finding = getFinding(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ finding });
});
