import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler, readJson } from "@/lib/http";
import { createMandate, listMandates } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () =>
  NextResponse.json({ mandates: listMandates(getDb(), await getSessionUserId()) }),
);

/**
 * Grants a background agent bounded authority to place paper BUY orders.
 * User only — there is no assistant or agent tool that creates mandates.
 */
export const POST = handler(async (req: Request) => {
  const mandate = createMandate(getDb(), await getSessionUserId(), await readJson(req));
  return NextResponse.json({ mandate }, { status: 201 });
});
