import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listTransactions } from "@/lib/finance/accounts";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const transactions = listTransactions(getDb(), await getSessionUserId(), {
    accountId: url.searchParams.get("accountId") ?? undefined,
    limit: Number(url.searchParams.get("limit")) || undefined,
  });
  return NextResponse.json({ transactions });
});
