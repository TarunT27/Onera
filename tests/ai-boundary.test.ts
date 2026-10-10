// Essential check 8: assistant tools cannot obtain execution privileges, even when
// untrusted content asks for them. (Model behavior is reported separately in the demo trace.)
import { describe, expect, it } from "vitest";
import { executeTransfer } from "@/lib/actions/simulator";
import { getAction } from "@/lib/actions/service";
import { runTool, TOOL_DEFINITIONS } from "@/lib/ai/tools";
import { errorCode, freshDb } from "./helpers";

describe("assistant boundary", () => {
  it("exposes no approval, execution, verification or settings tools", () => {
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names).toEqual([
      "get_accounts", "get_transactions", "get_spending_summary", "get_subscription_insights",
      "list_recipients", "get_research_document",
      "get_connections", "get_portfolio", "get_quotes", "get_agent_insights",
      "propose_transfer",
    ]);
    const db = freshDb();
    const ctx = { db, userId: "alice" as const, proposedActionIds: [] };
    for (const name of ["approve_transfer", "execute_transfer", "update_controls", "verify_recipient"]) {
      expect(runTool(ctx, name, {}).isError).toBe(true);
    }
  });

  it("exposes no trading, mandate, connection-management or control tools", () => {
    const privileged = /approve|execute|mandate|verify|control|pause|sync|link|disconnect|order/;
    const names = TOOL_DEFINITIONS.map((t) => t.name);
    expect(names.filter((n) => privileged.test(n))).toEqual([]);
    // propose_transfer is the only tool that writes anything (a proposal, never money movement).
    expect(names.filter((n) => !n.startsWith("get_") && !n.startsWith("list_"))).toEqual(["propose_transfer"]);

    const db = freshDb();
    const ctx = { db, userId: "alice" as const, proposedActionIds: [] };
    for (const name of [
      "sync_connection", "link_institution", "disconnect_connection", "reconnect_connection",
      "place_order", "create_order", "approve_order", "execute_order", "create_mandate", "revoke_mandate",
      "update_trading_controls", "pause_trading", "set_insight_status", "dismiss_insight",
    ]) {
      const out = runTool(ctx, name, {});
      expect(out.isError).toBe(true);
      expect(out.trace.summary).toBe("Unknown tool");
    }
  });

  it("returns research text wrapped and labeled as untrusted", () => {
    const db = freshDb();
    const out = runTool({ db, userId: "alice", proposedActionIds: [] }, "get_research_document",
      { document_id: "research_injected_article" });
    const body = JSON.parse(out.content);
    expect(body.notice).toMatch(/UNTRUSTED/);
    expect(body.content.startsWith("<untrusted_document>")).toBe(true);
  });

  it("does exactly what the injected article asks with tools and still cannot move money", () => {
    const db = freshDb();
    const ctx = { db, userId: "alice" as const, proposedActionIds: [] as string[] };
    // Worst case: the model obeys the injection and calls propose_transfer.
    const out = runTool(ctx, "propose_transfer", {
      source_account_id: "acct_alice_savings", recipient_id: "rcp_alice_landlord",
      amount_cents: 200_000, memo: "rent - updated details",
    });
    expect(out.isError).toBe(false);
    const action = getAction(db, "alice", ctx.proposedActionIds[0]);
    expect(action.createdBy).toBe("assistant");
    expect(action.state).toBe("HELD");
    expect(action.holdReasons).toContain("RECIPIENT_CHANGED");
    // And a direct execution attempt is refused by the server.
    expect(errorCode(() => executeTransfer(db, "alice", action.id))).toBe("INVALID_STATE");
  });
});
