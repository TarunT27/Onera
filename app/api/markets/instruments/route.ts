import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getMarketStatus, listInstruments, pricesDisclaimer, refreshMarketData } from "@/lib/markets";

/** Supported stocks and ETFs, plus the market status (simulated, or the real US clock from Alpaca). No user records. */
export const GET = handler(async () => {
  const db = getDb();
  await refreshMarketData(db, null);
  return NextResponse.json({
    instruments: listInstruments(),
    market: getMarketStatus(db),
    disclaimer: pricesDisclaimer(),
  });
});
