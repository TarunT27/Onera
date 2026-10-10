import { NextResponse } from "next/server";
import { listResearchDocuments } from "@/lib/ai/research";
import { handler } from "@/lib/http";

export const GET = handler(async () => NextResponse.json({ documents: listResearchDocuments() }));
