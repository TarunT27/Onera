// Mandates: bounded autonomous paper trading. Only a valid, unexpired, unrevoked
// mandate for the same agent lets an agent's order execute without user approval.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAudit } from "@/lib/audit";
import { updateControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import {
  approveOrder,
  createMandate,
  createOrder,
  editOrder,
  executeOrder,
  getMandate,
  getOrder,
  listMandates,
  proposeMandateOrder,
  revokeMandate,
} from "@/lib/markets";
import { executeMandateOrder } from "@/lib/markets/broker";
import { createOrderInternal } from "@/lib/markets/orders";
import { balance, errorCode, freshDb } from "./helpers";

const PAPER = "acct_alice_paper";
const AGENT = "dca-bot";
const HOUR_MS = 3_600_000;

// Write paths read the real clock; freeze it so quotes (per-minute) and day windows are deterministic.
const T0 = new Date("2026-10-07T15:30:20.000Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
});
afterEach(() => {
  vi.useRealTimers();
});

function grant(db: DB, now: Date, overrides: Record<string, unknown> = {}) {
  return createMandate(db, "alice", {
    agentId: AGENT, accountId: PAPER, symbols: ["VTI", "VOO"],
    maxOrderCents: 10_000, maxDailyCents: 25_000,
    expiresAt: new Date(now.getTime() + 7 * 24 * HOUR_MS).toISOString(),
    ...overrides,
  });
}

describe("mandate happy path", () => {
  it("auto-authorizes and executes an agent order that fits the mandate", () => {
    const db = freshDb();
    const now = new Date();
    const cash = balance(db, PAPER);
    const m = grant(db, now);
    expect(m.status).toBe("active");
    expect(m.paper).toBe(true);

    const r = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 });
    expect(r.executed).toBe(true);
    expect(r.refusal).toBeNull();
    expect(r.order.state).toBe("EXECUTED");
    expect(r.order.createdBy).toBe(`agent:${AGENT}`);
    expect(r.order.mandateId).toBe(m.id);
    expect(r.order.approvedBy).toBe(`mandate:${m.id}`);
    expect(r.fill!.executedBy).toBe(`agent:${AGENT}`);
    expect(r.fill!.grossCents).toBeLessThanOrEqual(5_000);
    expect(balance(db, PAPER)).toBe(cash - r.fill!.grossCents);

    const audit = listAudit(db, "alice", { actionId: r.order.id });
    const authorized = audit.find((e) => e.eventType === "order.mandate_authorized")!;
    expect(authorized.detail.approvedBy).toBe(`mandate:${m.id}`);
    expect(audit.find((e) => e.eventType === "order.executed")!.actor).toBe(`agent:${AGENT}`);

    const after = getMandate(db, "alice", m.id, now);
    expect(after.usedTodayCents).toBe(r.fill!.grossCents);
    expect(after.remainingTodayCents).toBe(25_000 - r.fill!.grossCents);
  });
});

describe("mandate limits hold the order", () => {
  const heldFor = (r: ReturnType<typeof proposeMandateOrder>) => {
    expect(r.executed).toBe(false);
    expect(r.fill).toBeNull();
    expect(r.order.state).toBe("HELD");
    expect(r.order.hasApproval).toBe(false);
    return r.order.holdReasons;
  };

  it("expired mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now, { expiresAt: new Date(now.getTime() + HOUR_MS).toISOString() });
    const later = new Date(now.getTime() + 2 * HOUR_MS);
    expect(getMandate(db, "alice", m.id, later).status).toBe("expired");
    const cash = balance(db, PAPER);
    vi.setSystemTime(later);
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 })))
      .toContain("MANDATE_INVALID");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("revoked mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    const revoked = revokeMandate(db, "alice", m.id);
    expect(revoked.status).toBe("revoked");
    expect(revokeMandate(db, "alice", m.id).revokedAt).toBe(revoked.revokedAt); // idempotent
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 })))
      .toContain("MANDATE_INVALID");
  });

  it("symbol not covered", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "AAPL", notionalCents: 5_000 })))
      .toEqual(["MANDATE_INVALID"]);
  });

  it("over the per-order cap", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 15_000 })))
      .toEqual(["MANDATE_INVALID"]);
  });

  it("over the remaining daily budget", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 10_000 }).executed).toBe(true);
    expect(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VOO", notionalCents: 10_000 }).executed).toBe(true);
    const third = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 10_000 });
    expect(heldFor(third)).toEqual(["MANDATE_INVALID"]);
    const check = third.order.policy!.checks.find((c) => c.id === "mandate_valid")!;
    expect(check.detail).toMatch(/daily budget/);
  });

  it("a different agent cannot use the mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, "other-bot", { symbol: "VTI", notionalCents: 5_000 })))
      .toEqual(["MANDATE_INVALID"]);
  });

  it("the global pause still applies to mandate trades", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    updateControls(db, "alice", { paused: true });
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 })))
      .toEqual(["PAUSED"]);
  });

  it("user trading limits still apply under a generous mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now, { maxOrderCents: 90_000, maxDailyCents: 90_000 });
    expect(heldFor(proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 60_000 })))
      .toEqual(["ORDER_LIMIT_EXCEEDED"]);
  });

  it("revoking after authorization blocks execution", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    const order = createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, `agent:${AGENT}`, m.id);
    expect(order.state).toBe("APPROVED");
    revokeMandate(db, "alice", m.id);
    const cash = balance(db, PAPER);
    expect(errorCode(() => executeMandateOrder(db, "alice", order.id, m.id, AGENT))).toBe("POLICY_HOLD");
    expect(getOrder(db, "alice", order.id).holdReasons).toContain("MANDATE_INVALID");
    expect(balance(db, PAPER)).toBe(cash);
  });
});

describe("agents without a mandate", () => {
  it("never auto-execute: the order waits for the user's exact approval", () => {
    const db = freshDb();
    const m = grant(db, new Date());
    const cash = balance(db, PAPER);
    const o = createOrder(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, `agent:${AGENT}`);
    expect(o.state).toBe("AWAITING_APPROVAL");
    expect(o.hasApproval).toBe(false);
    expect(o.mandateId).toBeNull();
    expect(errorCode(() => executeMandateOrder(db, "alice", o.id, m.id, AGENT))).toBe("INVALID_STATE");
    expect(errorCode(() => executeOrder(db, "alice", o.id))).toBe("INVALID_STATE");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("cannot execute an order the user approved", () => {
    const db = freshDb();
    const m = grant(db, new Date());
    const o = createOrder(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, `agent:${AGENT}`);
    approveOrder(db, "alice", o.id, { version: o.version });
    expect(errorCode(() => executeMandateOrder(db, "alice", o.id, m.id, AGENT))).toBe("INVALID_STATE");
    expect(executeOrder(db, "alice", o.id).order.state).toBe("EXECUTED"); // the user can
  });

  it("only agent orders may carry a mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(errorCode(() => createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "user", m.id))).toBe("BAD_REQUEST");
    expect(errorCode(() => createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "assistant", m.id))).toBe("BAD_REQUEST");
  });

  it("a user edit detaches the mandate so it needs explicit approval", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    const held = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "AAPL", notionalCents: 5_000 }).order;
    expect(held.holdReasons).toEqual(["MANDATE_INVALID"]);
    const edited = editOrder(db, "alice", held.id, { notionalCents: 4_000 });
    expect(edited.mandateId).toBeNull();
    expect(edited.state).toBe("AWAITING_APPROVAL");
    expect(edited.hasApproval).toBe(false);
  });
});

describe("mandate creation and ownership", () => {
  it("validates account, symbols, side and expiry", () => {
    const db = freshDb();
    const now = new Date();
    expect(errorCode(() => grant(db, now, { accountId: "acct_alice_brokerage" }))).toBe("UNSUPPORTED");
    expect(errorCode(() => grant(db, now, { accountId: "acct_bob_paper" }))).toBe("NOT_FOUND");
    expect(errorCode(() => grant(db, now, { symbols: ["VTI", "TSLA"] }))).toBe("BAD_REQUEST");
    expect(errorCode(() => grant(db, now, { expiresAt: new Date(now.getTime() - HOUR_MS).toISOString() }))).toBe("BAD_REQUEST");
    expect(errorCode(() => grant(db, now, { expiresAt: new Date(now.getTime() + 91 * 24 * HOUR_MS).toISOString() }))).toBe("BAD_REQUEST");
    expect(() => grant(db, now, { side: "sell" })).toThrow();
    expect(() => grant(db, now, { userId: "bob" })).toThrow();
    expect(listMandates(db, "alice", now)).toHaveLength(0);
  });

  it("other users cannot see, use or revoke a mandate", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    expect(listMandates(db, "bob", now)).toHaveLength(0);
    expect(errorCode(() => getMandate(db, "bob", m.id, now))).toBe("NOT_FOUND");
    expect(errorCode(() => revokeMandate(db, "bob", m.id))).toBe("NOT_FOUND");
    expect(errorCode(() => proposeMandateOrder(db, "bob", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 })))
      .toBe("NOT_FOUND");
    expect(getMandate(db, "alice", m.id, now).status).toBe("active");
  });

  it("no mandates are seeded", () => {
    const db = freshDb();
    expect(listMandates(db, "alice")).toHaveLength(0);
    expect(listMandates(db, "bob")).toHaveLength(0);
  });
});
