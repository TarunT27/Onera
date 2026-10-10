/** Row ↔ domain mapping. Keeps snake_case SQL out of the rest of the code. */
import type {
  Account,
  ActionState,
  AuditEvent,
  ExecutionReceipt,
  HoldReason,
  PolicyResult,
  Recipient,
  RecipientDetails,
  Transaction,
  TransferAction,
  UserControls,
  UserId,
} from "@/lib/types";

export interface AccountRow {
  id: string;
  user_id: string;
  institution: string;
  name: string;
  type: Account["type"];
  currency: "USD";
  mask: string;
  balance_cents: number;
  available_cents: number;
  capabilities: string;
  updated_at: string;
}

export function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    institution: r.institution,
    name: r.name,
    type: r.type,
    currency: r.currency,
    mask: r.mask,
    balanceCents: r.balance_cents,
    availableCents: r.available_cents,
    capabilities: JSON.parse(r.capabilities),
    synthetic: true,
    updatedAt: r.updated_at,
  };
}

export interface TransactionRow {
  id: string;
  account_id: string;
  user_id: string;
  posted_at: string;
  description: string;
  merchant: string | null;
  category: string;
  amount_cents: number;
  currency: "USD";
  status: Transaction["status"];
  transfer_group_id: string | null;
  action_id: string | null;
}

export function toTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    accountId: r.account_id,
    userId: r.user_id as UserId,
    postedAt: r.posted_at,
    description: r.description,
    merchant: r.merchant,
    category: r.category,
    amountCents: r.amount_cents,
    currency: r.currency,
    status: r.status,
    transferGroupId: r.transfer_group_id,
    actionId: r.action_id,
  };
}

export interface RecipientRow {
  id: string;
  user_id: string;
  display_name: string;
  kind: Recipient["kind"];
  account_id: string | null;
  details: string;
  version: number;
  verified_version: number | null;
  previous_details: string | null;
  change_note: string | null;
  updated_at: string;
}

export function toRecipient(r: RecipientRow): Recipient {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    displayName: r.display_name,
    kind: r.kind,
    accountId: r.account_id,
    details: JSON.parse(r.details) as RecipientDetails,
    version: r.version,
    verifiedVersion: r.verified_version,
    previousDetails: r.previous_details ? (JSON.parse(r.previous_details) as RecipientDetails) : null,
    changeNote: r.change_note,
    updatedAt: r.updated_at,
  };
}

export interface ActionRow {
  id: string;
  user_id: string;
  type: "transfer";
  state: ActionState;
  version: number;
  source_account_id: string;
  recipient_id: string;
  recipient_version: number;
  destination: string;
  amount_cents: number;
  currency: "USD";
  memo: string;
  created_by: TransferAction["createdBy"];
  hold_reasons: string;
  policy: string | null;
  approval_hash: string | null;
  approved_version: number | null;
  approved_at: string | null;
  receipt: string | null;
  executed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Note: approval_hash is intentionally not copied to the domain object. */
export function toAction(r: ActionRow): TransferAction {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    type: r.type,
    state: r.state,
    version: r.version,
    sourceAccountId: r.source_account_id,
    recipientId: r.recipient_id,
    recipientVersion: r.recipient_version,
    destination: JSON.parse(r.destination),
    amountCents: r.amount_cents,
    currency: r.currency,
    memo: r.memo,
    createdBy: r.created_by,
    holdReasons: JSON.parse(r.hold_reasons) as HoldReason[],
    policy: r.policy ? (JSON.parse(r.policy) as PolicyResult) : null,
    approvedVersion: r.approved_version,
    approvedAt: r.approved_at,
    hasApproval: r.approval_hash !== null,
    receipt: r.receipt ? (JSON.parse(r.receipt) as ExecutionReceipt) : null,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export interface ControlsRow {
  user_id: string;
  per_transfer_limit_cents: number;
  daily_limit_cents: number;
  paused: number;
  updated_at: string;
}

export function toControls(r: ControlsRow): UserControls {
  return {
    userId: r.user_id as UserId,
    perTransferLimitCents: r.per_transfer_limit_cents,
    dailyLimitCents: r.daily_limit_cents,
    paused: r.paused === 1,
    updatedAt: r.updated_at,
  };
}

export interface AuditRow {
  id: number;
  user_id: string;
  actor: string;
  event_type: string;
  action_id: string | null;
  detail: string;
  created_at: string;
}

export function toAuditEvent(r: AuditRow): AuditEvent {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    actor: r.actor,
    eventType: r.event_type,
    actionId: r.action_id,
    detail: JSON.parse(r.detail),
    createdAt: r.created_at,
  };
}
