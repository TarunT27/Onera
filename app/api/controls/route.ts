import { NextResponse } from "next/server";
import { executedTodayCents, getControls, updateControls } from "@/lib/controls";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  return NextResponse.json({
    controls: getControls(db, userId),
    usage: { executedTodayCents: executedTodayCents(db, userId) },
  });
});

export const PATCH = handler(async (req: Request) => {
  const controls = updateControls(getDb(), await getSessionUserId(), await readJson(req));
  return NextResponse.json({ controls });
});
