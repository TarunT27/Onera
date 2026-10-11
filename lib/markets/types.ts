/** Public types for market data, portfolios and paper trading. Owned by the markets module. */
import type { UserId } from "@/lib/types";
import { msg } from "@/lib/i18n/msg";

/** Shown wherever prices appear. */
export const SIMULATED_PRICES_DISCLAIMER = msg("Simulated prices — not real market data");
/** The simulated market never closes. */
export const SIMULATED_MARKET_STATUS = msg("Simulated market — always open");
/** Shown wherever prices appear when Alpaca market data is on. */
export const ALPACA_PRICES_DISCLAIMER = msg(
  "Real prices from Alpaca (IEX exchange feed) — may differ slightly from consolidated quotes",
);

/** Where prices come from for the whole process: Alpaca when keys are configured, else the simulator. */
export type QuoteSource = "simulated" | "alpaca_iex";

/** Where an order executes. Fixed by the account: Onera's local paper broker or a linked Alpaca account. */
export type OrderVenue = "onera_paper" | "alpaca_paper" | "alpaca_live";

export interface MarketStatus {
  status: "open" | "closed";
  label: string;
  source: QuoteSource;
  /** Alpaca clock only. */
  nextOpen: string | null;
  nextClose: string | null;
}

export type InstrumentType = "stock" | "etf";

export interface Instrument {
  symbol: string;
  name: string;
  type: InstrumentType;
  sector: string | null;
  /** Listing exchange (Alpaca assets only), e.g. "NASDAQ". */
  exchange?: string | null;
}

/** A search hit: an instrument plus whether it is already on the user's watchlist. */
export interface InstrumentSearchResult extends Instrument {
  /** Always shown: part of Onera's built-in list. */
  builtIn: boolean;
  inWatchlist: boolean;
}

export interface Quote {
  symbol: string;
  priceCents: number;
  previousCloseCents: number;
  changePct: number;
  asOf: string;
  source: QuoteSource;
  delayedMinutes: number;
}

export interface PricePoint {
  /** UTC calendar day, YYYY-MM-DD. The last point is the current price. */
  date: string;
  closeCents: number;
}

export interface PriceHistory {
  symbol: string;
  points: PricePoint[];
  source: QuoteSource;
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
  /** True for accounts orders can be placed in (paper, or a connected Alpaca account). */
  tradable: boolean;
  paper: boolean;
  /** Where orders in this account execute; null for view-only accounts. */
  venue: OrderVenue | null;
  /** E.g. "Paper trading (simulated)", "Alpaca paper trading", "Imported holdings (view-only)". */
  label: string;
  cashCents: number;
  /** Cash available for buys (Alpaca: min(cash, non-marginable buying power) — never margin). */
  buyingPowerCents: number;
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
  quotesSource: QuoteSource;
  disclaimer: string;
}

// ---------------------------------------------------------------------------
// Paper orders
// ---------------------------------------------------------------------------

/**
 * Same lifecycle as transfer actions, plus broker states for Alpaca orders:
 * APPROVED → SUBMITTING (claimed, being sent) → SUBMITTED (live at Alpaca) →
 * EXECUTED (filled, possibly partially) | CANCELED (nothing filled) | FAILED (rejected).
 */
export type OrderState =
  | "PROPOSED" | "HELD" | "AWAITING_APPROVAL" | "APPROVED"
  | "SUBMITTING" | "SUBMITTED"
  | "EXECUTED" | "CANCELED" | "FAILED";
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
  /** Price the checks used, or null when no quote was available. */
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
  /** Onera paper broker only; Alpaca balances are re-read from the broker. */
  cashAfterCents: number | null;
  positionQuantityAfterMicros: number | null;
  /** Onera paper sells only: proceeds minus the average cost of the shares sold. */
  realizedPnlCents: number | null;
  approvedBy: string;
  executedBy: string;
  quoteSource: QuoteSource;
  venue: OrderVenue;
  /** Alpaca orders only: less than the submitted quantity filled before the order was canceled or expired. */
  partial: boolean;
  /** Alpaca's order ID, or null for Onera paper fills. */
  brokerOrderId: string | null;
  /** False only for Alpaca live (real money). */
  paper: boolean;
  /** True for Onera's simulated fills; false for fills reported by Alpaca. */
  simulated: boolean;
}

/** Alpaca-side details of an order sent to the broker. */
export interface BrokerOrderInfo {
  broker: "alpaca";
  env: "paper" | "live";
  clientOrderId: string;
  brokerOrderId: string | null;
  /** Alpaca's raw status, e.g. "new", "accepted", "partially_filled". */
  status: string | null;
  /** Quantity sent to Alpaca (notional buys are converted at the price bound). */
  quantityMicros: number | null;
  filledQuantityMicros: number;
  submittedAt: string | null;
  cancelRequestedAt: string | null;
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
  venue: OrderVenue;
  /** Null for Onera paper orders. */
  broker: BrokerOrderInfo | null;
  /** False only for Alpaca live (real money). */
  paper: boolean;
}

export interface ExecuteOrderResult {
  order: PaperOrder;
  fill: OrderFill;
  duplicate: boolean;
}

/** Result of placing an approved order: an Onera paper fill, or a submission to Alpaca. */
export interface PlaceOrderResult {
  order: PaperOrder;
  /** Set once the order filled (immediately for Onera paper; after Alpaca reports it otherwise). */
  fill: OrderFill | null;
  duplicate: boolean;
  venue: OrderVenue;
}

/** The user's Alpaca link, for the Trade screen. Never includes keys. */
export interface BrokerConnection {
  broker: "alpaca";
  /** Keys are present in the server environment. */
  configured: boolean;
  env: "paper" | "live";
  tradingEnabled: boolean;
  /** Keys belong to this session's user (ALPACA_USER_ID). */
  availableToUser: boolean;
  accountId: string | null;
  accountNumberMask: string | null;
  connectedAt: string | null;
  lastSyncedAt: string | null;
  lastSyncError: string | null;
  liveMaxOrderCents: number | null;
  feed: "iex" | "sip";
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
