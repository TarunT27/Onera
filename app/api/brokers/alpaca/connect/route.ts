import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { connectAlpaca } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/**
 * Links the Alpaca account whose keys are configured on the server to the signed-in user and
 * mirrors its cash and positions. User only. Keys never come from the request.
 */
export const POST = handler(async () => {
  const connection = await connectAlpaca(getDb(), await getSessionUserId());
  return NextResponse.json({ connection });
});
