// Agents: monitors produce evidence-linked insights; the sentinel is advisory; insights don't re-alert; users are isolated.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(),
  syncConnection: vi.fn(),
  getPortfolio: vi.fn(),
  getQuote: vi.fn(),
}));
vi.mock("@/lib/providers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/providers")>()),
  listConnections: mocks.listConnections,
  syncConnection: mocks.syncConnection,
}));
vi.mock("@/lib/markets", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/markets")>()),
  getPortfolio: mocks.getPortfolio,
  getQuote: mocks.getQuote,
}));

import { createTransfer } from "@/lib/actions/service";
import {
  enqueueJob,
  getInsight,
  lastRunByAgent,
  listInsights,
  listJobs,
  runPendingJobs,
  ScopeViolationError,
  setInsightStatus,
  type Insight,
  type JobType,
} from "@/lib/agents";
import { upsertInsight } from "@/lib/agents/insights";
import { listAudit } from "@/lib/audit";
import type { DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { DEMO_FX_RATES, convertToUsdCents } from "@/lib/finance/fx";
import type { Portfolio, Quote } from "@/lib/markets";
import type { UserId } from "@/lib/types";
import { errorCode, freshDb } from "./helpers";

const DAY_MS = 86_400_000;
let seq = 0;
const soon = (offsetMs = 0) => new Date(Date.now() + 1000 + offsetMs);

/** Enqueue one job and run the queue. */
function run(db: DB, userId: UserId, type: JobType, payload: Record<string, unknown> = {}, now = soon()) {
  enqueueJob(db, { userId, type, dedupeKey: `${type}:${userId}:test:${++seq}`, payload });
  return runPendingJobs(db, { now });
}

const byType = (db: DB, userId: UserId, type: string): Insight[] =>
  listInsights(db, userId, { status: "all" }).filter((i) => i.type === type);

function actionRow(db: DB, id: string) {
  return db.prepare("SELECT * FROM actions WHERE id = ?").get(id);
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.listConnections.mockReturnValue([]);
  mocks.getPortfolio.mockImplementation((_db: DB, userId: UserId, now: Date = new Date()): Portfolio => ({
    userId, accounts: [], paperValueCents: 0, disclaimer: "Simulated prices", investedValueCents: 0, asOf: now.toISOString(), quotesSource: "simulated",
  }));
  mocks.getQuote.mockReturnValue(null);
});

describe("subscription monitor", () => {
  it("persists alice's StreamFlix increase with the evidence transactions", () => {
    const db = freshDb();
    run(db, "alice", "subscription_review");
    const [ins] = byType(db, "alice", "subscription_price_increase");
    expect(ins).toBeDefined();
    expect(ins.agentId).toBe("subscription_monitor");
    expect(ins.status).toBe("new");
    expect(ins.deterministic).toBe(true);
    expect(ins.title).toContain("$15.49 → $22.99");
    expect(ins.evidence).toMatchObject({ merchant: "StreamFlix", previousAmountCents: 1_549, currentAmountCents: 2_299 });

    const ids = ins.evidence.transactionIds!;
    expect(ids).toHaveLength(4);
    const rows = db.prepare(`SELECT user_id, merchant FROM transactions WHERE id IN (${ids.map(() => "?").join(",")})`)
      .all(...ids) as { user_id: string; merchant: string }[];
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.user_id === "alice" && r.merchant === "StreamFlix")).toBe(true);

    run(db, "bob", "subscription_review");
    expect(byType(db, "bob", "subscription_price_increase")).toHaveLength(0);
  });
});

describe("spending monitor", () => {
  it("flags a real category spike (FX-converted) and ignores internal transfers", () => {
    const db = freshDb();
    const now = soon();
    const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY_MS).toISOString();

    // A euro account: €300 of dining, converted at the demo rate.
    db.prepare(`INSERT INTO accounts (id, user_id, institution, name, type, currency, mask, balance_cents, available_cents,
        capabilities, updated_at) VALUES ('acct_alice_eur', 'alice', 'Test Bank (simulated)', 'Euro', 'checking', 'EUR',
        '0042', 100000, 100000, '["view"]', ?)`).run(now.toISOString());
    const insTx = db.prepare(`INSERT INTO transactions (id, account_id, user_id, posted_at, description, merchant, category,
        amount_cents, currency, transfer_group_id) VALUES (?, ?, 'alice', ?, ?, ?, ?, ?, ?, ?)`);
    insTx.run("tx_t_eur_dinner", "acct_alice_eur", at(2), "Le Bistro", "Le Bistro", "dining", -30_000, "EUR", null);
    // Huge internal transfer legs in the current window: would be a massive "transfer" spike if counted.
    for (const [i, d] of [3, 4, 5].entries()) {
      insTx.run(`tx_t_move_out_${i}`, "acct_alice_checking", at(d), "Transfer to savings", null, "transfer", -400_000, "USD", `tg_t_${i}`);
      insTx.run(`tx_t_move_in_${i}`, "acct_alice_savings", at(d), "Transfer from checking", null, "transfer", 400_000, "USD", `tg_t_${i}`);
    }

    run(db, "alice", "spending_review", {}, now);
    const spikes = byType(db, "alice", "spending_spike");
    const all = listInsights(db, "alice", { status: "all" });

    // No insight is about, or cites, an internal transfer leg.
    expect(spikes.some((s) => s.evidence.category === "transfer")).toBe(false);
    expect(all.flatMap((i) => i.evidence.transactionIds ?? []).some((id) => id.startsWith("tx_t_move"))).toBe(false);

    const dining = spikes.find((s) => s.evidence.category === "dining");
    expect(dining).toBeDefined();
    expect(dining!.evidence.transactionIds).toContain("tx_t_eur_dinner");
    // currentCents is the USD sum of exactly the cited transactions.
    const cited = db.prepare(`SELECT amount_cents, currency FROM transactions WHERE user_id = 'alice' AND id IN
        (${dining!.evidence.transactionIds!.map(() => "?").join(",")})`).all(...dining!.evidence.transactionIds!) as
      { amount_cents: number; currency: "USD" | "EUR" }[];
    const expected = cited.reduce((s, t) => s - convertToUsdCents(t.amount_cents, DEMO_FX_RATES[t.currency]), 0);
    expect(dining!.evidence.currentCents).toBe(expected);

    // The €300 dinner is also an unusually large dining charge, recorded in USD.
    const large = byType(db, "alice", "large_transaction");
    expect(large).toHaveLength(1);
    expect(large[0].evidence).toMatchObject({ transactionIds: ["tx_t_eur_dinner"], category: "dining", amountCents: 32_550 });
  });

  it("finds no spikes for bob's steady seeded spending", () => {
    const db = freshDb();
    run(db, "bob", "spending_review");
    expect(listInsights(db, "bob")).toHaveLength(0);
  });
});

describe("security sentinel", () => {
  it("flags the changed-recipient landlord proposal as critical and leaves the action untouched", () => {
    const db = freshDb();
    const action = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents: 185_000 }, "user");
    expect(action.state).toBe("HELD");
    const before = actionRow(db, action.id);

    const report = runPendingJobs(db, { now: soon() });
    expect(report).toMatchObject({ processed: 1, succeeded: 1 });

    // Byte-for-byte identical: state, version, hold reasons, policy, approval fields, updated_at.
    expect(actionRow(db, action.id)).toEqual(before);

    const [ins] = byType(db, "alice", "transfer_security_review");
    expect(ins.severity).toBe("critical");
    expect(ins.agentId).toBe("security_sentinel");
    expect(ins.evidence.actionIds?.[0]).toBe(action.id);
    expect(ins.evidence.signals).toContain("RECIPIENT_CHANGED");
    expect(ins.evidence).toMatchObject({ recipientId: "rcp_alice_landlord", recipientVersion: 2, verifiedVersion: 1 });
    expect(ins.body).toMatch(/Advisory only/);

    // The action's own audit trail shows the agent's review.
    const trail = listAudit(db, "alice", { actionId: action.id });
    expect(trail.some((e) => e.actor === "agent:security_sentinel" && e.eventType === "agent.run_succeeded")).toBe(true);
    expect(trail.some((e) => e.actor.startsWith("agent:") && /approved|executed|held|verified/.test(e.eventType))).toBe(false);
  });

  it("warns about an assistant-drafted transfer to an external recipient without approving it", () => {
    const db = freshDb();
    const action = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_sam", amountCents: 2_500 }, "assistant");
    expect(action.state).toBe("AWAITING_APPROVAL");
    const before = actionRow(db, action.id);
    runPendingJobs(db, { now: soon() });
    expect(actionRow(db, action.id)).toEqual(before);
    const [ins] = byType(db, "alice", "transfer_security_review");
    expect(ins.severity).toBe("warning");
    expect(ins.evidence.signals).toEqual(["FIRST_TIME_RECIPIENT", "ASSISTANT_PROPOSED_EXTERNAL"]);
  });

  it("raises nothing for a routine transfer to a verified own account", () => {
    const db = freshDb();
    createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_savings", amountCents: 50_000 }, "user");
    expect(runPendingJobs(db, { now: soon() }).succeeded).toBe(1);
    expect(byType(db, "alice", "transfer_security_review")).toHaveLength(0);
  });
});

describe("insight suppression", () => {
  it("does not re-alert on unchanged evidence; re-alerts when evidence changes", () => {
    const db = freshDb();
    const t1 = soon();
    run(db, "alice", "subscription_review", {}, t1);
    const [first] = byType(db, "alice", "subscription_price_increase");
    setInsightStatus(db, "alice", first.id, "seen");

    // Same evidence: the seen insight stays seen and keeps its timestamp.
    const t2 = soon(60_000);
    run(db, "alice", "subscription_review", {}, t2);
    const unchanged = getInsight(db, "alice", first.id);
    expect(unchanged.status).toBe("seen");
    expect(unchanged.updatedAt).toBe(first.updatedAt);
    expect(byType(db, "alice", "subscription_price_increase")).toHaveLength(1);

    // The latest charge changes: same finding, new evidence → updated and back to "new".
    const latest = first.evidence.transactionIds!.at(-1)!;
    db.prepare("UPDATE transactions SET amount_cents = -2499 WHERE id = ? AND user_id = 'alice'").run(latest);
    const t3 = soon(120_000);
    run(db, "alice", "subscription_review", {}, t3);
    const changed = getInsight(db, "alice", first.id);
    expect(changed.status).toBe("new");
    expect(changed.updatedAt).toBe(t3.toISOString());
    expect(changed.title).toContain("$24.99");
    expect(byType(db, "alice", "subscription_price_increase")).toHaveLength(1);
  });

  it("upsertInsight: created → unchanged → updated (a dismissed insight returns as new)", () => {
    const db = freshDb();
    const base = {
      userId: "alice" as const, agentId: "spending_monitor", type: "t", severity: "info" as const,
      title: "x", body: "y", dedupeKey: "k1", evidence: { transactionIds: ["tx_alice_0001"], n: 1 },
    };
    const a = upsertInsight(db, base, new Date("2026-01-01T00:00:00Z"));
    expect(a.outcome).toBe("created");
    setInsightStatus(db, "alice", a.insight.id, "dismissed");
    // Key order doesn't matter for the evidence hash.
    const b = upsertInsight(db, { ...base, title: "new title", evidence: { n: 1, transactionIds: ["tx_alice_0001"] } },
      new Date("2026-01-02T00:00:00Z"));
    expect(b.outcome).toBe("unchanged");
    expect(b.insight).toMatchObject({ status: "dismissed", title: "x", updatedAt: "2026-01-01T00:00:00.000Z" });
    const c = upsertInsight(db, { ...base, evidence: { transactionIds: ["tx_alice_0001", "tx_alice_0002"], n: 2 } },
      new Date("2026-01-03T00:00:00Z"));
    expect(c.outcome).toBe("updated");
    expect(c.insight).toMatchObject({ id: a.insight.id, status: "new", updatedAt: "2026-01-03T00:00:00.000Z" });
  });
});

describe("cross-user isolation", () => {
  it("a job for alice can never read or cite bob's data", () => {
    const db = freshDb();
    const bobAction = createTransfer(db, "bob",
      { sourceAccountId: "acct_bob_checking", recipientId: "rcp_bob_savings", amountCents: 10_000 }, "user");
    runPendingJobs(db, { now: soon() }); // bob's own security review

    // Alice's job points at bob's action: it is "not found" and dead-lettered.
    enqueueJob(db, { userId: "alice", type: "security_review", dedupeKey: "security_review:alice:probe",
      payload: { actionId: bobAction.id } });
    const report = runPendingJobs(db, { now: soon() });
    expect(report).toMatchObject({ processed: 1, dead: 1 });
    expect(listJobs(db, "alice", { status: "dead" })[0].lastError).toBe(`Action ${bobAction.id} not found`);

    run(db, "alice", "subscription_review");
    run(db, "alice", "spending_review");
    const aliceInsights = listInsights(db, "alice", { status: "all" });
    expect(aliceInsights.length).toBeGreaterThan(0);
    const citedTx = aliceInsights.flatMap((i) => i.evidence.transactionIds ?? []);
    const owners = db.prepare(`SELECT DISTINCT user_id FROM transactions WHERE id IN (${citedTx.map(() => "?").join(",")})`)
      .all(...citedTx) as { user_id: string }[];
    expect(owners).toEqual([{ user_id: "alice" }]);
    expect(aliceInsights.flatMap((i) => i.evidence.actionIds ?? [])).not.toContain(bobAction.id);

    // Bob sees none of alice's insights, runs or jobs, and can't touch them.
    expect(listInsights(db, "bob", { status: "all" })).toHaveLength(0);
    expect(errorCode(() => setInsightStatus(db, "bob", aliceInsights[0].id, "dismissed"))).toBe("NOT_FOUND");
    expect(errorCode(() => getInsight(db, "bob", aliceInsights[0].id))).toBe("NOT_FOUND");
    expect(listJobs(db, "bob", { limit: 200 }).every((j) => j.userId === "bob")).toBe(true);
    expect(lastRunByAgent(db, "bob").subscription_monitor).toBeNull();
  });

  it("an insight cannot cite another user's records", () => {
    const db = freshDb();
    expect(() => upsertInsight(db, {
      userId: "alice", agentId: "spending_monitor", type: "t", severity: "info", title: "x", body: "y",
      dedupeKey: "leak", evidence: { transactionIds: ["tx_bob_0001"] },
    })).toThrow(ScopeViolationError);
    expect(listInsights(db, "alice", { status: "all" })).toHaveLength(0);
  });
});

describe("connection monitor", () => {
  const summary = (over: Partial<Record<string, unknown>> = {}) => ({
    connectionId: "conn_1", status: "healthy", added: 2, modified: 0, removed: 0,
    newTransactionIds: ["tx_new_1", "tx_new_2"], syncedAt: "2026-10-10T12:00:00.000Z", ...over,
  });

  it("syncs through providers and queues follow-up reviews for the same user", () => {
    const db = freshDb();
    mocks.syncConnection.mockReturnValue(summary());
    const now = soon();
    const report = run(db, "alice", "sync_connection", { connectionId: "conn_1" }, now);
    expect(mocks.syncConnection).toHaveBeenCalledWith(db, "alice", "conn_1", now);
    // The sync plus the two reviews it queued, all in one pass.
    expect(report).toMatchObject({ processed: 3, succeeded: 3 });
    const reviews = listJobs(db, "alice").filter((j) => j.type !== "sync_connection");
    expect(reviews.map((j) => j.type).sort()).toEqual(["spending_review", "subscription_review"]);
    expect(reviews.every((j) => j.userId === "alice" && j.payload.trigger === "sync")).toBe(true);
    expect(reviews[0].dedupeKey).toMatch(/^(spending|subscription)_review:alice:after_sync:conn_1:/);
    expect(byType(db, "alice", "subscription_price_increase")).toHaveLength(1);

    // Same sync result again: the follow-ups are deduplicated.
    run(db, "alice", "sync_connection", { connectionId: "conn_1" });
    expect(listJobs(db, "alice").filter((j) => j.type !== "sync_connection")).toHaveLength(2);
  });

  it("queues nothing when a sync brings no new data", () => {
    const db = freshDb();
    mocks.syncConnection.mockReturnValue(summary({ added: 0, newTransactionIds: [] }));
    expect(run(db, "alice", "sync_connection", { connectionId: "conn_1" })).toMatchObject({ processed: 1, succeeded: 1 });
    expect(listJobs(db, "alice")).toHaveLength(1);
  });

  it("surfaces an unhealthy connection as a connection-health insight", () => {
    const db = freshDb();
    mocks.syncConnection.mockReturnValue(summary({ status: "login_required", added: 0, newTransactionIds: [] }));
    run(db, "alice", "sync_connection", { connectionId: "conn_1" });
    const [ins] = byType(db, "alice", "connection_health");
    expect(ins.title).toMatch(/sign in again/);
    expect(ins.evidence).toMatchObject({ connectionIds: ["conn_1"], status: "login_required" });
  });

  it("dead-letters a connection that isn't the user's, without an insight", () => {
    const db = freshDb();
    mocks.syncConnection.mockImplementation(() => { throw new ServiceError("NOT_FOUND", "Connection not found", 404); });
    expect(run(db, "alice", "sync_connection", { connectionId: "conn_bob" })).toMatchObject({ dead: 1 });
    expect(listInsights(db, "alice", { status: "all" })).toHaveLength(0);
  });
});

describe("portfolio monitor", () => {
  it("flags concentration and large daily moves from the (mocked) portfolio", () => {
    const db = freshDb();
    const now = soon();
    const pos = (symbol: string, weightPct: number, marketValueCents: number) => ({
      accountId: "acct_alice_brokerage", symbol, quantityMicros: 1_000_000, costBasisCents: marketValueCents,
      priceCents: marketValueCents, averageCostCents: marketValueCents, marketValueCents, unrealizedPnlCents: 0, weightPct,
    });
    mocks.getPortfolio.mockImplementation((_db: DB, userId: UserId): Portfolio => ({
      userId, paperValueCents: 0, disclaimer: "Simulated prices", investedValueCents: 1_000_000, asOf: now.toISOString(), quotesSource: "simulated",
      accounts: [{
        accountId: "acct_alice_brokerage", name: "Individual Brokerage", institution: "Northwind", mask: "3091", label: "View-only demo import", tradable: false, venue: null, paper: false,
        cashCents: 0, buyingPowerCents: 0, positionsValueCents: 1_000_000, totalCents: 1_000_000,
        positions: [pos("VTI", 60, 600_000), pos("AAPL", 30, 300_000), pos("BND", 10, 100_000)],
      }],
    }));
    mocks.getQuote.mockImplementation((symbol: string): Quote | null => ({
      symbol, priceCents: 10_000, previousCloseCents: symbol === "AAPL" ? 10_776 : 9_900,
      changePct: symbol === "AAPL" ? -7.2 : 1.0, asOf: now.toISOString(), source: "simulated", delayedMinutes: 15,
    }));

    run(db, "alice", "portfolio_review", {}, now);
    expect(mocks.getPortfolio).toHaveBeenCalledWith(db, "alice", now);

    const conc = byType(db, "alice", "portfolio_concentration");
    expect(conc.map((i) => [i.evidence.symbols?.[0], i.severity]).sort()).toEqual([["AAPL", "warning"], ["VTI", "critical"]]);
    expect(conc.every((i) => i.evidence.accountIds?.[0] === "acct_alice_brokerage")).toBe(true);
    const moves = byType(db, "alice", "portfolio_daily_move");
    expect(moves).toHaveLength(1);
    expect(moves[0].evidence).toMatchObject({ symbols: ["AAPL"], direction: "down", changePctRounded: -7 });

    // Re-running on the same data adds nothing and doesn't re-alert.
    const before = listInsights(db, "alice", { status: "all" }).map((i) => [i.id, i.updatedAt]);
    run(db, "alice", "portfolio_review", {}, soon(60_000));
    expect(listInsights(db, "alice", { status: "all" }).map((i) => [i.id, i.updatedAt])).toEqual(before);
  });

  it("is a no-op for an empty portfolio", () => {
    const db = freshDb();
    expect(run(db, "bob", "portfolio_review")).toMatchObject({ succeeded: 1 });
    expect(listInsights(db, "bob")).toHaveLength(0);
  });
});
