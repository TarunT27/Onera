/**
 * The personal assistant's latest briefing. Each assistant_briefing run stores
 * its briefing as job data; the newest successful run is the current snapshot,
 * so finished to-dos and old numbers never linger. Always scoped to the user.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import type { Briefing } from "./types";

export interface LatestBriefing {
  briefing: Briefing;
  jobId: string;
  /** When the run that produced it finished. */
  preparedAt: string;
}

export function getLatestBriefing(db: DB, userId: UserId): LatestBriefing | null {
  const row = db
    .prepare(
      `SELECT id, result, updated_at FROM jobs
       WHERE user_id = ? AND type = 'assistant_briefing' AND status = 'succeeded' AND result IS NOT NULL
       ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
    )
    .get(userId) as { id: string; result: string; updated_at: string } | undefined;
  if (!row) return null;
  const result = JSON.parse(row.result) as { briefing?: Briefing };
  if (!result.briefing) return null;
  return { briefing: result.briefing, jobId: row.id, preparedAt: row.updated_at };
}
