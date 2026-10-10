import { NextResponse } from "next/server";
import { approveAction } from "@/lib/actions/service";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Approves the exact version the user reviewed. The server computes the approval hash. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const action = approveAction(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json({ action });
});
