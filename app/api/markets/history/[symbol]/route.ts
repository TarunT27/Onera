import { NextResponse } from "next/server";
import { notFound } from "@/lib/errors";
import { handler } from "@/lib/http";
import { getPriceHistory, getQuote, MAX_HISTORY_DAYS } from "@/lib/markets";

/** GET /api/markets/history/:symbol?days=30 — daily simulated closes plus the current price. */
export const GET = handler(async (req: Request, ctx: { params: Promise<{ symbol: string }> }) => {
  const { symbol } = await ctx.params;
  const days = Number(new URL(req.url).searchParams.get("days")) || 30;
  const history = getPriceHistory(decodeURIComponent(symbol), Math.min(Math.max(days, 1), MAX_HISTORY_DAYS));
  if (!history) throw notFound("Instrument");
  return NextResponse.json({ history, quote: getQuote(history.symbol) });
});
