import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { evaluateOrder } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Re-prices at the current simulated quote and reruns policy. A new price bound means a new version. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const order = evaluateOrder(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ order });
});
