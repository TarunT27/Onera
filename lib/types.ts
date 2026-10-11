/**
 * Shared Onera contract. UI, API routes, policy, simulator and AI tools all
 * use these types — change them deliberately and tell the team.
 *
 * Money is always integer cents plus an explicit currency. Never use floats
 * for amounts.
 */
import { z } from "zod";

export const DEMO_USER_IDS = ["alice", "bob"] as const;
export type UserId = (typeof DEMO_USER_IDS)[number];

/** Home currency. Transfers, limits and totals are USD-only in this demo. */
export const CURRENCY = "USD" as const;
export type Currency = typeof CURRENCY;

/** Currencies an account or transaction may be held in (international accounts are view-only). */
export type CurrencyCode = "USD" | "EUR" | "GBP" | "CAD";

// ---------------------------------------------------------------------------
// Accounts, transactions, recipients
// ---------------------------------------------------------------------------

export type AccountType = "checking" | "savings" | "brokerage" | "credit";
/** What this app may do with an account. Visibility never implies transfer or trading support. */
export type AccountCapability = "view" | "transfer_source" | "transfer_destination" | "trade";

export interface Account {
  id: string;
  userId: UserId;
  institution: string;
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  mask: string;
  /** In the account's currency. Credit accounts are negative (amount owed). Brokerage = cash only. */
  balanceCents: number;
  availableCents: number;
  capabilities: AccountCapability[];
  /** Provider connection (lib/providers), or null for built-in demo accounts. */
  connectionId: string | null;
  /** Paper-trading money: shown separately, never counted in net worth. */
  paper: boolean;
  synthetic: true;
  updatedAt: string;
}

export type TransactionStatus = "posted" | "pending";

export interface Transaction {
  id: string;
  accountId: string;
  userId: UserId;
  postedAt: string; // ISO date-time
  description: string;
  merchant: string | null;
  category: string;
  /** Negative = money out of the account, positive = money in. In the account's currency. */
  amountCents: number;
  currency: CurrencyCode;
  status: TransactionStatus;
  /** Shared by both legs of a move between the user's own accounts. Excluded from spending. */
  transferGroupId: string | null;
  /** Set when the transaction was created by the simulator for an action. */
  actionId: string | null;
  /** Provider's transaction ID for synced transactions (unique per account). */
  providerTxId: string | null;
}

export type RecipientKind = "own_account" | "external";

export interface RecipientDetails {
  institution: string;
  accountMask: string;
  routingMask: string | null;
}

export interface Recipient {
  id: string;
  userId: UserId;
  displayName: string;
  kind: RecipientKind;
  /** Destination account when kind = own_account. */
  accountId: string | null;
  details: RecipientDetails;
  /** Increments every time destination details change. */
  version: number;
  /** Version that was verified out-of-band, or null if never verified. */
  verifiedVersion: number | null;
  /** Details at the last verified version, kept to show what changed. */
  previousDetails: RecipientDetails | null;
  changeNote: string | null;
  updatedAt: string;
}

export type RecipientStatus = "verified" | "changed" | "unverified";

export function recipientStatus(r: Pick<Recipient, "version" | "verifiedVersion">): RecipientStatus {
  if (r.verifiedVersion === r.version) return "verified";
  return r.verifiedVersion === null ? "unverified" : "changed";
}

// ---------------------------------------------------------------------------
// Actions (transfer proposals) and governance
// ---------------------------------------------------------------------------

/**
 * PROPOSED → HELD | AWAITING_APPROVAL → APPROVED → EXECUTED
 * FAILED covers a failed simulation. Material edits return to PROPOSED.
 */
export const ACTION_STATES = [
  "PROPOSED",
  "HELD",
  "AWAITING_APPROVAL",
  "APPROVED",
  "EXECUTED",
  "FAILED",
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

/** Machine-readable reasons a proposal is held. */
export const HOLD_REASONS = [
  "RECIPIENT_CHANGED",
  "RECIPIENT_UNVERIFIED",
  "LIMIT_EXCEEDED",
  "DAILY_LIMIT_EXCEEDED",
  "INSUFFICIENT_FUNDS",
  "PAUSED",
] as const;
export type HoldReason = (typeof HOLD_REASONS)[number];

export type ActionCreator = "user" | "assistant";

export interface PolicyCheck {
  id: string;
  label: string;
  passed: boolean;
  reason?: HoldReason;
  detail: string;
}

export interface PolicyResult {
  decision: "ALLOW" | "HOLD";
  reasons: HoldReason[];
  checks: PolicyCheck[];
  evaluatedAt: string;
}

export interface ExecutionReceipt {
  receiptId: string;
  actionId: string;
  executedAt: string;
  amountCents: number;
  currency: Currency;
  sourceAccountId: string;
  sourceBalanceAfterCents: number;
  destination: string;
  destinationAccountId: string | null;
  destinationBalanceAfterCents: number | null;
  simulated: true;
}

export interface TransferAction {
  id: string;
  userId: UserId;
  type: "transfer";
  state: ActionState;
  /** Increments on every material edit. Approvals bind to one version. */
  version: number;
  sourceAccountId: string;
  recipientId: string;
  /** Recipient version captured when the proposal (version) was created. */
  recipientVersion: number;
  /** Destination details captured with recipientVersion. */
  destination: RecipientDetails & { displayName: string };
  amountCents: number;
  currency: Currency;
  memo: string;
  createdBy: ActionCreator;
  holdReasons: HoldReason[];
  policy: PolicyResult | null;
  approvedVersion: number | null;
  approvedAt: string | null;
  /** True when a stored approval exists. The hash itself never leaves the server. */
  hasApproval: boolean;
  receipt: ExecutionReceipt | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserControls {
  userId: UserId;
  perTransferLimitCents: number;
  dailyLimitCents: number;
  /** Stops new executions, including already-approved proposals. */
  paused: boolean;
  updatedAt: string;
}

export interface AuditEvent {
  id: number;
  userId: UserId;
  actor: string; // "user:alice" | "assistant" | "system"
  eventType: string;
  actionId: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface FxRate {
  currency: CurrencyCode;
  /** USD per 1 unit of currency × 1,000,000. */
  rateMicros: number;
  asOf: string;
  source: string;
}

export interface NetWorth {
  /** USD. Excludes paper-trading accounts. Includes brokerage positions at simulated prices. */
  totalCents: number;
  cashAndDebtCents: number;
  investmentsCents: number;
  fxRates: FxRate[];
  asOf: string;
}

// ---------------------------------------------------------------------------
// Insights
// ---------------------------------------------------------------------------

export interface SubscriptionIncrease {
  kind: "subscription_price_increase";
  merchant: string;
  accountId: string;
  previousAmountCents: number;
  currentAmountCents: number;
  increaseCents: number;
  increasePct: number;
  cadence: "monthly";
  /** Transaction IDs that prove the pattern and the increase. */
  evidenceTransactionIds: string[];
  latestChargeAt: string;
}

export interface SpendingCategory {
  category: string;
  totalCents: number;
}

export interface SpendingSummary {
  month: string; // YYYY-MM
  /** USD; foreign-currency spending is converted with the dated demo FX rate. */
  totalCents: number;
  previousMonth: string;
  previousTotalCents: number;
  byCategory: SpendingCategory[];
  /** Internal transfers between owned accounts, excluded from totalCents. */
  excludedInternalTransferCents: number;
  transactionCount: number;
}

// ---------------------------------------------------------------------------
// Request schemas (validated on the server)
// ---------------------------------------------------------------------------

const cents = z.number().int().positive().max(100_000_000);

export const CreateTransferSchema = z.object({
  sourceAccountId: z.string().min(1),
  recipientId: z.string().min(1),
  amountCents: cents,
  currency: z.literal(CURRENCY).default(CURRENCY),
  memo: z.string().max(140).default(""),
});
export type CreateTransferInput = z.infer<typeof CreateTransferSchema>;

/** Material edit. Any change returns the action to PROPOSED and drops approval. */
export const EditTransferSchema = z
  .object({
    sourceAccountId: z.string().min(1).optional(),
    recipientId: z.string().min(1).optional(),
    amountCents: cents.optional(),
    memo: z.string().max(140).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");
export type EditTransferInput = z.infer<typeof EditTransferSchema>;

/** The client approves the exact version it reviewed; the server computes the hash. */
export const ApproveSchema = z.object({ version: z.number().int().positive() });

export const UpdateControlsSchema = z
  .object({
    perTransferLimitCents: z.number().int().min(0).max(100_000_000).optional(),
    dailyLimitCents: z.number().int().min(0).max(100_000_000).optional(),
    paused: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");
export type UpdateControlsInput = z.infer<typeof UpdateControlsSchema>;

/**
 * Assistant personas. Each one is the same model with a narrower tool set,
 * enforced in lib/ai/agents.ts (the tool list sent to the model AND runTool).
 */
export const ASSISTANT_AGENTS = ["general", "research", "chart", "risk", "drafter"] as const;
export type AssistantAgentId = (typeof ASSISTANT_AGENTS)[number];

export const ChatRequestSchema = z.object({
  /** Defaults to "general". */
  agent: z.enum(ASSISTANT_AGENTS).optional(),
  /**
   * Client-generated grouping key for security monitoring. Scoped to the session user on the server; it is a label,
   * never an identity. The server makes one when it is missing and returns it.
   */
  conversationId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .min(1)
    .max(30)
    .refine((m) => m[0].role === "user" && m[m.length - 1].role === "user", {
      message: "Conversation must start and end with a user message",
    }),
});
export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// ---------------------------------------------------------------------------
// Chat response
// ---------------------------------------------------------------------------

export interface ToolTraceEntry {
  tool: string;
  input: Record<string, unknown>;
  ok: boolean;
  /** Short sanitized summary of what the tool returned. */
  summary: string;
}

export interface ChatResponse {
  /** live = real model call; fallback = deterministic summary, clearly labeled. */
  mode: "live" | "fallback";
  model: string | null;
  reply: string;
  trace: ToolTraceEntry[];
  /** Proposals created during this turn. Approval still happens in the UI. */
  proposedActionIds: string[];
  /** Paper-order proposals created during this turn (Trade drafter only). Approval still happens in the UI. */
  proposedOrderIds: string[];
  /** The agent that answered. */
  agent: AssistantAgentId;
  notice?: string;
  /** Echo of (or the server-made) conversation ID; send it back on the next turn. */
  conversationId?: string;
  /** What the inline gates did this turn. */
  guard?: ChatGuardInfo;
}

export interface ChatGuardInfo {
  /** The draft reply failed an inline check and was replaced with a status built from Onera's records. */
  withheld: boolean;
  /** Server reason codes, e.g. SENSITIVE_DATA, UNSUPPORTED_EXECUTION_CLAIM, AMBIGUOUS_CLAIM. */
  reasons: string[];
  /** Tool calls the dispatcher refused this turn (forbidden, malformed, over budget). */
  blockedToolCalls: number;
  /** Untrusted content with embedded instructions was read this turn. */
  untrustedInstructions: boolean;
}

// ---------------------------------------------------------------------------
// API error envelope
// ---------------------------------------------------------------------------

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "STALE_VERSION"
  | "APPROVAL_INVALID"
  | "POLICY_HOLD"
  | "UNSUPPORTED"
  | "RATE_LIMITED"
  | "INTERNAL";

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown };
}
