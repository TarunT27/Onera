import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { editOrder, getInstrument, getOrder, getQuote, refreshMarketData, syncOrders } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const id = (await ctx.params).id;
  const current = getOrder(db, userId, id); // 404 before any broker call
  if (current.state === "SUBMITTING" || current.state === "SUBMITTED") await syncOrders(db, userId).catch(() => 0);
  await refreshMarketData(db, userId, { symbols: [current.symbol] });
  const order = getOrder(db, userId, id);
  return NextResponse.json({ order, instrument: getInstrument(order.symbol, db), quote: getQuote(order.symbol, new Date(), db) });
});

/** Material edit: bumps version, discards approval (and any mandate), re-prices and re-evaluates. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const body = await readJson(req);
  const id = (await ctx.params).id;
  const symbol = (body as { symbol?: unknown } | null)?.symbol;
  await refreshMarketData(db, userId, {
    symbols: [getOrder(db, userId, id).symbol, ...(typeof symbol === "string" ? [symbol] : [])],
  });
  const order = editOrder(db, userId, id, body);
  return NextResponse.json({ order });
});
