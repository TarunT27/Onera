import { NextResponse } from "next/server";
import { agentsLive } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Live status of the background agents for this user: state, recent runs, backlog and worker heartbeat. */
export const GET = handler(async () => {
  return NextResponse.json(agentsLive(getDb(), await getSessionUserId()));
});
