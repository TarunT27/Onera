import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getSessionUserId } from "@/lib/session";
import { handler } from "@/lib/http";
import { syncConnectionAs } from "@/lib/providers";
export const POST = handler(
  async (_req: Request, ctx: { params: Promise<{ id: string }> }) => {
    const userId = await getSessionUserId();
    return NextResponse.json({
      sync: syncConnectionAs(
        getDb(),
        userId,
        (await ctx.params).id,
        `user:${userId}`,
      ),
    });
  },
);
