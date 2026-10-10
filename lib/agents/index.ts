/**
 * Public surface of the background agents module (durable job queue, monitors,
 * insights, agent registry). Other modules import only from "@/lib/agents",
 * except lib/actions — and any module that @/lib/agents itself depends on, such
 * as lib/providers — which import "@/lib/agents/queue" to avoid import cycles.
 */
export type * from "./types";
export { JOB_TYPES, isJobType } from "./types";
export { enqueueJob, getJob, listJobs } from "./queue";
export { runPendingJobs } from "./runner";
export { scheduleRecurring } from "./scheduler";
export {
  DEFAULT_WORKER_INTERVAL_MS,
  formatTickSummary,
  interruptibleSleep,
  runWorkerLoop,
  runWorkerTick,
  type WorkerLoopOptions,
  type WorkerLoopResult,
  type WorkerTickOptions,
  type WorkerTickReport,
} from "./worker";
export {
  AGENT_REGISTRY,
  agentForJobType,
  getAgent,
  permissionMatrix,
  permissionMatrixMarkdown,
  type PermissionRow,
} from "./registry";
export { getInsight, listInsights, parseInsightStatus, setInsightStatus } from "./insights";
export { lastRunByAgent, listRuns } from "./runs";
export { ScopeViolationError, PermanentJobError } from "./errors";
