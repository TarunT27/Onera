import { NextResponse } from "next/server";
import { z } from "zod";
import { setInsightStatus } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

const UpdateInsightSchema = z.object({ status: z.enum(["seen", "dismissed"]) });

/** Mark an insight seen or dismissed. Another user's insight is 404. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const { status } = UpdateInsightSchema.parse(await readJson(req));
  const insight = setInsightStatus(getDb(), await getSessionUserId(), (await ctx.params).id, status);
  return NextResponse.json({ insight });
});
