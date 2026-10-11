import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { createOrder, listOrders, refreshMarketData, syncOrders } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** GET /api/orders?state=&limit= — newest first. Open Alpaca orders are synced first. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const db = getDb();
  const userId = await getSessionUserId();
  await syncOrders(db, userId).catch(() => 0);
  const orders = listOrders(db, userId, {
    state: url.searchParams.get("state") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ orders });
});

/** Creates an order and evaluates it immediately (HELD or AWAITING_APPROVAL). Never auto-approves. */
export const POST = handler(async (req: Request) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const body = await readJson(req);
  await refreshMarketData(db, userId);
  const order = createOrder(db, userId, body, "user");
  return NextResponse.json({ order }, { status: 201 });
});
