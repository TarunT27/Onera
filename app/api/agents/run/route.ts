import { NextResponse } from "next/server";
import { listInsights, runPendingJobs, scheduleRecurring } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Jobs processed per click. The background worker handles anything left over. */
const RUN_LIMIT = 50;

/**
 * Demo button: schedule this user's recurring reviews and run their due jobs
 * once, synchronously. Only the session user's jobs are touched.
 */
export const POST = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const now = new Date();
  const scheduled = scheduleRecurring(db, now, { userId, trigger: "manual" });
  const report = runPendingJobs(db, { now, userId, limit: RUN_LIMIT });
  return NextResponse.json({ scheduled, report, insights: listInsights(db, userId) });
});
