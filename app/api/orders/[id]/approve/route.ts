import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { approveOrder, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Body: { version }. Approves the exact version (incl. price bound) the user reviewed; the server computes the hash. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const body = await readJson(req);
  await refreshMarketData(db, userId);
  const order = approveOrder(db, userId, (await ctx.params).id, body);
  return NextResponse.json({ order });
});
