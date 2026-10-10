import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { handler, readJson } from "@/lib/http";
import {
  simulateConnectionIssue,
  SimulateScenarioSchema,
} from "@/lib/providers";
export const POST = handler(
  async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const { scenario } = SimulateScenarioSchema.parse(await readJson(req));
    return NextResponse.json({
      connection: simulateConnectionIssue(
        getDb(),
        await getSessionUserId(),
        (await ctx.params).id,
        scenario,
      ),
    });
  },
);
