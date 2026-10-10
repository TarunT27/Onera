/**
 * Public surface of the background agents module (durable job queue, monitors,
 * insights, agent registry). Other modules import only from "@/lib/agents",
 * except lib/actions, which imports "@/lib/agents/queue" to avoid cycles.
 *
 * PLACEHOLDER: implementations are filled in by the agents workstream.
 */
import type { DB } from "@/lib/db";
import type { RunReport } from "./types";

export type * from "./types";
export { enqueueJob } from "./queue";

export function runPendingJobs(_db: DB, _opts: { limit?: number; now?: Date } = {}): RunReport {
  return { processed: 0, succeeded: 0, failed: 0, dead: 0 };
}
