import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { placeOrder } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/**
 * Places an APPROVED order: Onera paper orders fill in the paper broker; orders in a connected
 * Alpaca account are submitted to Alpaca as a limit order at the approved price bound. Enforces
 * approval, policy, pause and the price bound on the server even when called directly. Repeats
 * return the current order instead of executing or submitting again.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const result = await placeOrder(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json(result);
});
