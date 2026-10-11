import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getPortfolio, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Brokerage accounts (imported view-only, Onera paper, connected Alpaca) valued at current prices. */
export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const refresh = await refreshMarketData(db, userId);
  return NextResponse.json({ portfolio: getPortfolio(db, userId), ...(refresh.ok ? {} : { stale: true }) });
});
