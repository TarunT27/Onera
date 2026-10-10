import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listAccounts, netWorthCents } from "@/lib/finance/accounts";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () => {
  const accounts = listAccounts(getDb(), await getSessionUserId());
  return NextResponse.json({ accounts, netWorthCents: netWorthCents(accounts), asOf: new Date().toISOString() });
});
