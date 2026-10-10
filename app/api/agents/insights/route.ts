import { NextResponse } from "next/server";
import { listInsights, parseInsightStatus } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Persisted agent insights for this user. No status = everything except dismissed. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const insights = listInsights(getDb(), await getSessionUserId(), {
    status: parseInsightStatus(url.searchParams.get("status")),
    agentId: url.searchParams.get("agentId") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ insights });
});
