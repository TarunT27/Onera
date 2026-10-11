import { NextResponse } from "next/server";
import { enqueueJob, getAgent, getLatestBriefing, lastRunByAgent, runPendingJobs } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Jobs processed per refresh click. The background worker handles anything left over. */
const RUN_LIMIT = 50;

function body(userId: Parameters<typeof getLatestBriefing>[1]) {
  const db = getDb();
  const latest = getLatestBriefing(db, userId);
  return {
    briefing: latest?.briefing ?? null,
    preparedAt: latest?.preparedAt ?? null,
    lastRun: lastRunByAgent(db, userId).personal_assistant ?? null,
    agent: getAgent("personal_assistant"),
  };
}

/** The personal assistant's latest briefing for the session user (null until it has run once). */
export const GET = handler(async () => {
  return NextResponse.json(body(await getSessionUserId()));
});

/**
 * Asks the personal assistant to prepare a fresh briefing now, for the session
 * user only, and returns it. The assistant reads and writes insights; it has
 * no path that moves money, proposes, approves or changes settings.
 */
export const POST = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const now = new Date();
  enqueueJob(db, {
    userId,
    type: "assistant_briefing",
    dedupeKey: `assistant_briefing:${userId}:manual:${now.toISOString()}`,
    payload: { trigger: "manual" },
    runAfter: now.toISOString(),
  });
  const report = runPendingJobs(db, { now, userId, limit: RUN_LIMIT });
  return NextResponse.json({ ...body(userId), report });
});
