// Paper orders: same governance as transfers — policy, exact-version approval,
// price bound, pause, single execution, ownership.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { updateControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import {
  approveOrder,
  createOrder,
  editOrder,
  evaluateOrder,
  executeOrder,
  getOrder,
  getPortfolio,
  getQuote,
  listOrders,
  updateTradingControls,
} from "@/lib/markets";
import type { UserId } from "@/lib/types";
import { balance, errorCode, freshDb } from "./helpers";

const PAPER = "acct_alice_paper";
const DAY_MS = 86_400_000;

// Write paths read the real clock; freeze it so quotes (per-minute) and day windows are deterministic.
const T0 = new Date("2026-10-07T15:30:20.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

const buy = (db: DB, input: { symbol?: string; notionalCents?: number; quantityMicros?: number } = {}) =>
  createOrder(db, "alice", {
    accountId: PAPER, side: "buy", symbol: input.symbol ?? "VTI",
    ...(input.quantityMicros ? { quantityMicros: input.quantityMicros } : { notionalCents: input.notionalCents ?? 20_000 }),
  }, "user");

const position = (db: DB, accountId: string, symbol: string) =>
  db.prepare("SELECT quantity_micros AS q, cost_basis_cents AS c FROM positions WHERE account_id = ? AND symbol = ?")
    .get(accountId, symbol) as { q: number; c: number } | undefined;

const stateOf = (db: DB, id: string) =>
  (db.prepare("SELECT state FROM orders WHERE id = ?").get(id) as { state: string }).state;

const approveAndExecute = (db: DB, userId: UserId, id: string, version: number) => {
  approveOrder(db, userId, id, { version });
  return executeOrder(db, userId, id);
};

describe("paper buy lifecycle", () => {
  it("proposes, holds for approval, executes once and records fill + audit", () => {
    const db = freshDb();
    const now = new Date();
    const cashBefore = balance(db, PAPER);
    const investedBefore = getPortfolio(db, "alice", now).investedValueCents;

    const proposed = buy(db, { notionalCents: 20_000 });
    expect(proposed.state).toBe("AWAITING_APPROVAL");
    expect(proposed.paper).toBe(true);
    expect(proposed.hasApproval).toBe(false);
    const quote = getQuote("VTI", now)!;
    expect(proposed.quotePriceCents).toBe(quote.priceCents);
    expect(proposed.priceBoundCents).toBe(Math.ceil((quote.priceCents * 101) / 100));

    const approved = approveOrder(db, "alice", proposed.id, { version: proposed.version });
    expect(approved.state).toBe("APPROVED");
    expect(approved.approvedBy).toBe("user:alice");
    expect(approved.hasApproval).toBe(true);

    const result = executeOrder(db, "alice", proposed.id);
    expect(result.duplicate).toBe(false);
    expect(result.order.state).toBe("EXECUTED");
    const fill = result.fill;
    expect(fill.paper).toBe(true);
    expect(fill.simulated).toBe(true);
    expect(fill.priceCents).toBe(quote.priceCents);
    expect(fill.grossCents).toBeLessThanOrEqual(20_000);
    expect(fill.grossCents).toBeGreaterThan(20_000 - quote.priceCents / 1_000);
    expect(balance(db, PAPER)).toBe(cashBefore - fill.grossCents);
    expect(fill.cashAfterCents).toBe(cashBefore - fill.grossCents);
    expect(position(db, PAPER, "VTI")).toEqual({ q: fill.quantityMicros, c: fill.grossCents });

    // Paper trades never change net-worth investments.
    expect(getPortfolio(db, "alice", now).investedValueCents).toBe(investedBefore);

    const events = listAudit(db, "alice", { actionId: proposed.id }).map((e) => e.eventType).reverse();
    expect(events).toEqual(["order.proposed", "order.awaiting_approval", "order.approved", "order.executed"]);
  });

  it("buys an exact quantity and never exposes the approval hash", () => {
    const db = freshDb();
    const now = new Date();
    const o = buy(db, { symbol: "KO", quantityMicros: 2_000_000 });
    const approved = approveOrder(db, "alice", o.id, { version: o.version });
    const json = JSON.stringify([approved, getOrder(db, "alice", o.id), listOrders(db, "alice")]);
    const { approval_hash } = db.prepare("SELECT approval_hash FROM orders WHERE id = ?").get(o.id) as { approval_hash: string };
    expect(approval_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(json).not.toContain(approval_hash);
    expect(json).not.toMatch(/approval_?hash/i);

    const { fill } = executeOrder(db, "alice", o.id);
    expect(fill.quantityMicros).toBe(2_000_000);
    expect(fill.grossCents).toBe(fill.priceCents * 2);
  });

  it("clients cannot set state, approval or mandate fields", () => {
    const db = freshDb();
    const base = { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 1_000 };
    expect(() => createOrder(db, "alice", { ...base, state: "APPROVED" }, "user")).toThrow();
    expect(() => createOrder(db, "alice", { ...base, approvalHash: "x" }, "user")).toThrow();
    expect(() => createOrder(db, "alice", { ...base, mandateId: "mdt_x" }, "user")).toThrow();
    const o = createOrder(db, "alice", base, "user");
    expect(() => editOrder(db, "alice", o.id, { state: "EXECUTED" })).toThrow();
    expect(stateOf(db, o.id)).toBe("AWAITING_APPROVAL");
  });
});

describe("paper sell lifecycle", () => {
  it("sells part of a position at average cost and reports realized P&L, then closes it", () => {
    const db = freshDb();
    const now = new Date();
    const before = position(db, PAPER, "VOO")!;
    const cashBefore = balance(db, PAPER);

    const half = Math.floor(before.q / 2 / 1_000) * 1_000;
    const sell = createOrder(db, "alice", { accountId: PAPER, symbol: "VOO", side: "sell", quantityMicros: half }, "user");
    expect(sell.state).toBe("AWAITING_APPROVAL");
    expect(sell.priceBoundCents).toBe(Math.floor((getQuote("VOO", now)!.priceCents * 99) / 100));
    const { fill } = approveAndExecute(db, "alice", sell.id, sell.version);

    const costPortion = Math.round((before.c * half) / before.q);
    expect(fill.realizedPnlCents).toBe(fill.grossCents - costPortion);
    expect(balance(db, PAPER)).toBe(cashBefore + fill.grossCents);
    expect(position(db, PAPER, "VOO")).toEqual({ q: before.q - half, c: before.c - costPortion });

    const rest = createOrder(db, "alice",
      { accountId: PAPER, symbol: "VOO", side: "sell", quantityMicros: before.q - half }, "user");
    approveAndExecute(db, "alice", rest.id, rest.version);
    expect(position(db, PAPER, "VOO")).toBeUndefined();
  });

  it("holds sells larger than the position (no shorting) and sells of unheld symbols", () => {
    const db = freshDb();
    const held = position(db, PAPER, "VOO")!.q;
    const tooMany = createOrder(db, "alice",
      { accountId: PAPER, symbol: "VOO", side: "sell", quantityMicros: held + 1_000 }, "user");
    expect(tooMany.state).toBe("HELD");
    expect(tooMany.holdReasons).toContain("INSUFFICIENT_SHARES");
    const notHeld = createOrder(db, "alice",
      { accountId: PAPER, symbol: "AAPL", side: "sell", quantityMicros: 1_000_000 }, "user");
    expect(notHeld.holdReasons).toContain("INSUFFICIENT_SHARES");
    expect(errorCode(() => approveOrder(db, "alice", tooMany.id, { version: tooMany.version }))).toBe("INVALID_STATE");
    expect(errorCode(() => executeOrder(db, "alice", tooMany.id))).toBe("INVALID_STATE");
    expect(position(db, PAPER, "VOO")!.q).toBe(held);
  });

  it("rejects sells sized by notional", () => {
    const db = freshDb();
    expect(() => createOrder(db, "alice",
      { accountId: PAPER, symbol: "VOO", side: "sell", notionalCents: 1_000 }, "user")).toThrow();
  });
});

describe("policy holds", () => {
  it("holds buys larger than paper cash", () => {
    const db = freshDb();
    updateTradingControls(db, "bob", { perOrderLimitCents: 10_000_000, dailyOrderLimitCents: 10_000_000 });
    const o = createOrder(db, "bob", { accountId: "acct_bob_paper", symbol: "VOO", side: "buy", notionalCents: 150_000 }, "user");
    expect(o.state).toBe("HELD");
    expect(o.holdReasons).toEqual(["INSUFFICIENT_CASH"]);
  });

  it("holds orders over the per-order limit and enforces the daily limit at execution", () => {
    const db = freshDb();
    const big = buy(db, { notionalCents: 60_000 }); // limit $500
    expect(big.holdReasons).toEqual(["ORDER_LIMIT_EXCEEDED"]);

    const now = new Date();
    const a = buy(db, { notionalCents: 45_000 });
    const b = buy(db, { notionalCents: 45_000 });
    const c = buy(db, { notionalCents: 45_000 }); // together over the $1,000 daily limit
    for (const o of [a, b, c]) approveOrder(db, "alice", o.id, { version: o.version });
    executeOrder(db, "alice", a.id);
    executeOrder(db, "alice", b.id);
    const cash = balance(db, PAPER);
    expect(errorCode(() => executeOrder(db, "alice", c.id))).toBe("POLICY_HOLD");
    expect(stateOf(db, c.id)).toBe("HELD");
    expect(getOrder(db, "alice", c.id).holdReasons).toContain("DAILY_ORDER_LIMIT_EXCEEDED");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("holds symbols outside the supported list", () => {
    const db = freshDb();
    const o = buy(db, { symbol: "TSLA" });
    expect(o.state).toBe("HELD");
    expect(o.holdReasons).toEqual(expect.arrayContaining(["INSTRUMENT_NOT_ALLOWED", "QUOTE_UNAVAILABLE"]));
  });

  it("holds new orders while execution is paused", () => {
    const db = freshDb();
    updateControls(db, "alice", { paused: true });
    const o = buy(db);
    expect(o.state).toBe("HELD");
    expect(o.holdReasons).toEqual(["PAUSED"]);
  });
});

describe("bound approvals", () => {
  it("editing after approval bumps the version and discards the approval", () => {
    const db = freshDb();
    const o = buy(db, { notionalCents: 20_000 });
    approveOrder(db, "alice", o.id, { version: o.version });
    const edited = editOrder(db, "alice", o.id, { notionalCents: 25_000 });
    expect(edited.version).toBe(o.version + 1);
    expect(edited.hasApproval).toBe(false);
    expect(edited.approvedBy).toBeNull();
    expect(edited.state).toBe("AWAITING_APPROVAL");
    expect(errorCode(() => executeOrder(db, "alice", o.id))).toBe("INVALID_STATE");
    expect(errorCode(() => approveOrder(db, "alice", o.id, { version: o.version }))).toBe("STALE_VERSION");
    const audit = listAudit(db, "alice", { actionId: o.id }).find((e) => e.eventType === "order.edited")!;
    expect(audit.detail.approvalInvalidated).toBe(true);
  });

  it("a tampered approval is discarded at execution", () => {
    const db = freshDb();
    const o = buy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    // Simulate a write that bypassed the service (e.g. a bug): the stored hash no longer matches.
    db.prepare("UPDATE orders SET notional_cents = 40000 WHERE id = ?").run(o.id);
    expect(errorCode(() => executeOrder(db, "alice", o.id))).toBe("APPROVAL_INVALID");
    expect(getOrder(db, "alice", o.id).hasApproval).toBe(false);
  });

  it("refuses execution when the simulated price moved beyond the approved bound", () => {
    const db = freshDb();
    const t0 = new Date();
    const o = buy(db, { notionalCents: 20_000 });
    approveOrder(db, "alice", o.id, { version: o.version });
    const bound = o.priceBoundCents!;

    let later: Date | null = null;
    for (let k = 1; k <= 730 && !later; k++) {
      const t = new Date(t0.getTime() + k * DAY_MS);
      if (getQuote("VTI", t)!.priceCents > bound) later = t;
    }
    expect(later).not.toBeNull();

    const cash = balance(db, PAPER);
    vi.setSystemTime(later!);
    expect(errorCode(() => executeOrder(db, "alice", o.id))).toBe("POLICY_HOLD");
    const after = getOrder(db, "alice", o.id);
    expect(after.hasApproval).toBe(false);
    expect(after.version).toBe(o.version + 1); // re-priced: a new bound is a new version
    expect(after.priceBoundCents).toBeGreaterThan(bound);
    expect(balance(db, PAPER)).toBe(cash);
    expect(position(db, PAPER, "VTI")).toBeUndefined();
    const types = listAudit(db, "alice", { actionId: o.id }).map((e) => e.eventType);
    expect(types).toContain("order.repriced");
  });

  it("pause blocks an already-approved order", () => {
    const db = freshDb();
    const cash = balance(db, PAPER);
    const o = buy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    updateControls(db, "alice", { paused: true });
    expect(errorCode(() => executeOrder(db, "alice", o.id))).toBe("POLICY_HOLD");
    expect(stateOf(db, o.id)).toBe("HELD");
    expect(getOrder(db, "alice", o.id).holdReasons).toContain("PAUSED");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("re-evaluation after resolving a hold returns the order to awaiting approval", () => {
    const db = freshDb();
    updateControls(db, "alice", { paused: true });
    const o = buy(db);
    expect(o.state).toBe("HELD");
    updateControls(db, "alice", { paused: false });
    expect(evaluateOrder(db, "alice", o.id).state).toBe("AWAITING_APPROVAL");
  });
});

describe("single execution", () => {
  it("repeated execute returns the original fill and moves nothing", () => {
    const db = freshDb();
    const o = buy(db);
    const first = approveAndExecute(db, "alice", o.id, o.version);
    const cash = balance(db, PAPER);
    const again = executeOrder(db, "alice", o.id);
    expect(again.duplicate).toBe(true);
    expect(again.fill.fillId).toBe(first.fill.fillId);
    expect(balance(db, PAPER)).toBe(cash);
    expect(position(db, PAPER, "VTI")!.q).toBe(first.fill.quantityMicros);
  });

  it("concurrent execute requests produce exactly one fill", async () => {
    const db = freshDb();
    const cash = balance(db, PAPER);
    const o = buy(db);
    approveOrder(db, "alice", o.id, { version: o.version });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => executeOrder(db, "alice", o.id))),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.fill.fillId)).size).toBe(1);
    expect(balance(db, PAPER)).toBe(cash - results[0].fill.grossCents);
  });
});

describe("tradable accounts and ownership", () => {
  it("imported (view-only) and bank accounts cannot trade", () => {
    const db = freshDb();
    for (const accountId of ["acct_alice_brokerage", "acct_alice_checking"]) {
      expect(errorCode(() => createOrder(db, "alice",
        { accountId, symbol: "VTI", side: "buy", notionalCents: 1_000 }, "user"))).toBe("UNSUPPORTED");
      expect(errorCode(() => createOrder(db, "alice",
        { accountId, symbol: "VTI", side: "sell", quantityMicros: 1_000_000 }, "user"))).toBe("UNSUPPORTED");
    }
    const o = buy(db);
    expect(errorCode(() => editOrder(db, "alice", o.id, { accountId: "acct_alice_brokerage" }))).toBe("UNSUPPORTED");
  });

  it("other users' orders and accounts are not found", () => {
    const db = freshDb();
    const o = buy(db);
    expect(errorCode(() => getOrder(db, "bob", o.id))).toBe("NOT_FOUND");
    expect(errorCode(() => editOrder(db, "bob", o.id, { notionalCents: 1_000 }))).toBe("NOT_FOUND");
    expect(errorCode(() => evaluateOrder(db, "bob", o.id))).toBe("NOT_FOUND");
    expect(errorCode(() => approveOrder(db, "bob", o.id, { version: o.version }))).toBe("NOT_FOUND");
    approveOrder(db, "alice", o.id, { version: o.version });
    expect(errorCode(() => executeOrder(db, "bob", o.id))).toBe("NOT_FOUND");
    expect(stateOf(db, o.id)).toBe("APPROVED");
    expect(listOrders(db, "bob")).toHaveLength(0);
    expect(errorCode(() => createOrder(db, "bob",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 1_000 }, "user"))).toBe("NOT_FOUND");
  });
});
