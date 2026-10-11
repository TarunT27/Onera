import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { evaluateOrder, getOrder, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Re-prices at the current quote and reruns policy. A new price bound means a new version. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const id = (await ctx.params).id;
  await refreshMarketData(db, userId, { symbols: [getOrder(db, userId, id).symbol] });
  const order = evaluateOrder(db, userId, id);
  return NextResponse.json({ order });
});
