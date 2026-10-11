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
  "threat_sweep",
  "assistant_briefing",
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
/** "audit" is the user's own append-only audit log (lib/audit), read-only. */
export type DataScope = "accounts" | "transactions" | "recipients" | "actions" | "portfolio" | "connections" | "audit";
export const DATA_SCOPES: readonly DataScope[] = [
  "accounts", "transactions", "recipients", "actions", "portfolio", "connections", "audit",
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
  | "connection_monitor"
  | "threat_monitor"
  | "personal_assistant";

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
  /** audit_events.id values (the user's own audit log). */
  auditEventIds?: number[];
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

// ---------------------------------------------------------------------------
// Personal assistant briefing (the latest snapshot the PA prepared)
// ---------------------------------------------------------------------------

export type BriefingTipKind = "save" | "spending" | "invest";

export interface BriefingTip {
  /** Stable identity, e.g. "habit:bean there". */
  id: string;
  kind: BriefingTipKind;
  severity: InsightSeverity;
  title: string;
  body: string;
  /** Estimated yearly saving if acted on, integer USD cents; null when there is no honest estimate. */
  annualSavingsCents: number | null;
  /** One-time amount at stake (e.g. a possible duplicate charge), integer USD cents. */
  oneTimeCents: number | null;
  evidence: InsightEvidence;
  /** The persisted insight for this tip, when it is one worth an inbox alert. */
  insightId: string | null;
}

export interface BriefingResearchNote {
  symbol: string;
  name: string;
  sector: string | null;
  instrumentType: "stock" | "etf" | null;
  accountIds: string[];
  /** True when only held in paper (practice) accounts. */
  paper: boolean;
  marketValueCents: number;
  unrealizedPnlCents: number;
  /** Share of invested (non-paper) holdings, 0–100, or null for paper-only positions. */
  weightPct: number | null;
  change30dPct: number | null;
  change90dPct: number | null;
  /** Annualized volatility of simulated daily returns over the window, in percent. */
  volatilityPct: number | null;
  /** Deepest peak-to-trough fall in the window, in percent (≤ 0). */
  maxDrawdownPct: number | null;
  notable: boolean;
  note: string;
}

export interface BriefingMarketMover {
  symbol: string;
  name: string;
  priceCents: number;
  changePct: number;
}

export interface BriefingAttentionItem {
  id: string;
  kind: "approval" | "held" | "approved" | "connection";
  title: string;
  detail: string;
  /** In-app link to where the user can act. The PA itself can't act. */
  href: string;
  evidence: InsightEvidence;
}

export interface BriefingSnapshot {
  /** Days of history the averages are based on (up to 90). */
  windowDays: number;
  monthlyIncomeCents: number;
  monthlySpendingCents: number;
  /** (income − spending) / income, or null with no income. */
  savingsRatePct: number | null;
  /** Checking + savings, USD, excluding paper accounts. */
  cashCents: number;
  savingsCents: number;
  /** Savings balance ÷ average monthly spending. */
  emergencyFundMonths: number | null;
  investedCents: number;
  /** Last 30 days, largest first. */
  topCategories: { category: string; cents: number; pct: number }[];
}

export interface Briefing {
  agentId: "personal_assistant";
  generatedAt: string;
  headline: string;
  snapshot: BriefingSnapshot;
  potentialAnnualSavingsCents: number;
  tips: BriefingTip[];
  research: BriefingResearchNote[];
  movers: BriefingMarketMover[];
  attention: BriefingAttentionItem[];
  disclaimer: string;
  /** Deterministic rules over synthetic data and simulated prices; no model involved. */
  deterministic: true;
}
