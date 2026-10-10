import { NextResponse } from "next/server";
import { createTransfer, listActions } from "@/lib/actions/service";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () =>
  NextResponse.json({ actions: listActions(getDb(), await getSessionUserId()) }),
);

/** Creates a transfer proposal and evaluates it immediately (HELD or AWAITING_APPROVAL). */
export const POST = handler(async (req: Request) => {
  const action = createTransfer(getDb(), await getSessionUserId(), await readJson(req), "user");
  return NextResponse.json({ action }, { status: 201 });
});
