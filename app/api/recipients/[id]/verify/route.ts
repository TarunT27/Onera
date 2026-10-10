import { NextResponse } from "next/server";
import { verifyRecipient } from "@/lib/actions/recipients";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";
import { recipientStatus } from "@/lib/types";

/** Simulated out-of-band verification. Held actions must be re-evaluated afterwards. */
export const POST = handler(async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const recipient = verifyRecipient(getDb(), await getSessionUserId(), id);
  return NextResponse.json({ recipient: { ...recipient, status: recipientStatus(recipient) } });
});
