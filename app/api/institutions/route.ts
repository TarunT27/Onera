import { NextResponse } from "next/server";
import { listInstitutions } from "@/lib/providers";
import { handler } from "@/lib/http";
export const GET = handler(async () =>
  NextResponse.json({ institutions: listInstitutions() }),
);
