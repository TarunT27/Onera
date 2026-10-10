import { NextResponse } from "next/server";
import { badRequest } from "@/lib/errors";
import { handler } from "@/lib/http";
import { getQuotes, SIMULATED_MARKET_STATUS, SIMULATED_PRICES_DISCLAIMER } from "@/lib/markets";

const MAX_SYMBOLS = 50;

/** GET /api/markets/quotes?symbols=VTI,AAPL — all instruments when symbols is omitted. */
export const GET = handler(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("symbols");
  const symbols = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (symbols && symbols.length > MAX_SYMBOLS) throw badRequest(`At most ${MAX_SYMBOLS} symbols per request`);
  const { quotes, unknown } = getQuotes(symbols);
  return NextResponse.json({
    quotes,
    unknown,
    market: { status: "open", label: SIMULATED_MARKET_STATUS },
    disclaimer: SIMULATED_PRICES_DISCLAIMER,
  });
});
