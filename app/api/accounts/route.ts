import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listAccounts, netWorth } from "@/lib/finance/accounts";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const worth = netWorth(db, userId);
  return NextResponse.json({
    accounts: listAccounts(db, userId),
    netWorthCents: worth.totalCents,
    netWorth: worth,
    asOf: worth.asOf,
  });
});
