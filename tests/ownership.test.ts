// Essential check 1: Alice cannot read or act on Bob's records by changing IDs.
import { describe, expect, it } from "vitest";
import { createTransfer, getAction } from "@/lib/actions/service";
import { executeTransfer } from "@/lib/actions/simulator";
import { verifyRecipient } from "@/lib/actions/recipients";
import { getOwnedAccount, listTransactions } from "@/lib/finance/accounts";
import { runTool } from "@/lib/ai/tools";
import { errorCode, freshDb } from "./helpers";

describe("ownership", () => {
  it("hides other users' accounts, transactions and recipients", () => {
    const db = freshDb();
    expect(errorCode(() => getOwnedAccount(db, "alice", "acct_bob_checking"))).toBe("NOT_FOUND");
    expect(errorCode(() => listTransactions(db, "alice", { accountId: "acct_bob_checking" }))).toBe("NOT_FOUND");
    expect(errorCode(() => verifyRecipient(db, "alice", "rcp_bob_savings"))).toBe("NOT_FOUND");
  });

  it("rejects proposals that reference another user's account or recipient", () => {
    const db = freshDb();
    const base = { amountCents: 1_000, recipientId: "rcp_alice_savings", sourceAccountId: "acct_alice_checking" };
    expect(errorCode(() => createTransfer(db, "alice", { ...base, sourceAccountId: "acct_bob_checking" }, "user"))).toBe("NOT_FOUND");
    expect(errorCode(() => createTransfer(db, "alice", { ...base, recipientId: "rcp_bob_savings" }, "user"))).toBe("NOT_FOUND");
  });

  it("does not let one user read or execute another user's action", () => {
    const db = freshDb();
    const bobAction = createTransfer(db, "bob",
      { sourceAccountId: "acct_bob_checking", recipientId: "rcp_bob_savings", amountCents: 5_000 }, "user");
    expect(errorCode(() => getAction(db, "alice", bobAction.id))).toBe("NOT_FOUND");
    expect(errorCode(() => executeTransfer(db, "alice", bobAction.id))).toBe("NOT_FOUND");
  });

  it("scopes assistant tools to the session user, not to IDs in model input", () => {
    const db = freshDb();
    const ctx = { db, userId: "alice" as const, proposedActionIds: [] };
    const read = runTool(ctx, "get_transactions", { account_id: "acct_bob_checking" });
    expect(read.isError).toBe(true);
    const propose = runTool(ctx, "propose_transfer",
      { source_account_id: "acct_bob_checking", recipient_id: "rcp_bob_savings", amount_cents: 100 });
    expect(propose.isError).toBe(true);
    expect(ctx.proposedActionIds).toHaveLength(0);
  });
});
