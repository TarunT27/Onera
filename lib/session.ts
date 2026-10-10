/**
 * Demo identity. The current user comes from a cookie that the header switcher
 * sets. This is NOT authentication — it exists so the team can demo two
 * isolated users locally. Never deploy this publicly with real data.
 */
import { cookies } from "next/headers";
import { DEMO_USER_IDS, type UserId } from "@/lib/types";

export const SESSION_COOKIE = "clearfi_user";

export function isUserId(v: unknown): v is UserId {
  return typeof v === "string" && (DEMO_USER_IDS as readonly string[]).includes(v);
}

export async function getSessionUserId(): Promise<UserId> {
  const value = (await cookies()).get(SESSION_COOKIE)?.value;
  return isUserId(value) ? value : "alice";
}
