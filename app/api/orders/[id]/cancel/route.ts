import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { cancelOrder } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Asks Alpaca to cancel an open order. User only — no assistant or agent tool. Alpaca confirms asynchronously. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const order = await cancelOrder(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ order });
});
