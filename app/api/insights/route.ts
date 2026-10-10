import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getTransactionsByIds } from "@/lib/finance/accounts";
import { spendingSummary } from "@/lib/finance/spending";
import { detectSubscriptionIncreases } from "@/lib/finance/subscriptions";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const subscriptions = detectSubscriptionIncreases(db, userId);
  const evidenceIds = subscriptions.flatMap((s) => s.evidenceTransactionIds);
  const evidence = Object.fromEntries(getTransactionsByIds(db, userId, evidenceIds).map((t) => [t.id, t]));
  return NextResponse.json({ spending: spendingSummary(db, userId), subscriptions, evidence });
});
