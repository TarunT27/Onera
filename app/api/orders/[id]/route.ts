import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { editOrder, findInstrument, getOrder, getQuote } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const order = getOrder(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json({ order, instrument: findInstrument(order.symbol), quote: getQuote(order.symbol) });
});

/** Material edit: bumps version, discards approval (and any mandate), re-prices and re-evaluates. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const order = editOrder(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json({ order });
});
