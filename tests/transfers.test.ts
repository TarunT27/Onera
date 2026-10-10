// Essential checks 2–6: execution, holds, bound approvals, duplicates, limits, pause.
import { describe, expect, it } from "vitest";
import { changeRecipientDetails, verifyRecipient } from "@/lib/actions/recipients";
import { approveAction, createTransfer, editTransfer, evaluateAction } from "@/lib/actions/service";
import { executeTransfer } from "@/lib/actions/simulator";
import { updateControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import { balance, errorCode, freshDb } from "./helpers";

const toSavings = (db: DB, amountCents = 50_000) =>
  createTransfer(db, "alice",
    { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_savings", amountCents }, "user");

const toLandlord = (db: DB, amountCents = 185_000) =>
  createTransfer(db, "alice",
    { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents }, "user");

describe("verified own-account transfer", () => {
  it("executes once, moves both balances and produces a receipt", () => {
    const db = freshDb();
    const checking = balance(db, "acct_alice_checking");
    const savings = balance(db, "acct_alice_savings");

    const proposed = toSavings(db);
    expect(proposed.state).toBe("AWAITING_APPROVAL");
    approveAction(db, "alice", proposed.id, { version: proposed.version });
    const first = executeTransfer(db, "alice", proposed.id);

    expect(first.duplicate).toBe(false);
    expect(first.action.state).toBe("EXECUTED");
    expect(first.receipt.simulated).toBe(true);
    expect(balance(db, "acct_alice_checking")).toBe(checking - 50_000);
    expect(balance(db, "acct_alice_savings")).toBe(savings + 50_000);

    // Essential check 5: repeat requests return the same receipt and move nothing.
    const again = executeTransfer(db, "alice", proposed.id);
    expect(again.duplicate).toBe(true);
    expect(again.receipt.receiptId).toBe(first.receipt.receiptId);
    expect(balance(db, "acct_alice_checking")).toBe(checking - 50_000);
    const legs = db.prepare("SELECT COUNT(*) AS n FROM transactions WHERE action_id = ?").get(proposed.id) as { n: number };
    expect(legs.n).toBe(2);
  });
});

describe("changed recipient", () => {
  it("is held with RECIPIENT_CHANGED and cannot be approved or executed directly", () => {
    const db = freshDb();
    const before = balance(db, "acct_alice_checking");
    const held = toLandlord(db);
    expect(held.state).toBe("HELD");
    expect(held.holdReasons).toContain("RECIPIENT_CHANGED");

    expect(errorCode(() => approveAction(db, "alice", held.id, { version: held.version }))).toBe("INVALID_STATE");
    expect(errorCode(() => executeTransfer(db, "alice", held.id))).toBe("INVALID_STATE");
    expect(balance(db, "acct_alice_checking")).toBe(before);
  });

  it("can proceed only after out-of-band verification and re-evaluation", () => {
    const db = freshDb();
    const held = toLandlord(db);
    verifyRecipient(db, "alice", "rcp_alice_landlord");
    const ready = evaluateAction(db, "alice", held.id);
    expect(ready.state).toBe("AWAITING_APPROVAL");
  });
});

describe("bound approvals (essential check 4)", () => {
  it("editing the amount after approval discards the approval", () => {
    const db = freshDb();
    const a = toSavings(db);
    approveAction(db, "alice", a.id, { version: a.version });
    const edited = editTransfer(db, "alice", a.id, { amountCents: 60_000 });
    expect(edited.version).toBe(a.version + 1);
    expect(edited.hasApproval).toBe(false);
    expect(edited.state).toBe("AWAITING_APPROVAL");
    expect(errorCode(() => executeTransfer(db, "alice", a.id))).toBe("INVALID_STATE");
  });

  it("rejects approval of a version the user did not review", () => {
    const db = freshDb();
    const a = toSavings(db);
    editTransfer(db, "alice", a.id, { amountCents: 70_000 });
    expect(errorCode(() => approveAction(db, "alice", a.id, { version: a.version }))).toBe("STALE_VERSION");
  });

  it("a recipient detail change after approval invalidates execution", () => {
    const db = freshDb();
    const a = createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_sam", amountCents: 2_500 }, "user");
    approveAction(db, "alice", a.id, { version: a.version });
    changeRecipientDetails(db, "alice", "rcp_alice_sam",
      { institution: "Elsewhere Bank", accountMask: "0001", routingMask: "••9999" }, "test change");
    expect(errorCode(() => executeTransfer(db, "alice", a.id))).toBe("APPROVAL_INVALID");
    expect(executeOrState(db, a.id)).toBe("HELD");
  });
});

function executeOrState(db: DB, id: string) {
  return (db.prepare("SELECT state FROM actions WHERE id = ?").get(id) as { state: string }).state;
}

describe("limits and pause", () => {
  it("holds transfers over the per-transfer limit", () => {
    const db = freshDb();
    const a = toSavings(db, 250_000); // limit is $2,000
    expect(a.state).toBe("HELD");
    expect(a.holdReasons).toContain("LIMIT_EXCEEDED");
  });

  it("enforces the daily aggregate across separately approved transfers", () => {
    const db = freshDb();
    const one = toSavings(db, 180_000);
    const two = toSavings(db, 180_000); // each under $2,000; together over the $3,000 daily limit
    approveAction(db, "alice", one.id, { version: one.version });
    approveAction(db, "alice", two.id, { version: two.version });
    executeTransfer(db, "alice", one.id);
    expect(errorCode(() => executeTransfer(db, "alice", two.id))).toBe("POLICY_HOLD");
    expect(executeOrState(db, two.id)).toBe("HELD");
  });

  it("concurrent execute requests produce exactly one execution", async () => {
    const db = freshDb();
    const a = toSavings(db);
    approveAction(db, "alice", a.id, { version: a.version });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => Promise.resolve().then(() => executeTransfer(db, "alice", a.id))),
    );
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(new Set(results.map((r) => r.receipt.receiptId)).size).toBe(1);
  });

  it("pause blocks execution of an already-approved transfer (essential check 6)", () => {
    const db = freshDb();
    const before = balance(db, "acct_alice_checking");
    const a = toSavings(db);
    approveAction(db, "alice", a.id, { version: a.version });
    updateControls(db, "alice", { paused: true });
    expect(errorCode(() => executeTransfer(db, "alice", a.id))).toBe("POLICY_HOLD");
    expect(executeOrState(db, a.id)).toBe("HELD");
    expect(balance(db, "acct_alice_checking")).toBe(before);
  });

  it("holds transfers larger than the available balance", () => {
    const db = freshDb();
    updateControls(db, "alice", { perTransferLimitCents: 10_000_000, dailyLimitCents: 10_000_000 });
    const a = toSavings(db, 500_000); // checking has $4,250
    expect(a.holdReasons).toContain("INSUFFICIENT_FUNDS");
  });
});

describe("invalid proposals", () => {
  it("rejects view-only sources and same-account transfers", () => {
    const db = freshDb();
    expect(errorCode(() => createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_brokerage", recipientId: "rcp_alice_savings", amountCents: 100 }, "user"))).toBe("UNSUPPORTED");
    expect(errorCode(() => createTransfer(db, "alice",
      { sourceAccountId: "acct_alice_savings", recipientId: "rcp_alice_savings", amountCents: 100 }, "user"))).toBe("BAD_REQUEST");
  });
});
