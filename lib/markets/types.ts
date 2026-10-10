/** Public types for market data, portfolios and paper trading. Owned by the markets module. */
import type { UserId } from "@/lib/types";

/** Shown wherever prices appear. */
export const SIMULATED_PRICES_DISCLAIMER = "Simulated prices — not real market data";
/** The simulated market never closes. */
export const SIMULATED_MARKET_STATUS = "Simulated market — always open";

export type InstrumentType = "stock" | "etf";

export interface Instrument {
  symbol: string;
  name: string;
  type: InstrumentType;
  sector: string | null;
}

export interface Quote {
  symbol: string;
  priceCents: number;
  previousCloseCents: number;
  changePct: number;
  asOf: string;
  source: "simulated";
  delayedMinutes: number;
}

export interface PricePoint {
  /** UTC calendar day, YYYY-MM-DD. The last point is the current simulated price. */
  date: string;
  closeCents: number;
}

export interface PriceHistory {
  symbol: string;
  points: PricePoint[];
  source: "simulated";
  disclaimer: string;
}

export interface Position {
  accountId: string;
  symbol: string;
  /** Shares × 1,000,000 (fractional shares as integers). */
  quantityMicros: number;
  costBasisCents: number;
  /** Cost basis per whole share, rounded to the cent. */
  averageCostCents: number;
  priceCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
  /** Share of this account's positions value, 0–100. */
  weightPct: number;
}

export interface PortfolioAccount {
  accountId: string;
  name: string;
  institution: string;
  mask: string;
  /** True only for paper accounts with the "trade" capability. */
  tradable: boolean;
  paper: boolean;
  /** "Paper trading (simulated)" or "Imported holdings (view-only)". */
  label: string;
  cashCents: number;
  positionsValueCents: number;
  totalCents: number;
  positions: Position[];
}

export interface Portfolio {
  userId: UserId;
  accounts: PortfolioAccount[];
  /** Positions value across non-paper accounts (counted in net worth). */
  investedValueCents: number;
  /** Cash + positions in paper accounts. Shown separately, never counted in net worth. */
  paperValueCents: number;
  asOf: string;
  quotesSource: "simulated";
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Paper orders
// ---------------------------------------------------------------------------

/** Same lifecycle as transfer actions. */
export type OrderState = "PROPOSED" | "HELD" | "AWAITING_APPROVAL" | "APPROVED" | "EXECUTED" | "FAILED";
export type OrderSide = "buy" | "sell";
/** "agent:<agentId>" for background agents. */
export type OrderCreator = "user" | "assistant" | `agent:${string}`;

/** Machine-readable reasons an order is held. */
export const ORDER_HOLD_REASONS = [
  "NOT_TRADABLE",
  "INSTRUMENT_NOT_ALLOWED",
  "QUOTE_UNAVAILABLE",
  "PRICE_OUT_OF_BOUND",
  "ORDER_LIMIT_EXCEEDED",
  "DAILY_ORDER_LIMIT_EXCEEDED",
  "INSUFFICIENT_CASH",
  "INSUFFICIENT_SHARES",
  "PAUSED",
  "MANDATE_INVALID",
] as const;
export type OrderHoldReason = (typeof ORDER_HOLD_REASONS)[number];

export interface OrderPolicyCheck {
  id: string;
  label: string;
  passed: boolean;
  reason?: OrderHoldReason;
  detail: string;
}

export interface OrderPolicyResult {
  decision: "ALLOW" | "HOLD";
  reasons: OrderHoldReason[];
  checks: OrderPolicyCheck[];
  /** Simulated price the checks used, or null when no quote was available. */
  quotePriceCents: number | null;
  /** Value counted against limits: notional, or quantity × price bound (buy) / quote (sell). */
  estimatedValueCents: number;
  evaluatedAt: string;
}

export interface OrderFill {
  fillId: string;
  orderId: string;
  orderVersion: number;
  executedAt: string;
  accountId: string;
  symbol: string;
  side: OrderSide;
  quantityMicros: number;
  priceCents: number;
  /** Cash debited (buy) or credited (sell). */
  grossCents: number;
  priceBoundCents: number;
  cashAfterCents: number;
  positionQuantityAfterMicros: number;
  /** Sells only: proceeds minus the average cost of the shares sold. */
  realizedPnlCents: number | null;
  approvedBy: string;
  executedBy: string;
  quoteSource: "simulated";
  paper: true;
  simulated: true;
}

export interface PaperOrder {
  id: string;
  userId: UserId;
  state: OrderState;
  /** Increments on every material change, including a new price bound. Approvals bind to one version. */
  version: number;
  accountId: string;
  symbol: string;
  side: OrderSide;
  /** Exactly one of quantityMicros / notionalCents is set. Sells are always by quantity. */
  quantityMicros: number | null;
  notionalCents: number | null;
  /** Simulated quote captured when this version was evaluated. */
  quotePriceCents: number | null;
  /** Buy: maximum fill price (quote × 1.01). Sell: minimum fill price (quote × 0.99). */
  priceBoundCents: number | null;
  createdBy: OrderCreator;
  mandateId: string | null;
  holdReasons: OrderHoldReason[];
  policy: OrderPolicyResult | null;
  approvedVersion: number | null;
  approvedAt: string | null;
  /** "user:<id>" or "mandate:<id>". */
  approvedBy: string | null;
  /** True when a stored approval exists. The hash itself never leaves the server. */
  hasApproval: boolean;
  fill: OrderFill | null;
  executedAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  paper: true;
}

export interface ExecuteOrderResult {
  order: PaperOrder;
  fill: OrderFill;
  duplicate: boolean;
}

export interface TradingControls {
  userId: UserId;
  perOrderLimitCents: number;
  dailyOrderLimitCents: number;
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Mandates (bounded autonomous paper trading)
// ---------------------------------------------------------------------------

export type MandateStatus = "active" | "expired" | "revoked";

export interface Mandate {
  id: string;
  userId: UserId;
  agentId: string;
  accountId: string;
  symbols: string[];
  side: "buy";
  maxOrderCents: number;
  maxDailyCents: number;
  expiresAt: string;
  revokedAt: string | null;
  createdAt: string;
  status: MandateStatus;
  /** Executed under this mandate since the start of the current UTC day. */
  usedTodayCents: number;
  remainingTodayCents: number;
  paper: true;
}

export interface MandateOrderResult {
  order: PaperOrder;
  fill: OrderFill | null;
  executed: boolean;
  /** Set when the order was created but execution was refused. */
  refusal: { code: string; message: string } | null;
}
