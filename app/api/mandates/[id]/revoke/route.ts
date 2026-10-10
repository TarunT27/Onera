import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { revokeMandate } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Revokes immediately; already-authorized but unexecuted mandate orders are refused at execution. Idempotent. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const mandate = revokeMandate(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ mandate });
});
