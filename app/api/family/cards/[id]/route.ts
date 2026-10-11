import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getFamilyCard, updateFamilyCard } from "@/lib/family";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) =>
  NextResponse.json({ card: getFamilyCard(getDb(), await getSessionUserId(), (await ctx.params).id) }),
);

/** Parent-only: limits, blocked categories, freeze/unfreeze. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const card = updateFamilyCard(getDb(), await getSessionUserId(), (await ctx.params).id, await readJson(req));
  return NextResponse.json({ card });
});
