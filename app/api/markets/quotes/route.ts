import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { handler } from "@/lib/http";
import { getMarketStatus, getQuotes, pricesDisclaimer, refreshMarketData } from "@/lib/markets";
import { tpl } from "@/lib/i18n/msg";

const MAX_SYMBOLS = 50;

/** GET /api/markets/quotes?symbols=VTI,AAPL — all instruments when symbols is omitted. */
export const GET = handler(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("symbols");
  const symbols = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (symbols && symbols.length > MAX_SYMBOLS) throw badRequest(tpl("At most {max} symbols per request", { max: MAX_SYMBOLS }));
  const db = getDb();
  const refresh = await refreshMarketData(db, null);
  const { quotes, unknown } = getQuotes(symbols, new Date(), db);
  return NextResponse.json({
    quotes,
    unknown,
    market: getMarketStatus(db),
    disclaimer: pricesDisclaimer(),
    ...(refresh.ok ? {} : { stale: true }),
  });
});
