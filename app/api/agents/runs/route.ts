import { NextResponse } from "next/server";
import { listRuns } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** This user's agent runs, newest first. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const runs = listRuns(getDb(), await getSessionUserId(), {
    agentId: url.searchParams.get("agentId") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ runs });
});
