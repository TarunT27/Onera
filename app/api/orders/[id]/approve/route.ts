import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { approveOrder, getOrder, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Body: { version }. Approves the exact version (incl. price bound) the user reviewed; the server computes the hash. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const body = await readJson(req);
  const id = (await ctx.params).id;
  await refreshMarketData(db, userId, { symbols: [getOrder(db, userId, id).symbol] });
  const order = approveOrder(db, userId, id, body);
  return NextResponse.json({ order });
});
