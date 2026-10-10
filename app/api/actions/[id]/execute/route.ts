import { NextResponse } from "next/server";
import { executeTransfer } from "@/lib/actions/simulator";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/**
 * Runs the simulator. Enforces approval and policy on the server even when
 * called directly (curl, scripts) without the UI.
 */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const result = executeTransfer(getDb(), await getSessionUserId(), (await ctx.params).id);
  return NextResponse.json(result);
});
