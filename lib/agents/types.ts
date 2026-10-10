/** Public types for background monitoring agents. Owned by the agents module. */
import type { UserId } from "@/lib/types";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "dead";

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

export type InsightSeverity = "info" | "warning" | "critical";
export type InsightStatus = "new" | "seen" | "dismissed";

export interface Insight {
  id: string;
  userId: UserId;
  agentId: string;
  type: string;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** IDs of the records that support the finding. */
  evidence: { transactionIds?: string[]; actionIds?: string[]; accountIds?: string[]; symbols?: string[] } & Record<string, unknown>;
  status: InsightStatus;
  createdAt: string;
  updatedAt: string;
}

export interface RunReport {
  processed: number;
  succeeded: number;
  failed: number;
  dead: number;
}
