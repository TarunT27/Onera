/** Public types for background monitoring agents. Owned by the agents module. */
import type { UserId } from "@/lib/types";

// ---------------------------------------------------------------------------
// Jobs (durable queue)
// ---------------------------------------------------------------------------

/** Job types are a shared contract: other modules enqueue these by name. */
export const JOB_TYPES = [
  "sync_connection",
  "spending_review",
  "subscription_review",
  "security_review",
  "portfolio_review",
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export function isJobType(v: unknown): v is JobType {
  return typeof v === "string" && (JOB_TYPES as readonly string[]).includes(v);
}

/**
 * queued    → waiting for its first attempt
 * running   → claimed by a worker; `lockedUntil` is the lease
 * succeeded → done
 * failed    → last attempt failed; retried after `runAfter` (exponential backoff)
 * dead      → out of attempts or a permanent error; kept for inspection (dead letter)
 */
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";
export const JOB_STATUSES: readonly JobStatus[] = ["queued", "running", "succeeded", "failed", "dead"];

export interface JobInput {
  userId: UserId;
  /** Registered job type, e.g. "security_review", "sync_connection". */
  type: string;
  /** Jobs with the same dedupe key are enqueued once. */
  dedupeKey: string;
  payload?: Record<string, unknown>;
  runAfter?: string;
  maxAttempts?: number;
}

export interface EnqueueResult {
  jobId: string | null;
  deduplicated: boolean;
}

export interface Job {
  id: string;
  userId: UserId;
  type: string;
  dedupeKey: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  lockedUntil: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobOutcome {
  jobId: string;
  userId: UserId;
  type: string;
  agentId: string | null;
  status: JobStatus;
  summary: string;
}

export interface RunReport {
  processed: number;
  succeeded: number;
  /** Failed attempts that will be retried after backoff. */
  failed: number;
  /** Jobs moved to the dead-letter state in this run. */
  dead: number;
  /** Expired leases returned to the queue before processing. */
  requeued?: number;
  jobs?: JobOutcome[];
}

export interface ScheduleReport {
  enqueued: number;
  deduplicated: number;
  jobIds: string[];
}

// ---------------------------------------------------------------------------
// Agent registry (permission matrix as code)
// ---------------------------------------------------------------------------

/** Private data an agent may read. Every read is scoped to the job's user. */
export type DataScope = "accounts" | "transactions" | "recipients" | "actions" | "portfolio" | "connections";
export const DATA_SCOPES: readonly DataScope[] = [
  "accounts", "transactions", "recipients", "actions", "portfolio", "connections",
];

/**
 * What an agent may write.
 *  - insights:        persisted findings for its own user
 *  - jobs:            enqueue follow-up monitoring jobs for its own user
 *  - connection_sync: ask the providers module to refresh a connection (idempotent data import)
 */
export type WriteScope = "insights" | "jobs" | "connection_sync";
export const WRITE_SCOPES: readonly WriteScope[] = ["insights", "jobs", "connection_sync"];

export type AgentId =
  | "spending_monitor"
  | "subscription_monitor"
  | "security_sentinel"
  | "portfolio_monitor"
  | "connection_monitor";

export interface AgentDefinition {
  id: AgentId;
  name: string;
  purpose: string;
  /** When it runs. */
  trigger: string;
  jobTypes: JobType[];
  reads: DataScope[];
  writes: WriteScope[];
  /** Follow-up job types it may enqueue (for its own user). Non-empty only with the "jobs" write scope. */
  enqueues: JobType[];
  /** Literal `false`: the type system rejects any agent with these powers. */
  canApprove: false;
  canExecute: false;
  canCreateMandates: false;
  canVerifyRecipients: false;
  canChangeControls: false;
  /** Monitoring is deterministic: no model calls. */
  usesModel: false;
}

export interface AgentRun {
  id: string;
  userId: UserId;
  agentId: string;
  jobId: string | null;
  trigger: string;
  status: "running" | "succeeded" | "failed";
  startedAt: string;
  finishedAt: string | null;
  summary: string | null;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightStatus = "new" | "seen" | "dismissed";
export const INSIGHT_STATUSES: readonly InsightStatus[] = ["new", "seen", "dismissed"];

export type InsightEvidence = {
  transactionIds?: string[];
  actionIds?: string[];
  accountIds?: string[];
  symbols?: string[];
  connectionIds?: string[];
} & Record<string, unknown>;

export interface Insight {
  id: string;
  userId: UserId;
  agentId: string;
  type: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** IDs of the records that support the finding. */
  evidence: InsightEvidence;
  status: InsightStatus;
  /** Produced by deterministic rules over synthetic data; no model involved. */
  deterministic: true;
  createdAt: string;
  updatedAt: string;
}

/** What a monitor hands to its insight writer. User and agent come from the context. */
export interface InsightDraft {
  type: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  evidence: InsightEvidence;
  /** Stable identity of the finding; repeated runs update the same insight. */
  dedupeKey: string;
}

export type UpsertOutcome = "created" | "updated" | "unchanged";
