import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { removeFromWatchlist } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Removes a symbol from the signed-in user's watchlist. */
export const DELETE = handler(async (_req: Request, ctx: { params: Promise<{ symbol: string }> }) => {
  const watchlist = removeFromWatchlist(getDb(), await getSessionUserId(), (await ctx.params).symbol);
  return NextResponse.json({ watchlist });
});
