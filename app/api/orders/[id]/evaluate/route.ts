import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { evaluateOrder, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Re-prices at the current quote and reruns policy. A new price bound means a new version. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  const userId = await getSessionUserId();
  await refreshMarketData(db, userId);
  const order = evaluateOrder(db, userId, (await ctx.params).id);
  return NextResponse.json({ order });
});
