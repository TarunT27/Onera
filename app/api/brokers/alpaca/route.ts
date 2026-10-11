import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getBrokerConnection } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** The signed-in user's Alpaca connection status. Never includes keys. */
export const GET = handler(async () =>
  NextResponse.json({ connection: getBrokerConnection(getDb(), await getSessionUserId()) }),
);
