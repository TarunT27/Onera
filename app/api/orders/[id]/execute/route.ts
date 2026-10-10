import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { executeOrder } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/**
 * Runs the paper broker. Enforces approval, policy, pause and the price bound
 * on the server even when called directly. Repeats return the original fill.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const result = executeOrder(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json(result);
});
