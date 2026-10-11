import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { handler } from "@/lib/http";
import { getMarketStatus, getQuotes, listInstruments, listWatchlist, pricesDisclaimer, refreshMarketData } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";
import { tpl } from "@/lib/i18n/msg";

const MAX_SYMBOLS = 50;

/** GET /api/markets/quotes?symbols=VTI,AAPL — the built-in list plus the user's watchlist when symbols is omitted. */
export const GET = handler(async (req: Request) => {
  const raw = new URL(req.url).searchParams.get("symbols");
  const symbols = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
  if (symbols && symbols.length > MAX_SYMBOLS) throw badRequest(tpl("At most {max} symbols per request", { max: MAX_SYMBOLS }));
  const db = getDb();
  const userId = await getSessionUserId();
  const refresh = await refreshMarketData(db, userId, { symbols });
  const wanted = symbols ?? [...listInstruments().map((i) => i.symbol), ...listWatchlist(db, userId)];
  const { quotes, unknown } = getQuotes(wanted, new Date(), db);
  return NextResponse.json({
    quotes,
    unknown,
    market: getMarketStatus(db),
    disclaimer: pricesDisclaimer(),
    ...(refresh.ok ? {} : { stale: true }),
  });
});
