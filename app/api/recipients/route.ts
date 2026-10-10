import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listRecipients } from "@/lib/finance/accounts";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";
import { recipientStatus } from "@/lib/types";

export const GET = handler(async () => {
  const recipients = listRecipients(getDb(), await getSessionUserId()).map((r) => ({
    ...r,
    status: recipientStatus(r),
  }));
  return NextResponse.json({ recipients });
});
