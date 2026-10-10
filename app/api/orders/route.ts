import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { createOrder, listOrders } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** GET /api/orders?state=&limit= — newest first. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const orders = listOrders(getDb(), await getSessionUserId(), {
    state: url.searchParams.get("state") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ orders });
});

/** Creates a paper order and evaluates it immediately (HELD or AWAITING_APPROVAL). Never auto-approves. */
export const POST = handler(async (req: Request) => {
  const order = createOrder(getDb(), await getSessionUserId(), await readJson(req), "user");
  return NextResponse.json({ order }, { status: 201 });
});
