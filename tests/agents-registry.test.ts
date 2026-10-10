// Agents: the registry is the permission matrix, enforced through the context handlers receive.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_REGISTRY, agentForJobType, JOB_TYPES, permissionMatrix, permissionMatrixMarkdown, ScopeViolationError } from "@/lib/agents";
import { buildAgentContext, type AgentContext } from "@/lib/agents/context";
import { getAgent } from "@/lib/agents/registry";
import { WRITE_SCOPES, type AgentDefinition } from "@/lib/agents/types";
import { freshDb } from "./helpers";

function contextFor(agentId: string) {
  const db = freshDb();
  const agent = getAgent(agentId)!;
  const { ctx, tracker } = buildAgentContext(db, agent,
    { id: "job_test", userId: "alice", type: agent.jobTypes[0], payload: {}, attempt: 1 }, new Date());
  return { db, ctx, tracker };
}

/** Every property name reachable from the context object. */
function allKeys(obj: unknown, seen = new Set<unknown>()): string[] {
  if (!obj || typeof obj !== "object" || seen.has(obj)) return [];
  seen.add(obj);
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    k === "agent" ? [k] : [k, ...allKeys(v, seen)]);
}

describe("agent registry", () => {
  it("maps every job type to exactly one agent", () => {
    for (const t of JOB_TYPES) {
      expect(AGENT_REGISTRY.filter((a) => (a.jobTypes as string[]).includes(t))).toHaveLength(1);
      expect(agentForJobType(t)).toBeDefined();
    }
    expect(AGENT_REGISTRY.flatMap((a) => a.jobTypes).sort()).toEqual([...JOB_TYPES].sort());
  });

  it("grants no agent approval, execution, mandates, recipient verification, controls or a model", () => {
    for (const a of AGENT_REGISTRY) {
      expect(a).toMatchObject({
        canApprove: false, canExecute: false, canCreateMandates: false,
        canVerifyRecipients: false, canChangeControls: false, usesModel: false,
      });
      expect(a.writes.every((w) => WRITE_SCOPES.includes(w))).toBe(true);
      expect(a.writes).toContain("insights");
      // "jobs" only where the agent actually queues follow-ups.
      expect(a.writes.includes("jobs")).toBe(a.enqueues.length > 0);
    }
    // Only the connection monitor writes beyond insights.
    expect(AGENT_REGISTRY.filter((a) => a.writes.length > 1).map((a) => a.id)).toEqual(["connection_monitor"]);
  });

  it("is frozen at runtime", () => {
    const a = AGENT_REGISTRY[0] as AgentDefinition;
    expect(() => (a.reads as string[]).push("actions")).toThrow(TypeError);
    expect(() => { (a as { canApprove: boolean }).canApprove = true; }).toThrow(TypeError);
    expect(() => (AGENT_REGISTRY as AgentDefinition[]).push(a)).toThrow(TypeError);
  });

  it("exposes a permission matrix for the API/UI", () => {
    const m = permissionMatrix();
    expect(m).toHaveLength(AGENT_REGISTRY.length);
    const sentinel = m.find((r) => r.agentId === "security_sentinel")!;
    expect(sentinel.reads).toMatchObject({ actions: true, recipients: true, transactions: true, portfolio: false, connections: false });
    expect(sentinel.writes).toEqual({ insights: true, jobs: false, connection_sync: false });
  });

  it("docs/api/agents.md contains the matrix generated from the registry", () => {
    const doc = fs.readFileSync(path.join(import.meta.dirname, "..", "docs", "api", "agents.md"), "utf8");
    expect(doc).toContain(permissionMatrixMarkdown());
  });
});

describe("agent context enforcement", () => {
  it("never exposes a database handle or any privileged operation", () => {
    for (const a of AGENT_REGISTRY) {
      const { ctx } = contextFor(a.id);
      const keys = allKeys(ctx);
      expect(keys).not.toContain("db");
      expect(keys.filter((k) => /approve|execute|verify|mandate|control|pause|hold|release|prepare|exec/i.test(k))).toEqual([]);
      expect(Object.isFrozen(ctx)).toBe(true);
      expect(Object.isFrozen(ctx.read.transactions)).toBe(true);
    }
  });

  it("allows declared reads and blocks everything else", () => {
    const { ctx, tracker } = contextFor("spending_monitor");
    expect(ctx.read.transactions.list().length).toBeGreaterThan(0);
    expect(ctx.read.transactions.list().every((t) => t.userId === "alice")).toBe(true);
    const blocked: [string, (c: AgentContext) => unknown][] = [
      ["recipients", (c) => c.read.recipients.get("rcp_alice_landlord")],
      ["actions", (c) => c.read.actions.list()],
      ["accounts", (c) => c.read.accounts.list()],
      ["portfolio", (c) => c.read.portfolio.get()],
      ["connections", (c) => c.read.connections.list()],
      ["jobs", (c) => c.jobs.enqueue({ type: "spending_review", dedupeKey: "x" })],
      ["connections", (c) => c.connections.sync("conn_1")],
    ];
    for (const [scope, call] of blocked) {
      let err: unknown;
      try { call(ctx); } catch (e) { err = e; }
      expect(err, scope).toBeInstanceOf(ScopeViolationError);
      expect((err as ScopeViolationError).scope).toBe(scope);
    }
    expect(tracker.violations).toHaveLength(blocked.length);
  });

  it("limits follow-up jobs to the registered types, for the context's own user", () => {
    const { db, ctx } = contextFor("connection_monitor");
    expect(() => ctx.jobs.enqueue({ type: "security_review", dedupeKey: "x" })).toThrow(ScopeViolationError);
    const r = ctx.jobs.enqueue({ type: "spending_review", dedupeKey: "after_sync:c:1" });
    const row = db.prepare("SELECT user_id, dedupe_key FROM jobs WHERE id = ?").get(r.jobId) as { user_id: string; dedupe_key: string };
    expect(row).toEqual({ user_id: "alice", dedupe_key: "spending_review:alice:after_sync:c:1" });
  });

  it("monitor source never imports the database, actions, policy, controls or AI modules", () => {
    const dir = path.join(import.meta.dirname, "..", "lib", "agents", "monitors");
    const forbidden = /from\s+["'](@\/lib\/db|@\/lib\/actions|@\/lib\/policy|@\/lib\/controls|@\/lib\/ai|better-sqlite3)[^"']*["']/;
    for (const f of fs.readdirSync(dir)) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      expect(forbidden.test(src), f).toBe(false);
    }
  });
});
