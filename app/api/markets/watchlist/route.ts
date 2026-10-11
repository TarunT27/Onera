import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { addToWatchlist, listWatchlist } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** The symbols the signed-in user added to their Trade watchlist. */
export const GET = handler(async () =>
  NextResponse.json({ watchlist: listWatchlist(getDb(), await getSessionUserId()) }),
);

/** Body: { symbol }. Adds a stock or ETF found through search. */
export const POST = handler(async (req: Request) => {
  const watchlist = addToWatchlist(getDb(), await getSessionUserId(), await readJson(req));
  return NextResponse.json({ watchlist }, { status: 201 });
});
