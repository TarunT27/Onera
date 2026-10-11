import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { quoteSource, searchMarket } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/**
 * GET /api/markets/search?q=tesla — stocks and ETFs by ticker or name, best match first (max 20).
 * Simulated mode searches the built-in list; Alpaca mode searches every tradable US equity.
 */
export const GET = handler(async (req: Request) => {
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 40);
  const db = getDb();
  const results = q.trim() ? await searchMarket(db, await getSessionUserId(), q) : [];
  return NextResponse.json({ results, scope: quoteSource() === "simulated" ? "built_in" : "us_equities" });
});
