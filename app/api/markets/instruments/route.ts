import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import {
  getMarketStatus,
  listInstruments,
  listWatchlist,
  pricesDisclaimer,
  refreshMarketData,
  watchlistInstruments,
} from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/**
 * The built-in stocks and ETFs plus the symbols this user added to their watchlist, and the
 * market status (simulated, or the real US clock from Alpaca).
 */
export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  await refreshMarketData(db, userId);
  return NextResponse.json({
    instruments: [...listInstruments(), ...watchlistInstruments(db, userId)],
    watchlist: listWatchlist(db, userId),
    market: getMarketStatus(db),
    disclaimer: pricesDisclaimer(),
  });
});
