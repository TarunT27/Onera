// Assistant agents and the paper-trading tools: each agent can call only its
// own tools, only the Trade drafter can propose orders, and a proposed order
// still waits for the user's exact-version approval.
import { describe, expect, it } from "vitest";
import { ASSISTANT_AGENT_DEFINITIONS, assistantAgent } from "@/lib/ai/agents";
import { runTool, TOOL_DEFINITIONS, type ToolContext } from "@/lib/ai/tools";
import type { DB } from "@/lib/db";
import { executeOrder, getOrder } from "@/lib/markets";
import { ASSISTANT_AGENTS, type AssistantAgentId } from "@/lib/types";
import { errorCode, freshDb } from "./helpers";

function ctxFor(db: DB, agent: AssistantAgentId): ToolContext {
  return {
    db, userId: "alice", proposedActionIds: [], proposedOrderIds: [],
    allowedTools: new Set(assistantAgent(agent).tools),
  };
}

describe("assistant agents", () => {
  it("defines every agent with a subset of the real tools", () => {
    const all = new Set(TOOL_DEFINITIONS.map((t) => t.name));
    for (const id of ASSISTANT_AGENTS) {
      const agent = ASSISTANT_AGENT_DEFINITIONS[id];
      expect(agent.id).toBe(id);
      for (const tool of agent.tools) expect(all.has(tool)).toBe(true);
    }
  });

  it("gives propose_order to the Trade drafter only", () => {
    const withOrders = ASSISTANT_AGENTS.filter((id) => ASSISTANT_AGENT_DEFINITIONS[id].tools.includes("propose_order"));
    expect(withOrders).toEqual(["drafter"]);
    // Read-only research agents cannot write anything at all.
    for (const id of ["research", "chart", "risk"] as const) {
      expect(ASSISTANT_AGENT_DEFINITIONS[id].tools.filter((t) => t.startsWith("propose_"))).toEqual([]);
    }
    expect(assistantAgent(undefined).id).toBe("general");
  });

  it("refuses tools outside the selected agent, even when the model calls them", () => {
    const db = freshDb();
    for (const agent of ["general", "research", "chart", "risk"] as const) {
      const out = runTool(ctxFor(db, agent), "propose_order", {
        account_id: "acct_alice_paper", symbol: "VTI", side: "buy", notional_cents: 10_000,
      });
      expect(out.isError).toBe(true);
      expect(out.trace.summary).toBe("Refused: not available to this agent");
    }
    const research = runTool(ctxFor(db, "research"), "get_portfolio", {});
    expect(research.isError).toBe(true);
    // Nothing was created by the refused calls.
    expect(db.prepare("SELECT COUNT(*) AS n FROM orders WHERE user_id = 'alice'").get()).toEqual({ n: 0 });
  });
});

describe("paper-trading tools", () => {
  it("reads simulated price history and labels it", () => {
    const db = freshDb();
    const out = runTool(ctxFor(db, "chart"), "get_price_history", { symbol: "nvda", days: 7 });
    expect(out.isError).toBe(false);
    const body = JSON.parse(out.content);
    expect(body.symbol).toBe("NVDA");
    expect(body.points).toHaveLength(8);
    expect(body.source).toBe("simulated");
    for (const p of body.points) expect(Number.isInteger(p.closeCents)).toBe(true);

    const unknown = runTool(ctxFor(db, "chart"), "get_price_history", { symbol: "ZZZZ" });
    expect(unknown.isError).toBe(true);
  });

  it("reads trading limits without being able to change them", () => {
    const db = freshDb();
    const out = runTool(ctxFor(db, "risk"), "get_trading_controls", {});
    expect(out.isError).toBe(false);
    const body = JSON.parse(out.content);
    expect(Number.isInteger(body.controls.perOrderLimitCents)).toBe(true);
    expect(Number.isInteger(body.controls.dailyOrderLimitCents)).toBe(true);
    expect(body.paused).toBe(false);
    expect(runTool(ctxFor(db, "risk"), "get_trading_controls", { perOrderLimitCents: 1 }).isError).toBe(true);
  });

  it("lets the Trade drafter propose a paper order that still needs the user's approval", () => {
    const db = freshDb();
    const ctx = ctxFor(db, "drafter");
    const out = runTool(ctx, "propose_order", {
      account_id: "acct_alice_paper", symbol: "VTI", side: "buy", notional_cents: 25_000,
    });
    expect(out.isError).toBe(false);
    expect(ctx.proposedOrderIds).toHaveLength(1);
    const order = getOrder(db, "alice", ctx.proposedOrderIds![0]);
    expect(order.createdBy).toBe("assistant");
    expect(order.paper).toBe(true);
    expect(["AWAITING_APPROVAL", "HELD"]).toContain(order.state);
    expect(order.hasApproval).toBe(false);
    // The assistant has no way to execute; a direct execution attempt is refused.
    expect(errorCode(() => executeOrder(db, "alice", order.id))).toBe("INVALID_STATE");
  });

  it("holds an over-limit order and rejects invalid sizing", () => {
    const db = freshDb();
    const ctx = ctxFor(db, "drafter");
    const big = runTool(ctx, "propose_order", {
      account_id: "acct_alice_paper", symbol: "VTI", side: "buy", notional_cents: 9_000_000,
    });
    expect(big.isError).toBe(false);
    expect(JSON.parse(big.content).state).toBe("HELD");

    // Sells must be sized in shares, exactly as for the UI.
    const sell = runTool(ctx, "propose_order", {
      account_id: "acct_alice_paper", symbol: "VTI", side: "sell", notional_cents: 10_000,
    });
    expect(sell.isError).toBe(true);
  });

  it("cannot propose into another user's account", () => {
    const db = freshDb();
    const out = runTool(ctxFor(db, "drafter"), "propose_order", {
      account_id: "acct_bob_paper", symbol: "VTI", side: "buy", notional_cents: 10_000,
    });
    expect(out.isError).toBe(true);
    expect(JSON.parse(out.content).error).toBe("NOT_FOUND");
  });
});
