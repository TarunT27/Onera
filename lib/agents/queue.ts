/**
 * Durable job queue — leaf module. Core code (lib/actions) imports enqueueJob
 * from here, so this file must not import lib/actions, lib/providers,
 * lib/markets or agent handlers (that would create import cycles).
 *
 * PLACEHOLDER: no-op until the agents workstream implements the queue.
 */
import type { DB } from "@/lib/db";
import type { EnqueueResult, JobInput } from "./types";

export function enqueueJob(_db: DB, _job: JobInput): EnqueueResult {
  return { jobId: null, deduplicated: false };
}
