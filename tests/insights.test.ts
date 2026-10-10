// Essential check 7: internal transfers don't inflate spending; the subscription increase cites evidence.
import { describe, expect, it } from "vitest";
import { approveAction, createTransfer } from "@/lib/actions/service";
import { verifyRecipient } from "@/lib/actions/recipients";
import { executeTransfer } from "@/lib/actions/simulator";
import { getTransactionsByIds } from "@/lib/finance/accounts";
import { spendingSummary } from "@/lib/finance/spending";
import { detectSubscriptionIncreases } from "@/lib/finance/subscriptions";
import { freshDb } from "./helpers";

describe("insights", () => {
  it("detects the StreamFlix price increase with evidence transactions", () => {
    const db = freshDb();
    const findings = detectSubscriptionIncreases(db, "alice");
    expect(findings).toHaveLength(1);
    const [s] = findings;
    expect(s.merchant).toBe("StreamFlix");
    expect(s.previousAmountCents).toBe(1_549);
    expect(s.currentAmountCents).toBe(2_299);
    expect(s.evidenceTransactionIds).toHaveLength(4);
    const evidence = getTransactionsByIds(db, "alice", s.evidenceTransactionIds);
    expect(evidence.every((t) => t.merchant === "StreamFlix")).toBe(true);
  });

  it("does not flag steady subscriptions", () => {
    const db = freshDb();
    expect(detectSubscriptionIncreases(db, "bob")).toHaveLength(0);
  });

  it("excludes internal transfers from spending, including simulator-created ones", () => {
    const db = freshDb();
    const before = spendingSummary(db, "alice");
    const a = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_savings", amountCents: 40_000 }, "user");
    approveAction(db, "alice", a.id, { version: a.version });
    executeTransfer(db, "alice", a.id);
    const after = spendingSummary(db, "alice");
    expect(after.totalCents).toBe(before.totalCents);
    expect(after.excludedInternalTransferCents).toBe(before.excludedInternalTransferCents + 40_000);
    const legs = db.prepare("SELECT category FROM transactions WHERE user_id = ? AND action_id = ?")
      .all("alice", a.id) as { category: string }[];
    expect(legs.map((t) => t.category)).toEqual(["transfer", "transfer"]);
  });

  it("counts an executed landlord payment as housing exactly once", () => {
    const db = freshDb();
    verifyRecipient(db, "alice", "rcp_alice_landlord");
    const before = spendingSummary(db, "alice");
    const a = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents: 185_000 }, "user");
    approveAction(db, "alice", a.id, { version: a.version });
    executeTransfer(db, "alice", a.id);
    executeTransfer(db, "alice", a.id);

    const after = spendingSummary(db, "alice");
    const housing = (s: typeof before) => s.byCategory.find((c) => c.category === "housing")?.totalCents ?? 0;
    expect(after.totalCents).toBe(before.totalCents + 185_000);
    expect(housing(after)).toBe(housing(before) + 185_000);
    expect(after.byCategory.some((c) => c.category === "transfer")).toBe(false);
    const tx = db.prepare("SELECT category, transfer_group_id FROM transactions WHERE user_id = ? AND action_id = ?")
      .get("alice", a.id);
    expect(tx).toEqual({ category: "housing", transfer_group_id: null });
  });

  it.each([
    { memo: "Rent reimbursement", category: "housing" },
    { memo: "Shared dinner", category: "other" },
    { memo: "Current expenses", category: "other" },
  ])("categorizes external payments with memo '$memo' as $category", ({ memo, category }) => {
    const db = freshDb();
    const a = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_sam", amountCents: 2_500, memo }, "user");
    approveAction(db, "alice", a.id, { version: a.version });
    executeTransfer(db, "alice", a.id);
    const tx = db.prepare("SELECT category FROM transactions WHERE user_id = ? AND action_id = ?")
      .get("alice", a.id);
    expect(tx).toEqual({ category });
  });
});
