import { NextResponse } from "next/server";
import { listAudit } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const events = listAudit(getDb(), await getSessionUserId(), {
    actionId: url.searchParams.get("actionId") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ events });
});
