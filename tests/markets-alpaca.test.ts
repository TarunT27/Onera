// Alpaca brokerage: connect, mirror, real quotes, two-phase submission, sync, cancel and the
// live-trading guards. A fake Alpaca (stubbed fetch) stands in for the real API.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import {
  approveOrder,
  cancelOrder,
  addToWatchlist,
  connectAlpaca,
  createMandate,
  createOrder,
  executeOrder,
  getOrder,
  getPortfolio,
  getPriceHistory,
  getQuote,
  listWatchlist,
  ordersExecutedTodayCents,
  placeOrder,
  refreshMarketData,
  removeFromWatchlist,
  searchMarket,
  syncOrders,
} from "@/lib/markets";
import { decimalProductCents, decimalToCents, decimalToMicros, microsToDecimal } from "@/lib/markets/math";
import { redact } from "@/lib/security/redact";
import type { UserId } from "@/lib/types";
import { errorCode, freshDb } from "./helpers";

const KEY_ID = "PKTESTKEYID0001";
const SECRET = "secretTESTvalue0123456789";
const ALPACA = "acct_alice_alpaca_paper";

interface FakeOrder {
  id: string;
  client_order_id: string;
  status: string;
  symbol: string;
  side: "buy" | "sell";
  qty: string;
  filled_qty: string;
  filled_avg_price: string | null;
  limit_price: string;
  submitted_at: string;
  filled_at: string | null;
  updated_at: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { "content-type": "application/json" },
  });
}

/** A minimal in-memory Alpaca. Tests tweak its fields to script broker behavior. */
function fakeAlpaca() {
  const fake = {
    account: {
      id: "11111111-2222-3333-4444-555555555555",
      account_number: "PA3ABCD1234",
      status: "ACTIVE",
      currency: "USD",
      cash: "100000.559",
      buying_power: "200000",
      non_marginable_buying_power: "90000.10",
      equity: "100000",
      trading_blocked: false,
      account_blocked: false,
    },
    config: { no_shorting: true, suspend_trade: false },
    positions: [
      { symbol: "AAPL", qty: "1.5", side: "long", cost_basis: "270.255", avg_entry_price: "180.17" },
      { symbol: "TSLA", qty: "-2", side: "short", cost_basis: "-500", avg_entry_price: "250" },
    ] as Record<string, unknown>[],
    prices: {} as Record<string, number>,
    orders: new Map<string, FakeOrder>(),
    posts: [] as Record<string, unknown>[],
    deletes: [] as string[],
    /** ok | reject403 | timeout | timeoutButCreated | auth */
    postMode: "ok" as string,
    deleteMode: "ok" as "ok" | "unprocessable",
    assetCalls: 0,
    calls: [] as string[],
  };

  const handler = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    fake.calls.push(`${method} ${url.host}${url.pathname}`);
    if (headers.get("APCA-API-KEY-ID") !== KEY_ID || headers.get("APCA-API-SECRET-KEY") !== SECRET) {
      return json({ message: "unauthorized." }, 401);
    }
    const path = url.pathname;
    if (url.host === "data.alpaca.markets") {
      if (path === "/v2/stocks/snapshots") {
        const out: Record<string, unknown> = {};
        for (const s of url.searchParams.get("symbols")!.split(",")) {
          const p = fake.prices[s] ?? 100;
          out[s] = { latestTrade: { t: new Date().toISOString(), p }, prevDailyBar: { t: "2026-10-08T04:00:00Z", c: 99 } };
        }
        return json(out);
      }
      if (path === "/v2/stocks/bars") {
        return json({ bars: { AAPL: [{ t: "2026-10-08T04:00:00Z", c: 98.5 }, { t: "2026-10-09T04:00:00Z", c: 99 }] },
          next_page_token: null });
      }
    }
    if (path === "/v2/account") return json(fake.account);
    if (path === "/v2/account/configurations") return json(fake.config);
    if (path === "/v2/positions") return json(fake.positions);
    if (path === "/v2/clock") {
      return json({ timestamp: new Date().toISOString(), is_open: true,
        next_open: "2026-10-12T13:30:00Z", next_close: "2099-01-01T21:00:00Z" });
    }
    if (path === "/v2/assets") {
      fake.assetCalls++;
      return json([
        { symbol: "TSLA", name: "Tesla, Inc. Common Stock", exchange: "NASDAQ", tradable: true, fractionable: true, status: "active" },
        { symbol: "TSLT", name: "T-REX 2X Long Tesla Daily Target ETF", exchange: "BATS", tradable: true, fractionable: true, status: "active" },
        { symbol: "SPY", name: "SPDR S&P 500 ETF Trust", exchange: "ARCA", tradable: true, fractionable: true, status: "active" },
        { symbol: "SPYD", name: "SPDR Portfolio S&P 500 High Dividend ETF", exchange: "ARCA", tradable: true, fractionable: true, status: "active" },
        { symbol: "HALT", name: "Halted Holdings Inc.", exchange: "NYSE", tradable: false, fractionable: false, status: "active" },
      ]);
    }
    if (path.startsWith("/v2/assets/")) {
      return json({ symbol: path.split("/").pop(), tradable: true, fractionable: true, status: "active" });
    }
    if (path === "/v2/orders" && method === "POST") {
      const body = JSON.parse(String(init!.body)) as Record<string, string>;
      fake.posts.push(body);
      if (fake.postMode === "reject403") return json({ message: "insufficient buying power" }, 403);
      if (fake.postMode === "auth") return json({ message: "forbidden" }, 401);
      const order: FakeOrder = {
        id: `alp_${fake.orders.size + 1}`, client_order_id: body.client_order_id, status: "accepted",
        symbol: body.symbol, side: body.side as "buy" | "sell", qty: body.qty, filled_qty: "0",
        filled_avg_price: null, limit_price: body.limit_price, submitted_at: new Date().toISOString(),
        filled_at: null, updated_at: new Date().toISOString(),
      };
      if (fake.postMode === "timeout") throw new TypeError("fetch failed");
      fake.orders.set(order.id, order);
      if (fake.postMode === "timeoutButCreated") throw new TypeError("fetch failed");
      return json(order);
    }
    if (path === "/v2/orders:by_client_order_id") {
      const id = url.searchParams.get("client_order_id");
      const found = [...fake.orders.values()].find((o) => o.client_order_id === id);
      return found ? json(found) : json({ message: "order not found" }, 404);
    }
    if (path.startsWith("/v2/orders/")) {
      const id = decodeURIComponent(path.slice("/v2/orders/".length));
      const order = fake.orders.get(id);
      if (!order) return json({ message: "order not found" }, 404);
      if (method === "DELETE") {
        fake.deletes.push(id);
        if (fake.deleteMode === "unprocessable") return json({ message: "order is already in \"filled\" state" }, 422);
        order.status = "pending_cancel";
        return json(undefined, 204);
      }
      return json(order);
    }
    return json({ message: `unexpected ${method} ${path}` }, 404);
  };

  const fetchMock = vi.fn<typeof fetch>(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fake;
}

function useAlpacaEnv(overrides: Record<string, string> = {}) {
  vi.stubEnv("ALPACA_API_KEY_ID", KEY_ID);
  vi.stubEnv("ALPACA_API_SECRET_KEY", SECRET);
  vi.stubEnv("ALPACA_USER_ID", "alice");
  for (const [k, v] of Object.entries(overrides)) vi.stubEnv(k, v);
}

async function asyncCode(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ServiceError) return err.code;
    throw err;
  }
  throw new Error("Expected a ServiceError but nothing was thrown");
}

let db: DB;
let fake: ReturnType<typeof fakeAlpaca>;

beforeEach(() => {
  db = freshDb();
  useAlpacaEnv();
  fake = fakeAlpaca();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Connects, refreshes prices and proposes + approves a $50 AAPL buy at $100.00. */
async function approvedBuy(input: { notionalCents?: number; quantityMicros?: number; side?: "buy" | "sell" } = {}) {
  await connectAlpaca(db, "alice");
  await refreshMarketData(db, "alice", { force: true });
  const order = createOrder(db, "alice", {
    accountId: ALPACA, symbol: "AAPL", side: input.side ?? "buy",
    ...(input.quantityMicros ? { quantityMicros: input.quantityMicros } : { notionalCents: input.notionalCents ?? 5_000 }),
  }, "user");
  expect(order.state).toBe("AWAITING_APPROVAL");
  return approveOrder(db, "alice", order.id, { version: order.version });
}

describe("decimal conversions (no floats)", () => {
  it("converts broker decimal strings exactly", () => {
    expect(decimalToCents("100000.559", "floor")).toBe(10_000_055);
    expect(decimalToCents("0.005")).toBe(1);
    expect(decimalToCents("-12.345", "floor")).toBe(-1235);
    expect(decimalToCents(187.23)).toBe(18_723);
    expect(decimalToMicros("0.123456789")).toBe(123_456);
    expect(microsToDecimal(495_049)).toBe("0.495049");
    expect(microsToDecimal(2_000_000)).toBe("2");
    expect(decimalProductCents("0.495049", "100.5", "ceil")).toBe(4976);
    expect(decimalProductCents("0.495049", "100.5", "floor")).toBe(4975);
  });
});

describe("connect and mirror", () => {
  it("only the key owner can connect; others get not found", async () => {
    expect(await asyncCode(connectAlpaca(db, "bob" as UserId))).toBe("NOT_FOUND");
  });

  it("refuses a live account under ALPACA_ENV=paper", async () => {
    fake.account.account_number = "3ABCD1234";
    expect(await asyncCode(connectAlpaca(db, "alice"))).toBe("BAD_REQUEST");
  });

  it("links the account and mirrors cash (no margin) and long positions exactly", async () => {
    const connection = await connectAlpaca(db, "alice");
    expect(connection).toMatchObject({ accountId: ALPACA, accountNumberMask: "1234", env: "paper" });

    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(ALPACA) as Record<string, unknown>;
    expect(row).toMatchObject({ user_id: "alice", institution: "Alpaca", is_paper: 1, type: "brokerage",
      balance_cents: 10_000_055, available_cents: 9_000_010 });
    const positions = db.prepare("SELECT symbol, quantity_micros, cost_basis_cents FROM positions WHERE account_id = ?")
      .all(ALPACA);
    expect(positions).toEqual([{ symbol: "AAPL", quantity_micros: 1_500_000, cost_basis_cents: 27_026 }]); // short skipped

    const portfolio = getPortfolio(db, "alice");
    const acct = portfolio.accounts.find((a) => a.accountId === ALPACA)!;
    expect(acct).toMatchObject({ tradable: true, paper: true, venue: "alpaca_paper", label: "Alpaca paper trading",
      buyingPowerCents: 9_000_010 });
    // Alpaca paper money stays out of net worth.
    expect(portfolio.investedValueCents).toBe(
      portfolio.accounts.filter((a) => !a.paper).reduce((s, a) => s + a.positionsValueCents, 0));
  });

  it("never writes the keys to the audit log", async () => {
    await connectAlpaca(db, "alice");
    const audit = JSON.stringify(listAudit(db, "alice", { limit: 100 }));
    expect(audit).toContain("broker.connected");
    expect(audit).not.toContain(KEY_ID);
    expect(audit).not.toContain(SECRET);
  });
});

describe("market data", () => {
  it("uses real quotes from the cache and never falls back to simulated prices", async () => {
    const now = new Date();
    expect(getQuote("AAPL", now, db)).toBeNull(); // nothing cached yet
    await connectAlpaca(db, "alice");
    const held = createOrder(db, "alice", { accountId: ALPACA, symbol: "AAPL", side: "buy", notionalCents: 5_000 }, "user");
    expect(held.state).toBe("HELD");
    expect(held.holdReasons).toContain("QUOTE_UNAVAILABLE");

    fake.prices.AAPL = 187.23;
    await refreshMarketData(db, "alice", { force: true });
    expect(getQuote("AAPL", new Date(), db)).toMatchObject({ priceCents: 18_723, previousCloseCents: 9_900,
      source: "alpaca_iex" });
    // Stale after a minute.
    expect(getQuote("AAPL", new Date(Date.now() + 61_000), db)).toBeNull();
    expect(getPortfolio(db, "alice").quotesSource).toBe("alpaca_iex");
  });
});

describe("submitting to Alpaca", () => {
  it("sends a day limit order at the approved bound; a notional buy never exceeds its amount", async () => {
    const approved = await approvedBuy();
    expect(approved.venue).toBe("alpaca_paper");
    expect(approved.priceBoundCents).toBe(10_100);

    const result = await placeOrder(db, "alice", approved.id);
    expect(fake.posts).toHaveLength(1);
    const body = fake.posts[0];
    expect(body).toEqual({
      symbol: "AAPL", qty: "0.495049", side: "buy", type: "limit", time_in_force: "day", limit_price: "101.00",
      client_order_id: `${approved.id}-v${approved.version}`, extended_hours: false,
    });
    expect(decimalProductCents(String(body.qty), String(body.limit_price), "ceil")).toBeLessThanOrEqual(5_000);
    expect(result.order.state).toBe("SUBMITTED");
    expect(result.fill).toBeNull();
    expect(result.order.broker).toMatchObject({ brokerOrderId: "alp_1", status: "accepted", quantityMicros: 495_049 });

    // The open order reserves its worst-case value against the daily limit.
    expect(ordersExecutedTodayCents(db, "alice", new Date())).toBe(5_000);

    // A repeat never posts again.
    const again = await placeOrder(db, "alice", approved.id);
    expect(again.duplicate).toBe(true);
    expect(fake.posts).toHaveLength(1);
  });

  it("records the real fill once Alpaca reports it and re-reads the account", async () => {
    const approved = await approvedBuy();
    await placeOrder(db, "alice", approved.id);
    Object.assign(fake.orders.get("alp_1")!, { status: "filled", filled_qty: "0.495049", filled_avg_price: "100.5",
      filled_at: new Date().toISOString() });
    fake.positions.push({ symbol: "MSFT", qty: "0.2", side: "long", cost_basis: "80" });

    expect(await syncOrders(db, "alice")).toBe(1);
    const order = getOrder(db, "alice", approved.id);
    expect(order.state).toBe("EXECUTED");
    expect(order.fill).toMatchObject({ quantityMicros: 495_049, priceCents: 10_050, grossCents: 4_976,
      simulated: false, paper: true, venue: "alpaca_paper", partial: false, brokerOrderId: "alp_1" });
    // Fill replaces the reservation in today's usage.
    expect(ordersExecutedTodayCents(db, "alice", new Date())).toBe(4_976);
    // The mirror picked up the new position.
    expect(db.prepare("SELECT COUNT(*) AS n FROM positions WHERE account_id = ? AND symbol = 'MSFT'").get(ALPACA))
      .toEqual({ n: 1 });
  });

  it("marks a broker refusal FAILED and frees the reservation", async () => {
    const approved = await approvedBuy();
    fake.postMode = "reject403";
    const result = await placeOrder(db, "alice", approved.id);
    expect(result.order.state).toBe("FAILED");
    expect(result.order.failureReason).toContain("insufficient buying power");
    expect(ordersExecutedTodayCents(db, "alice", new Date())).toBe(0);
  });

  it("returns the order to APPROVED when the keys are rejected (nothing was placed)", async () => {
    const approved = await approvedBuy();
    fake.postMode = "auth";
    expect(await asyncCode(placeOrder(db, "alice", approved.id))).toBe("UNSUPPORTED");
    expect(getOrder(db, "alice", approved.id)).toMatchObject({ state: "APPROVED", broker: null });
  });

  it("reconciles an ambiguous timeout by client_order_id instead of re-posting", async () => {
    const approved = await approvedBuy();
    fake.postMode = "timeoutButCreated";
    const result = await placeOrder(db, "alice", approved.id);
    expect(fake.posts).toHaveLength(1);
    expect(result.order.state).toBe("SUBMITTED");
    expect(result.order.broker?.brokerOrderId).toBe("alp_1");
  });

  it("leaves an unconfirmed submission SUBMITTING, then fails it once Alpaca clearly never got it", async () => {
    const approved = await approvedBuy();
    fake.postMode = "timeout";
    const result = await placeOrder(db, "alice", approved.id);
    expect(result.order.state).toBe("SUBMITTING");
    expect(await syncOrders(db, "alice")).toBe(0);
    expect(getOrder(db, "alice", approved.id).state).toBe("SUBMITTING");

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 3 * 60_000);
    expect(await syncOrders(db, "alice")).toBe(1);
    expect(getOrder(db, "alice", approved.id).state).toBe("FAILED");
    expect(fake.posts).toHaveLength(1);
  });

  it("maps partial-then-canceled to EXECUTED (partial), expired to CANCELED and rejected to FAILED", async () => {
    const a = await approvedBuy();
    await placeOrder(db, "alice", a.id);
    Object.assign(fake.orders.get("alp_1")!, { status: "canceled", filled_qty: "0.2", filled_avg_price: "100" });

    const b = createOrder(db, "alice", { accountId: ALPACA, symbol: "MSFT", side: "buy", notionalCents: 1_000 }, "user");
    await placeOrder(db, "alice", approveOrder(db, "alice", b.id, { version: b.version }).id);
    fake.orders.get("alp_2")!.status = "expired";

    const c = createOrder(db, "alice", { accountId: ALPACA, symbol: "KO", side: "buy", notionalCents: 1_000 }, "user");
    await placeOrder(db, "alice", approveOrder(db, "alice", c.id, { version: c.version }).id);
    fake.orders.get("alp_3")!.status = "rejected";

    expect(await syncOrders(db, "alice")).toBe(3);
    expect(getOrder(db, "alice", a.id)).toMatchObject({ state: "EXECUTED", fill: { partial: true, quantityMicros: 200_000,
      grossCents: 2_000 } });
    expect(getOrder(db, "alice", b.id).state).toBe("CANCELED");
    expect(getOrder(db, "alice", c.id).state).toBe("FAILED");
  });

  it("voids the approval when the configured environment changes (paper approval never goes live)", async () => {
    const approved = await approvedBuy();
    vi.stubEnv("ALPACA_ENV", "live");
    vi.stubEnv("ALPACA_ALLOW_LIVE_TRADING", "true");
    expect(await asyncCode(placeOrder(db, "alice", approved.id))).toBe("POLICY_HOLD");
    expect(fake.posts).toHaveLength(0);
    expect(getOrder(db, "alice", approved.id).state).toBe("HELD");
  });

  it("subtracts shares committed to open sells", async () => {
    const sell = await approvedBuy({ side: "sell", quantityMicros: 1_000_000 });
    await placeOrder(db, "alice", sell.id);
    // 1.5 held, 1.0 already on its way: a second 1-share sell is held.
    const second = createOrder(db, "alice", { accountId: ALPACA, symbol: "AAPL", side: "sell", quantityMicros: 1_000_000 }, "user");
    expect(second.holdReasons).toContain("INSUFFICIENT_SHARES");
  });
});

describe("guards", () => {
  it("never fills an Alpaca order in Onera's paper broker and never grants mandates on it", async () => {
    const approved = await approvedBuy();
    expect(errorCode(() => executeOrder(db, "alice", approved.id))).toBe("INVALID_STATE");
    expect(errorCode(() => createMandate(db, "alice", {
      agentId: "dca-bot", accountId: ALPACA, symbols: ["AAPL"], maxOrderCents: 1_000, maxDailyCents: 2_000,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    }))).toBe("BAD_REQUEST");
  });

  it("Onera paper orders still execute locally while Alpaca is configured", async () => {
    await refreshMarketData(db, "alice", { force: true });
    const o = createOrder(db, "alice", { accountId: "acct_alice_paper", symbol: "VTI", side: "buy", notionalCents: 2_000 }, "user");
    const r = await placeOrder(db, "alice", approveOrder(db, "alice", o.id, { version: o.version }).id);
    expect(r.venue).toBe("onera_paper");
    expect(r.fill).toMatchObject({ simulated: true, quoteSource: "alpaca_iex", priceCents: 10_000 });
    expect(fake.posts).toHaveLength(0);
  });
});

describe("cancel", () => {
  it("requests cancellation and waits for Alpaca to confirm it", async () => {
    const approved = await approvedBuy();
    await placeOrder(db, "alice", approved.id);
    const pending = await cancelOrder(db, "alice", approved.id);
    expect(fake.deletes).toEqual(["alp_1"]);
    expect(pending.state).toBe("SUBMITTED");
    expect(pending.broker?.cancelRequestedAt).not.toBeNull();

    fake.orders.get("alp_1")!.status = "canceled";
    await syncOrders(db, "alice");
    expect(getOrder(db, "alice", approved.id).state).toBe("CANCELED");
    expect(ordersExecutedTodayCents(db, "alice", new Date())).toBe(0);
  });

  it("reports the fill when the order filled before the cancel arrived", async () => {
    const approved = await approvedBuy();
    await placeOrder(db, "alice", approved.id);
    fake.deleteMode = "unprocessable";
    Object.assign(fake.orders.get("alp_1")!, { status: "filled", filled_qty: "0.495049", filled_avg_price: "100" });
    const order = await cancelOrder(db, "alice", approved.id);
    expect(order.state).toBe("EXECUTED");
  });

  it("cannot cancel another user's order", async () => {
    const approved = await approvedBuy();
    await placeOrder(db, "alice", approved.id);
    expect(await asyncCode(cancelOrder(db, "bob" as UserId, approved.id))).toBe("NOT_FOUND");
  });
});

describe("live trading", () => {
  beforeEach(() => {
    fake.account.account_number = "3ABCD1234";
  });

  it("refuses to connect a live account unless live trading is explicitly allowed", async () => {
    vi.stubEnv("ALPACA_ENV", "live");
    expect(await asyncCode(connectAlpaca(db, "alice"))).toBe("UNSUPPORTED");
  });

  it("allows only your own orders, each under the live cap", async () => {
    vi.stubEnv("ALPACA_ENV", "live");
    vi.stubEnv("ALPACA_ALLOW_LIVE_TRADING", "true");
    vi.stubEnv("ALPACA_LIVE_MAX_ORDER_CENTS", "2500");
    await connectAlpaca(db, "alice");
    await refreshMarketData(db, "alice", { force: true });
    const live = "acct_alice_alpaca_live";
    expect(getPortfolio(db, "alice").accounts.find((a) => a.accountId === live)).toMatchObject({
      paper: false, venue: "alpaca_live", tradable: true });

    expect(errorCode(() => createOrder(db, "alice",
      { accountId: live, symbol: "AAPL", side: "buy", notionalCents: 1_000 }, "assistant"))).toBe("BAD_REQUEST");

    const big = createOrder(db, "alice", { accountId: live, symbol: "AAPL", side: "buy", notionalCents: 5_000 }, "user");
    expect(big.holdReasons).toContain("ORDER_LIMIT_EXCEEDED");
    const small = createOrder(db, "alice", { accountId: live, symbol: "AAPL", side: "buy", notionalCents: 2_000 }, "user");
    expect(small.state).toBe("AWAITING_APPROVAL");
    expect(small.paper).toBe(false);
  });
});

describe("secrets", () => {
  it("redacts the configured keys from any text", () => {
    expect(redact(`key ${KEY_ID} and ${SECRET}`)).not.toMatch(new RegExp(`${KEY_ID}|${SECRET}`));
  });

  it("maps rejected keys to a configuration error without echoing them", async () => {
    vi.stubEnv("ALPACA_API_SECRET_KEY", "wrongSecretValue123");
    const err = await connectAlpaca(db, "alice").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).message).toContain("rejected the API keys");
    expect((err as ServiceError).message).not.toContain("wrongSecretValue123");
  });
});

describe("stock search and watchlist", () => {
  it("searches every tradable US equity by ticker or name, without leveraged or untradable funds", async () => {
    const tesla = await searchMarket(db, "alice", "tesla");
    expect(tesla.map((r) => r.symbol)).toEqual(["TSLA"]);
    expect(tesla[0]).toMatchObject({ name: "Tesla, Inc. Common Stock", type: "stock", exchange: "NASDAQ",
      builtIn: false, inWatchlist: false });

    const spy = await searchMarket(db, "alice", "spy");
    expect(spy[0]).toMatchObject({ symbol: "SPY", type: "etf" });
    expect(spy.map((r) => r.symbol)).toContain("SPYD");

    expect(await searchMarket(db, "alice", "halted")).toEqual([]);
    expect((await searchMarket(db, "alice", "apple"))[0]).toMatchObject({ symbol: "AAPL", builtIn: true });
    // The asset list is cached, not re-fetched per keystroke.
    expect(fake.assetCalls).toBe(1);
  });

  it("keeps a per-user watchlist of real instruments only", async () => {
    await searchMarket(db, "alice", "tsla");
    expect(addToWatchlist(db, "alice", { symbol: "tsla" })).toEqual(["TSLA"]);
    expect(addToWatchlist(db, "alice", { symbol: "TSLA" })).toEqual(["TSLA"]);
    expect(errorCode(() => addToWatchlist(db, "alice", { symbol: "NOPE" }))).toBe("NOT_FOUND");
    expect(errorCode(() => addToWatchlist(db, "alice", { symbol: "TSLT" }))).toBe("NOT_FOUND"); // leveraged
    expect(errorCode(() => addToWatchlist(db, "alice", { symbol: "1$" }))).toBe("BAD_REQUEST");
    expect(listWatchlist(db, "bob" as UserId)).toEqual([]);
    expect((await searchMarket(db, "alice", "tesla"))[0].inWatchlist).toBe(true);
    expect(removeFromWatchlist(db, "alice", "tsla")).toEqual([]);
  });

  it("prices, charts and trades a searched symbol through the same approval flow", async () => {
    fake.prices.TSLA = 382.5;
    await connectAlpaca(db, "alice");
    await searchMarket(db, "alice", "tesla");
    await refreshMarketData(db, "alice", { symbols: ["TSLA"], force: true });
    expect(getQuote("TSLA", new Date(), db)).toMatchObject({ priceCents: 38_250, source: "alpaca_iex" });
    expect(getPriceHistory("TSLA", 30, new Date(), db)?.points.at(-1)?.closeCents).toBe(38_250);

    const order = createOrder(db, "alice", { accountId: ALPACA, symbol: "TSLA", side: "buy", notionalCents: 5_000 }, "user");
    expect(order.state).toBe("AWAITING_APPROVAL");
    const approved = approveOrder(db, "alice", order.id, { version: order.version });
    await placeOrder(db, "alice", approved.id);
    expect(fake.posts[0]).toMatchObject({ symbol: "TSLA", type: "limit", limit_price: "386.33" });
  });

  it("only offers the built-in list in simulated mode", async () => {
    vi.unstubAllEnvs();
    expect((await searchMarket(db, "alice", "apple")).map((r) => r.symbol)).toEqual(["AAPL"]);
    expect(await searchMarket(db, "alice", "tesla")).toEqual([]);
    const held = createOrder(db, "alice", { accountId: "acct_alice_paper", symbol: "TSLA", side: "buy", notionalCents: 1_000 }, "user");
    expect(held.holdReasons).toContain("INSTRUMENT_NOT_ALLOWED");
    expect(fake.assetCalls).toBe(0);
  });
});
