// Read-only assistant tools for connections, investments, quotes and monitoring
// insights: scoped to the session user, integer cents, simulated data labeled.
import { describe, expect, it } from "vitest";
import { getInsight, setInsightStatus } from "@/lib/agents";
import { upsertInsight } from "@/lib/agents/insights";
import type { DB } from "@/lib/db";
import { runTool, type ToolContext } from "@/lib/ai/tools";
import type { UserId } from "@/lib/types";
import { freshDb } from "./helpers";

function ctxFor(db: DB, userId: UserId): ToolContext {
  return { db, userId, proposedActionIds: [] };
}

function call(db: DB, userId: UserId, name: string, input: unknown = {}) {
  const out = runTool(ctxFor(db, userId), name, input);
  return { ...out, body: JSON.parse(out.content) };
}

/** Every numeric field whose key ends in "Cents" must be an integer. */
function centsFields(v: unknown, path = "$"): { path: string; value: unknown }[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => centsFields(x, `${path}[${i}]`));
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => [
      ...(k.endsWith("Cents") ? [{ path: `${path}.${k}`, value: x }] : []),
      ...centsFields(x, `${path}.${k}`),
    ]);
  }
  return [];
}

function expectIntegerCents(body: unknown) {
  const fields = centsFields(body);
  expect(fields.length).toBeGreaterThan(0);
  for (const f of fields) expect(Number.isInteger(f.value), f.path).toBe(true);
}

function firstTransactionId(db: DB, userId: UserId): string {
  return (db.prepare("SELECT id FROM transactions WHERE user_id = ? ORDER BY id LIMIT 1").get(userId) as { id: string }).id;
}

function seedInsight(db: DB, userId: UserId, key: string) {
  const tx = firstTransactionId(db, userId);
  return upsertInsight(db, {
    userId, agentId: "spending_monitor", type: "test_finding", severity: "warning",
    title: `Finding for ${userId}`, body: "Synthetic test finding.", dedupeKey: key,
    evidence: { transactionIds: [tx] },
  }).insight;
}

function countRows(db: DB, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

describe("get_connections", () => {
  it("lists only the session user's simulated connections, with masks and no secrets", () => {
    const db = freshDb();
    const alice = call(db, "alice", "get_connections");
    const bob = call(db, "bob", "get_connections");
    expect(alice.isError).toBe(false);
    expect(bob.isError).toBe(false);

    expect(bob.body.connections.map((c: { id: string }) => c.id)).toEqual(["conn_bob_boa"]);
    expect(bob.content).not.toMatch(/alice/i);
    expect(alice.body.connections.length).toBeGreaterThan(0);
    expect(alice.content).not.toMatch(/bob/i);

    expect(alice.body.simulated).toBe(true);
    expect(alice.body.notice).toMatch(/simulated/i);
    for (const c of alice.body.connections) {
      expect(c.simulated).toBe(true);
      expect(c.institutionName).toMatch(/\(simulated\)/);
      expect(c).toHaveProperty("status");
      expect(c).toHaveProperty("lastSyncedAt");
      for (const a of c.accounts) expect(a.mask).toMatch(/^\d{4}$/);
    }
    expect(alice.content).not.toMatch(/token|secret|password|account_?number|userId/i);
    expectIntegerCents(alice.body);
  });

  it("rejects model-supplied user IDs", () => {
    const db = freshDb();
    const out = call(db, "bob", "get_connections", { user_id: "alice" });
    expect(out.isError).toBe(true);
    expect(out.content).not.toMatch(/conn_alice/);
  });
});

describe("get_portfolio", () => {
  it("returns only the session user's holdings, flags paper accounts and labels prices simulated", () => {
    const db = freshDb();
    const alice = call(db, "alice", "get_portfolio");
    const bob = call(db, "bob", "get_portfolio");

    expect(bob.body.accounts.map((a: { accountId: string }) => a.accountId)).toEqual(["acct_bob_paper"]);
    expect(bob.content).not.toMatch(/alice/i);
    expect(bob.body.investedValueCents).toBe(0);

    const ids = alice.body.accounts.map((a: { accountId: string }) => a.accountId);
    expect(ids).toContain("acct_alice_brokerage");
    expect(ids).toContain("acct_alice_paper");
    expect(alice.content).not.toMatch(/bob/i);
    expect(alice.body.accounts.find((a: { accountId: string }) => a.accountId === "acct_alice_paper").paper).toBe(true);
    expect(alice.body.accounts.find((a: { accountId: string }) => a.accountId === "acct_alice_brokerage").paper).toBe(false);

    expect(alice.body.simulated).toBe(true);
    expect(alice.body.quotesSource).toBe("simulated");
    expect(alice.body.disclaimer).toMatch(/simulated/i);
    expectIntegerCents(alice.body);
    expectIntegerCents(bob.body);
  });

  it("rejects attempts to read another user's portfolio through input", () => {
    const db = freshDb();
    const out = call(db, "bob", "get_portfolio", { user_id: "alice" });
    expect(out.isError).toBe(true);
    expect(out.content).not.toMatch(/acct_alice/);
  });
});

describe("get_quotes", () => {
  it("returns simulated quotes in integer cents and reports unknown symbols instead of inventing them", () => {
    const db = freshDb();
    const out = call(db, "alice", "get_quotes", { symbols: ["vti", "AAPL", "NOTREAL"] });
    expect(out.isError).toBe(false);
    expect(out.body.quotes.map((q: { symbol: string }) => q.symbol)).toEqual(["VTI", "AAPL"]);
    expect(out.body.unknown).toEqual(["NOTREAL"]);
    for (const q of out.body.quotes) expect(q.source).toBe("simulated");
    expect(out.body.simulated).toBe(true);
    expect(out.body.disclaimer).toMatch(/simulated/i);
    expectIntegerCents(out.body);
  });

  it("requires 1 to 10 symbols", () => {
    const db = freshDb();
    expect(call(db, "alice", "get_quotes", { symbols: [] }).isError).toBe(true);
    expect(call(db, "alice", "get_quotes", {}).isError).toBe(true);
    const eleven = Array.from({ length: 11 }, (_, i) => `S${i}`);
    expect(call(db, "alice", "get_quotes", { symbols: eleven }).isError).toBe(true);
  });
});

describe("get_agent_insights", () => {
  it("returns only the session user's insights with evidence IDs, labeled advisory", () => {
    const db = freshDb();
    const a = seedInsight(db, "alice", "k_alice");
    const b = seedInsight(db, "bob", "k_bob");

    const alice = call(db, "alice", "get_agent_insights");
    const bob = call(db, "bob", "get_agent_insights");
    expect(alice.body.insights.map((i: { id: string }) => i.id)).toEqual([a.id]);
    expect(bob.body.insights.map((i: { id: string }) => i.id)).toEqual([b.id]);
    expect(bob.content).not.toContain(a.id);
    expect(bob.content).not.toMatch(/alice/i);

    const [ins] = alice.body.insights;
    expect(ins.evidence.transactionIds).toEqual(a.evidence.transactionIds);
    expect(ins.deterministic).toBe(true);
    expect(alice.body.synthetic).toBe(true);
    expect(alice.body.notice).toMatch(/advisory/i);
    expect(alice.body.notice).toMatch(/evidence IDs/);
  });

  it("filters by status, hides dismissed by default and never changes status", () => {
    const db = freshDb();
    const keep = seedInsight(db, "alice", "k_keep");
    const gone = seedInsight(db, "alice", "k_gone");
    setInsightStatus(db, "alice", gone.id, "dismissed");

    const ids = (status?: string) =>
      call(db, "alice", "get_agent_insights", status ? { status } : {}).body.insights.map((i: { id: string }) => i.id);
    expect(ids()).toEqual([keep.id]);
    expect(ids("new")).toEqual([keep.id]);
    expect(ids("dismissed")).toEqual([gone.id]);
    expect(ids("seen")).toEqual([]);

    expect(call(db, "alice", "get_agent_insights", { status: "all" }).isError).toBe(true);
    expect(call(db, "alice", "get_agent_insights", { status: "seen", id: keep.id }).isError).toBe(true);
    expect(getInsight(db, "alice", keep.id).status).toBe("new");
    expect(getInsight(db, "alice", gone.id).status).toBe("dismissed");
  });
});

describe("new read tools are read-only", () => {
  it("write nothing except the assistant audit entry", () => {
    const db = freshDb();
    seedInsight(db, "alice", "k1");
    const tables = ["actions", "accounts", "transactions", "connections", "insights"];
    const before = Object.fromEntries(tables.map((t) => [t, countRows(db, t)]));
    const insightsBefore = db.prepare("SELECT id, status, updated_at FROM insights ORDER BY id").all();
    const auditBefore = countRows(db, "audit_events");

    const calls: [string, unknown][] = [
      ["get_connections", {}], ["get_portfolio", {}], ["get_quotes", { symbols: ["VTI"] }], ["get_agent_insights", {}],
    ];
    const ctx = ctxFor(db, "alice");
    for (const [name, input] of calls) expect(runTool(ctx, name, input).isError).toBe(false);

    expect(ctx.proposedActionIds).toEqual([]);
    expect(Object.fromEntries(tables.map((t) => [t, countRows(db, t)]))).toEqual(before);
    expect(db.prepare("SELECT id, status, updated_at FROM insights ORDER BY id").all()).toEqual(insightsBefore);
    expect(countRows(db, "audit_events")).toBe(auditBefore + calls.length);
    const last = db
      .prepare("SELECT user_id, actor, event_type FROM audit_events ORDER BY rowid DESC LIMIT 1")
      .get() as { user_id: string; actor: string; event_type: string };
    expect(last).toEqual({ user_id: "alice", actor: "assistant", event_type: "assistant.tool_call" });
  });
});
