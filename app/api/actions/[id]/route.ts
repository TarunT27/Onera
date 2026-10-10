import { NextResponse } from "next/server";
import { editTransfer, getAction } from "@/lib/actions/service";
import { getDb } from "@/lib/db";
import { getOwnedAccount, getOwnedRecipient } from "@/lib/finance/accounts";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";
import { recipientStatus } from "@/lib/types";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const action = getAction(db, userId, (await ctx.params).id);
  const recipient = getOwnedRecipient(db, userId, action.recipientId);
  return NextResponse.json({
    action,
    recipient: { ...recipient, status: recipientStatus(recipient) },
    sourceAccount: getOwnedAccount(db, userId, action.sourceAccountId),
  });
});

/** Material edit: bumps version, discards approval, re-evaluates. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const action = editTransfer(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json({ action });
});
