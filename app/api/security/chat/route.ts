import { NextResponse } from "next/server";
import { getMonitorStatus, listFindings, listUserEvents } from "@/lib/chatguard";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/**
 * Assistant security monitor for the session user: monitor health (heartbeat,
 * pending and failed events), this user's findings and recent security events.
 * Only the user's own findings and events are ever returned.
 */
export const GET = handler(async (req: Request) => {
  const db = getDb();
  const userId = await getSessionUserId();
  const url = new URL(req.url);
  const limit = Number(url.searchParams.get("limit")) || undefined;
  return NextResponse.json({
    status: getMonitorStatus(db, userId),
    findings: listFindings(db, userId, { limit }),
    events: listUserEvents(db, userId, 40),
  });
});
