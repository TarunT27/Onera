import { NextResponse } from "next/server";
import { evaluateAction } from "@/lib/actions/service";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const action = evaluateAction(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ action });
});
