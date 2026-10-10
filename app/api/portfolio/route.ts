import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getPortfolio } from "@/lib/markets";
import { getSessionUserId } from "@/lib/session";

/** Brokerage accounts (imported view-only + paper) valued at simulated prices. */
export const GET = handler(async () =>
  NextResponse.json({ portfolio: getPortfolio(getDb(), await getSessionUserId()) }),
);
