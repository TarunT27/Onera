// Regression tests from the markets money/control-path review. Each one pins an
// invariant from AGENTS.md that the existing suites did not exercise directly.
import { describe, expect, it } from "vitest";
import { updateControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import {
  approveOrder,
  createMandate,
  createOrder,
  evaluateOrder,
  executeOrder,
  getOrder,
  listOrders,
  proposeMandateOrder,
  revokeMandate,
} from "@/lib/markets";
import { createOrderInternal } from "@/lib/markets/orders";
import { balance, errorCode, freshDb } from "./helpers";

const PAPER = "acct_alice_paper";
const AGENT = "dca-bot";
const HOUR_MS = 3_600_000;

function grant(db: DB, now: Date, overrides: Record<string, unknown> = {}) {
  return createMandate(db, "alice", {
    agentId: AGENT, accountId: PAPER, symbols: ["VTI"],
    maxOrderCents: 10_000, maxDailyCents: 15_000,
    expiresAt: new Date(now.getTime() + 24 * HOUR_MS).toISOString(),
    ...overrides,
  }, now);
}

const storedHash = (db: DB, id: string) =>
  (db.prepare("SELECT approval_hash AS h FROM orders WHERE id = ?").get(id) as { h: string | null }).h;

describe("approval hash stays on the server", () => {
  it("never appears in order, execute or mandate results", () => {
    const db = freshDb();
    const now = new Date();
    const o = createOrder(db, "alice", { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "user", now);
    const approved = approveOrder(db, "alice", o.id, { version: o.version }, now);
    const hash = storedHash(db, o.id)!;
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const executed = executeOrder(db, "alice", o.id, { now });

    const m = grant(db, now);
    const viaMandate = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 }, now);
    const mandateHash = storedHash(db, viaMandate.order.id)!;

    const payload = JSON.stringify([approved, executed, viaMandate, listOrders(db, "alice"), getOrder(db, "alice", o.id)]);
    expect(payload).not.toContain(hash);
    expect(payload).not.toContain(mandateHash);
    expect(payload).not.toMatch(/approval_?hash/i);
  });
});

describe("mandate execution is re-checked at fill time", () => {
  it("two authorized orders cannot together exceed the mandate's daily budget", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now); // $100 per order, $150 per day
    const mk = () => createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 10_000 }, `agent:${AGENT}`, m.id, now);
    const a = mk();
    const b = mk();
    expect(a.state).toBe("APPROVED");
    expect(b.state).toBe("APPROVED"); // nothing executed yet, so both fit at authorization

    executeOrder(db, "alice", a.id, { actor: `agent:${AGENT}`, now });
    const cash = balance(db, PAPER);
    expect(errorCode(() => executeOrder(db, "alice", b.id, { actor: `agent:${AGENT}`, now }))).toBe("POLICY_HOLD");
    expect(getOrder(db, "alice", b.id).holdReasons).toContain("MANDATE_INVALID");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("an agent cannot execute another agent's mandate-authorized order", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    const o = createOrderInternal(db, "alice",
      { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, `agent:${AGENT}`, m.id, now);
    expect(o.state).toBe("APPROVED");
    const cash = balance(db, PAPER);
    expect(errorCode(() => executeOrder(db, "alice", o.id, { actor: "agent:other-bot", now }))).toBe("INVALID_STATE");
    expect(getOrder(db, "alice", o.id).state).toBe("APPROVED");
    expect(balance(db, PAPER)).toBe(cash);
  });

  it("after revocation the user cannot approve the agent's leftover order without editing it", () => {
    const db = freshDb();
    const now = new Date();
    const m = grant(db, now);
    updateControls(db, "alice", { paused: true });
    const held = proposeMandateOrder(db, "alice", m.id, AGENT, { symbol: "VTI", notionalCents: 5_000 }, now).order;
    expect(held.holdReasons).toEqual(["PAUSED"]);
    updateControls(db, "alice", { paused: false });
    revokeMandate(db, "alice", m.id, now);
    const reEvaluated = evaluateOrder(db, "alice", held.id, now);
    expect(reEvaluated.state).toBe("HELD");
    expect(reEvaluated.holdReasons).toEqual(["MANDATE_INVALID"]);
  });
});

describe("pause and versions", () => {
  it("approval is refused while paused and the order is held", () => {
    const db = freshDb();
    const now = new Date();
    const o = createOrder(db, "alice", { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "user", now);
    updateControls(db, "alice", { paused: true });
    expect(errorCode(() => approveOrder(db, "alice", o.id, { version: o.version }, now))).toBe("POLICY_HOLD");
    const after = getOrder(db, "alice", o.id);
    expect(after.state).toBe("HELD");
    expect(after.hasApproval).toBe(false);
    expect(after.holdReasons).toEqual(["PAUSED"]);
  });

  it("re-evaluating at the same simulated price keeps the version, so a reviewed version stays approvable", () => {
    const db = freshDb();
    const now = new Date();
    const o = createOrder(db, "alice", { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "user", now);
    const again = evaluateOrder(db, "alice", o.id, now);
    expect(again.version).toBe(o.version);
    expect(again.priceBoundCents).toBe(o.priceBoundCents);
    expect(approveOrder(db, "alice", o.id, { version: o.version }, now).state).toBe("APPROVED");
  });

  it("an approved order cannot be re-evaluated, and an executed one cannot be approved again", () => {
    const db = freshDb();
    const now = new Date();
    const o = createOrder(db, "alice", { accountId: PAPER, symbol: "VTI", side: "buy", notionalCents: 5_000 }, "user", now);
    approveOrder(db, "alice", o.id, { version: o.version }, now);
    expect(errorCode(() => evaluateOrder(db, "alice", o.id, now))).toBe("INVALID_STATE");
    executeOrder(db, "alice", o.id, { now });
    expect(errorCode(() => approveOrder(db, "alice", o.id, { version: o.version }, now))).toBe("INVALID_STATE");
  });
});
