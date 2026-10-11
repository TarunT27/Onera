/**
 * Alpaca HTTP client (Trading API + Market Data API). Internal to lib/markets.
 *
 * One key pair from the server environment, mapped to one demo user
 * (ALPACA_USER_ID). Keys never leave the server and are never echoed in
 * errors. Paper is the default; the live endpoint needs ALPACA_ENV=live AND
 * ALPACA_ALLOW_LIVE_TRADING=true.
 *
 * Every function throws AlpacaError on failure. Callers (brokerage.ts,
 * marketdata.ts) decide what a failure means for an order: on POST /v2/orders
 * a 403/422 is a final broker rejection, while a timeout or 5xx is ambiguous
 * (the order may exist) and must be reconciled by client_order_id.
 */
import { ServiceError } from "@/lib/errors";
import { redact } from "@/lib/security/redact";

export type AlpacaEnv = "paper" | "live";

const TRADING_URL: Record<AlpacaEnv, string> = {
  paper: "https://paper-api.alpaca.markets",
  live: "https://api.alpaca.markets",
};
const DATA_URL = "https://data.alpaca.markets";
const TIMEOUT_MS = 10_000;
/** Default hard cap for one live order ($100) when ALPACA_LIVE_MAX_ORDER_CENTS is unset. */
const DEFAULT_LIVE_MAX_ORDER_CENTS = 10_000;

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  env: AlpacaEnv;
  liveTradingAllowed: boolean;
  liveMaxOrderCents: number;
  feed: "iex" | "sip";
  /** The demo user these keys belong to. */
  userId: string;
}

export function alpacaConfig(): AlpacaConfig {
  const env = process.env.ALPACA_ENV?.trim().toLowerCase() === "live" ? "live" : "paper";
  const cap = Number(process.env.ALPACA_LIVE_MAX_ORDER_CENTS);
  return {
    keyId: process.env.ALPACA_API_KEY_ID?.trim() ?? "",
    secretKey: process.env.ALPACA_API_SECRET_KEY?.trim() ?? "",
    env,
    liveTradingAllowed: process.env.ALPACA_ALLOW_LIVE_TRADING?.trim().toLowerCase() === "true",
    liveMaxOrderCents: Number.isSafeInteger(cap) && cap > 0 ? cap : DEFAULT_LIVE_MAX_ORDER_CENTS,
    feed: process.env.ALPACA_DATA_FEED?.trim().toLowerCase() === "sip" ? "sip" : "iex",
    userId: process.env.ALPACA_USER_ID?.trim() || "alice",
  };
}

/** True when both keys are set. Decides the market-data mode for the whole process. */
export function alpacaConfigured(): boolean {
  const c = alpacaConfig();
  return c.keyId !== "" && c.secretKey !== "";
}

export interface AlpacaStatus {
  configured: boolean;
  env: AlpacaEnv;
  /** Paper always; live only with ALPACA_ALLOW_LIVE_TRADING=true. */
  tradingEnabled: boolean;
  liveTradingAllowed: boolean;
  liveMaxOrderCents: number | null;
  feed: "iex" | "sip";
}

export function alpacaStatus(): AlpacaStatus {
  const c = alpacaConfig();
  const configured = c.keyId !== "" && c.secretKey !== "";
  return {
    configured,
    env: c.env,
    tradingEnabled: configured && (c.env === "paper" || c.liveTradingAllowed),
    liveTradingAllowed: c.liveTradingAllowed,
    liveMaxOrderCents: c.env === "live" ? c.liveMaxOrderCents : null,
    feed: c.feed,
  };
}

export function requireAlpaca(): AlpacaConfig {
  const c = alpacaConfig();
  if (!c.keyId || !c.secretKey) {
    throw new ServiceError("UNSUPPORTED",
      "Alpaca is not configured. Add ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY to .env.local and restart the server.",
      503);
  }
  return c;
}

// --- Errors -------------------------------------------------------------------

export type AlpacaErrorKind =
  | "network"      // no response (DNS, refused, timeout): outcome unknown
  | "auth"         // 401: bad or missing keys
  | "forbidden"    // 403: on orders, insufficient buying power/shares or a trading restriction
  | "not_found"    // 404
  | "unprocessable"// 422: request rejected as invalid
  | "rate_limited" // 429
  | "server";      // 5xx: outcome unknown

export class AlpacaError extends Error {
  constructor(
    public kind: AlpacaErrorKind,
    public status: number | null,
    /** Alpaca's message, redacted and bounded. Safe to show the user. */
    public brokerMessage: string,
  ) {
    super(`Alpaca ${kind}${status ? ` (${status})` : ""}: ${brokerMessage}`);
    this.name = "AlpacaError";
  }
}

function kindFor(status: number): AlpacaErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 422) return "unprocessable";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "unprocessable";
}

/** Strips anything secret-looking (redact() also removes the configured Alpaca keys) and bounds the length. */
function safeText(text: string): string {
  return redact(text, 300);
}

async function call<T>(base: "trading" | "data", path: string, init: RequestInit = {}): Promise<T> {
  const c = requireAlpaca();
  const url = `${base === "trading" ? TRADING_URL[c.env] : DATA_URL}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "APCA-API-KEY-ID": c.keyId,
        "APCA-API-SECRET-KEY": c.secretKey,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AlpacaError("network", null, safeText(`Alpaca could not be reached: ${message}`));
  }
  if (res.ok) {
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
  const raw = await res.text().catch(() => "");
  let message = "";
  try {
    const body = JSON.parse(raw) as { message?: unknown };
    if (typeof body.message === "string") message = body.message;
  } catch {
    /* non-JSON error body */
  }
  throw new AlpacaError(kindFor(res.status), res.status, safeText(message || `HTTP ${res.status}`));
}

// --- Trading API ----------------------------------------------------------------

export interface AlpacaAccount {
  id: string;
  account_number: string;
  status: string;
  currency: string;
  cash: string;
  buying_power: string;
  non_marginable_buying_power: string;
  equity: string;
  trading_blocked: boolean;
  account_blocked: boolean;
}

export interface AlpacaAccountConfig {
  no_shorting: boolean;
  suspend_trade: boolean;
  fractional_trading?: boolean;
  max_margin_multiplier?: string;
}

export interface AlpacaAsset {
  symbol: string;
  tradable: boolean;
  fractionable: boolean;
  status: string;
}

export interface AlpacaPosition {
  symbol: string;
  qty: string;
  qty_available?: string;
  side: "long" | "short";
  cost_basis: string;
  avg_entry_price: string;
  current_price?: string | null;
  lastday_price?: string | null;
}

export type AlpacaOrderStatus =
  | "new" | "partially_filled" | "filled" | "done_for_day" | "canceled" | "expired" | "replaced"
  | "pending_cancel" | "pending_replace" | "accepted" | "pending_new" | "accepted_for_bidding"
  | "stopped" | "rejected" | "suspended" | "calculated" | "held";

export interface AlpacaOrder {
  id: string;
  client_order_id: string;
  status: AlpacaOrderStatus;
  symbol: string;
  side: "buy" | "sell";
  qty: string | null;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string | null;
  submitted_at: string | null;
  filled_at: string | null;
  updated_at: string | null;
}

export interface AlpacaOrderRequest {
  symbol: string;
  qty: string;
  side: "buy" | "sell";
  type: "limit";
  time_in_force: "day";
  limit_price: string;
  client_order_id: string;
  extended_hours: false;
}

export interface AlpacaClock {
  timestamp: string;
  is_open: boolean;
  next_open: string;
  next_close: string;
}

export const getAccount = () => call<AlpacaAccount>("trading", "/v2/account");
export const getAccountConfig = () => call<AlpacaAccountConfig>("trading", "/v2/account/configurations");
export const getAsset = (symbol: string) =>
  call<AlpacaAsset>("trading", `/v2/assets/${encodeURIComponent(symbol)}`);
export const listPositions = () => call<AlpacaPosition[]>("trading", "/v2/positions");
export const getClock = () => call<AlpacaClock>("trading", "/v2/clock");

export const postOrder = (body: AlpacaOrderRequest) =>
  call<AlpacaOrder>("trading", "/v2/orders", { method: "POST", body: JSON.stringify(body) });
export const getBrokerOrder = (brokerOrderId: string) =>
  call<AlpacaOrder>("trading", `/v2/orders/${encodeURIComponent(brokerOrderId)}`);

/** The order with this client_order_id, or null when Alpaca has none. */
export async function getOrderByClientId(clientOrderId: string): Promise<AlpacaOrder | null> {
  try {
    return await call<AlpacaOrder>("trading",
      `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(clientOrderId)}`);
  } catch (err) {
    if (err instanceof AlpacaError && err.kind === "not_found") return null;
    throw err;
  }
}

/** Requests cancellation. Alpaca confirms asynchronously; a 422 means it can no longer be canceled. */
export const cancelBrokerOrder = (brokerOrderId: string) =>
  call<void>("trading", `/v2/orders/${encodeURIComponent(brokerOrderId)}`, { method: "DELETE" });

// --- Market Data API --------------------------------------------------------------

export interface AlpacaSnapshot {
  latestTrade?: { t: string; p: number } | null;
  dailyBar?: { t: string; c: number } | null;
  prevDailyBar?: { t: string; c: number } | null;
}

export async function getSnapshots(symbols: string[]): Promise<Record<string, AlpacaSnapshot | null>> {
  const { feed } = requireAlpaca();
  const q = new URLSearchParams({ symbols: symbols.join(","), feed });
  return call<Record<string, AlpacaSnapshot | null>>("data", `/v2/stocks/snapshots?${q}`);
}

export interface AlpacaBar {
  t: string;
  c: number;
}

/** Daily bars since `start` for each symbol, following pagination. */
export async function getDailyBars(symbols: string[], start: Date): Promise<Record<string, AlpacaBar[]>> {
  const { feed } = requireAlpaca();
  const out: Record<string, AlpacaBar[]> = {};
  let pageToken: string | null = null;
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({
      symbols: symbols.join(","), timeframe: "1Day", start: start.toISOString(), limit: "10000",
      adjustment: "all", feed,
    });
    if (pageToken) q.set("page_token", pageToken);
    const body = await call<{ bars: Record<string, AlpacaBar[]> | null; next_page_token: string | null }>(
      "data", `/v2/stocks/bars?${q}`);
    for (const [symbol, bars] of Object.entries(body.bars ?? {})) (out[symbol] ??= []).push(...bars);
    pageToken = body.next_page_token;
    if (!pageToken) break;
  }
  return out;
}
