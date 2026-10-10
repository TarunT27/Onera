import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { badRequest } from "@/lib/errors";
import { handler, readJson } from "@/lib/http";
import { getSessionUserId, isUserId, SESSION_COOKIE } from "@/lib/session";
import type { UserId } from "@/lib/types";

function sessionBody(userId: UserId) {
  const users = getDb().prepare("SELECT id, name FROM users ORDER BY id").all() as { id: UserId; name: string }[];
  return { user: users.find((u) => u.id === userId) ?? { id: userId, name: userId }, users };
}

export const GET = handler(async () => NextResponse.json(sessionBody(await getSessionUserId())));

/** Demo user switch — a local demo mechanism, not authentication. */
export const POST = handler(async (req: Request) => {
  const { userId } = (await readJson(req)) as { userId?: unknown };
  if (!isUserId(userId)) throw badRequest("userId must be one of the demo users");
  const res = NextResponse.json(sessionBody(userId));
  res.cookies.set(SESSION_COOKIE, userId, { httpOnly: true, sameSite: "lax", path: "/" });
  return res;
});
