import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { handler, readJson } from "@/lib/http";
import {
  listConnections,
  linkInstitutionWithSummary,
  LinkInstitutionSchema,
} from "@/lib/providers";
export const GET = handler(async () =>
  NextResponse.json({
    connections: listConnections(getDb(), await getSessionUserId()),
  }),
);
export const POST = handler(async (req: Request) => {
  const input = LinkInstitutionSchema.parse(await readJson(req));
  return NextResponse.json(
    linkInstitutionWithSummary(
      getDb(),
      await getSessionUserId(),
      input.institutionId,
    ),
    { status: 201 },
  );
});
