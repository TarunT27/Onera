import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listFamilyCards } from "@/lib/family";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

/** GET /api/family — the signed-in parent's kids' cards with this month's spend. */
export const GET = handler(async () => NextResponse.json(listFamilyCards(getDb(), await getSessionUserId())));
