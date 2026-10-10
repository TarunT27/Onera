import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { approveOrder } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Body: { version }. Approves the exact version (incl. price bound) the user reviewed; the server computes the hash. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const order = approveOrder(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json({ order });
});
