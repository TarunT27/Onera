import { NextResponse } from "next/server";
import { getControls } from "@/lib/controls";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getTradingControls, ordersExecutedTodayCents, updateTradingControls } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Trading limits plus the global pause (which lives in /api/controls and blocks orders too). */
export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  return NextResponse.json({
    controls: getTradingControls(db, userId),
    paused: getControls(db, userId).paused,
    usage: { executedTodayCents: ordersExecutedTodayCents(db, userId, new Date()) },
  });
});

/** Body: { perOrderLimitCents?, dailyOrderLimitCents? }. User only — no assistant or agent tool. */
export const PATCH = handler(async (req: Request) => {
  const controls = updateTradingControls(getDb(), await getSessionUserId(), await readJson(req));
  return NextResponse.json({ controls });
});
