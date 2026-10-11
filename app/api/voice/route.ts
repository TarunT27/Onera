import { NextResponse } from "next/server";
import { handler } from "@/lib/http";
import { voiceStatus } from "@/lib/voice";

/** Whether voice is configured. Never returns the key. */
export const GET = handler(async () => NextResponse.json(voiceStatus()));
