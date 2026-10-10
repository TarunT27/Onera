/** Row ↔ domain mapping for the markets tables. */
import type { UserId } from "@/lib/types";
import type {
  Mandate,
  MandateStatus,
  OrderCreator,
  OrderFill,
  OrderHoldReason,
  OrderPolicyResult,
  OrderSide,
  OrderState,
  PaperOrder,
  TradingControls,
} from "./types";

export interface OrderRow {
  id: string;
  user_id: string;
  state: OrderState;
  version: number;
  account_id: string;
  symbol: string;
  side: OrderSide;
  quantity_micros: number | null;
  notional_cents: number | null;
  quote_price_cents: number | null;
  price_bound_cents: number | null;
  created_by: OrderCreator;
  mandate_id: string | null;
  hold_reasons: string;
  policy: string | null;
  approval_hash: string | null;
  approved_version: number | null;
  approved_at: string | null;
  approved_by: string | null;
  fill: string | null;
  filled_gross_cents: number | null;
  executed_at: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
}

/** Note: approval_hash is intentionally not copied to the domain object. */
export function toOrder(r: OrderRow): PaperOrder {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    state: r.state,
    version: r.version,
    accountId: r.account_id,
    symbol: r.symbol,
    side: r.side,
    quantityMicros: r.quantity_micros,
    notionalCents: r.notional_cents,
    quotePriceCents: r.quote_price_cents,
    priceBoundCents: r.price_bound_cents,
    createdBy: r.created_by,
    mandateId: r.mandate_id,
    holdReasons: JSON.parse(r.hold_reasons) as OrderHoldReason[],
    policy: r.policy ? (JSON.parse(r.policy) as OrderPolicyResult) : null,
    approvedVersion: r.approved_version,
    approvedAt: r.approved_at,
    approvedBy: r.approved_by,
    hasApproval: r.approval_hash !== null,
    fill: r.fill ? (JSON.parse(r.fill) as OrderFill) : null,
    executedAt: r.executed_at,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    paper: true,
  };
}

export interface PositionRow {
  user_id: string;
  account_id: string;
  symbol: string;
  quantity_micros: number;
  cost_basis_cents: number;
  updated_at: string;
}

export interface TradingControlsRow {
  user_id: string;
  per_order_limit_cents: number;
  daily_order_limit_cents: number;
  updated_at: string;
}

export function toTradingControls(r: TradingControlsRow): TradingControls {
  return {
    userId: r.user_id as UserId,
    perOrderLimitCents: r.per_order_limit_cents,
    dailyOrderLimitCents: r.daily_order_limit_cents,
    updatedAt: r.updated_at,
  };
}

export interface MandateRow {
  id: string;
  user_id: string;
  agent_id: string;
  account_id: string;
  symbols: string;
  side: "buy";
  max_order_cents: number;
  max_daily_cents: number;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export function mandateStatus(r: Pick<MandateRow, "expires_at" | "revoked_at">, now: Date): MandateStatus {
  if (r.revoked_at !== null) return "revoked";
  return new Date(r.expires_at).getTime() <= now.getTime() ? "expired" : "active";
}

export function toMandate(r: MandateRow, usedTodayCents: number, now: Date): Mandate {
  return {
    id: r.id,
    userId: r.user_id as UserId,
    agentId: r.agent_id,
    accountId: r.account_id,
    symbols: JSON.parse(r.symbols) as string[],
    side: r.side,
    maxOrderCents: r.max_order_cents,
    maxDailyCents: r.max_daily_cents,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    createdAt: r.created_at,
    status: mandateStatus(r, now),
    usedTodayCents,
    remainingTodayCents: Math.max(0, r.max_daily_cents - usedTodayCents),
    paper: true,
  };
}
