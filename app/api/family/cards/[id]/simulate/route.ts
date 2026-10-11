import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { simulateCardPurchase } from "@/lib/family";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Demo: simulate a purchase on a kid's card. Approved or declined by the card's rules. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const result = simulateCardPurchase(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json(result);
});
