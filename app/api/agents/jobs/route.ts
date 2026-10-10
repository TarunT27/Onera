import { NextResponse } from "next/server";
import { listJobs, type JobStatus } from "@/lib/agents";
import { JOB_STATUSES } from "@/lib/agents/types";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** Debug view of this user's queue (including dead-lettered jobs). */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") || undefined;
  if (status && !(JOB_STATUSES as readonly string[]).includes(status)) {
    throw badRequest(`status must be one of ${JOB_STATUSES.join(", ")}`);
  }
  const jobs = listJobs(getDb(), await getSessionUserId(), {
    status: status as JobStatus | undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ jobs });
});
