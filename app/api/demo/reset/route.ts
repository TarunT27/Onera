import { NextResponse } from "next/server";
import { getDb, resetDemoData } from "@/lib/db";
import { handler } from "@/lib/http";

/** Wipes and reseeds the synthetic database. */
export const POST = handler(async () => {
  resetDemoData(getDb());
  return NextResponse.json({ ok: true });
});
