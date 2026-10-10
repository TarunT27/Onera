import { NextResponse } from "next/server";
import { AGENT_REGISTRY, lastRunByAgent, permissionMatrix } from "@/lib/agents";
import { getDb } from "@/lib/db";
import { handler } from "@/lib/http";
import { getSessionUserId } from "@/lib/session";

export const AGENTS_NOTICE =
  "Monitoring agents run deterministic rules over synthetic data; no model is called. Each can read only its " +
  "listed scopes and write insights. None can approve, execute, create mandates, verify recipients or change controls.";

/** Agent registry (the permission matrix) plus this user's last run of each agent. */
export const GET = handler(async () => {
  const db = getDb();
  const userId = await getSessionUserId();
  const lastRuns = lastRunByAgent(db, userId);
  return NextResponse.json({
    agents: AGENT_REGISTRY.map((a) => ({ ...a, lastRun: lastRuns[a.id] ?? null })),
    permissions: permissionMatrix(),
    notice: AGENTS_NOTICE,
  });
});
