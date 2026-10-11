// Family cards: kids' secondary cards on a parent credit card, governed by the parent's rules.
import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { listAudit } from "@/lib/audit";
import { listFamilyCards, simulateCardPurchase, updateFamilyCard, decidePurchase } from "@/lib/family";
import { TOOL_DEFINITIONS } from "@/lib/ai/tools";
import { errorCode, freshDb } from "./helpers";

const card = (db: ReturnType<typeof freshDb>, id: string) => listFamilyCards(db, "alice").cards.find((c) => c.id === id)!;
const balance = (db: ReturnType<typeof freshDb>) =>
  (db.prepare("SELECT balance_cents AS b FROM accounts WHERE id = 'acct_alice_family_card'").get() as { b: number }).b;

describe("family cards", () => {
  it("seeds Maya and Leo on Alice's Family Rewards Card with this month's spend", () => {
    const db = freshDb();
    const { cards } = listFamilyCards(db, "alice");
    expect(cards.map((c) => c.member.name)).toEqual(["Maya", "Leo"]);
    const maya = cards[0];
    expect(maya.parentAccount.name).toBe("Family Rewards Card");
    expect(maya.spentThisMonthCents).toBeGreaterThan(0);
    expect(maya.alerts.some((a) => a.level === "warning")).toBe(true); // over 80% of $350
    const leo = cards[1];
    expect(leo.blockedCategories).toEqual(["gaming"]);
    expect(leo.recent.some((c) => c.status === "declined" && c.declineReason === "CATEGORY_BLOCKED")).toBe(true);
    // Parent card balance owes exactly this month's approved kids' spend.
    expect(balance(db)).toBe(-(maya.spentThisMonthCents + leo.spentThisMonthCents));
  });

  it("Bob has no family cards and can't see or change Alice's", () => {
    const db = freshDb();
    expect(listFamilyCards(db, "bob").cards).toEqual([]);
    expect(errorCode(() => updateFamilyCard(db, "bob", "fc_alice_leo", { status: "frozen" }))).toBe("NOT_FOUND");
    expect(errorCode(() => simulateCardPurchase(db, "bob", "fc_alice_leo",
      { merchant: "X", category: "dining", amountCents: 100 }))).toBe("NOT_FOUND");
  });

  it("approves a purchase within the rules and posts it to the parent card", () => {
    const db = freshDb();
    const before = card(db, "fc_alice_leo");
    const owed = balance(db);
    const { charge, card: after } = simulateCardPurchase(db, "alice", "fc_alice_leo",
      { merchant: "Chipotle", category: "dining", amountCents: 1_250 });
    expect(charge.status).toBe("approved");
    expect(charge.transactionId).not.toBeNull();
    expect(after.spentThisMonthCents).toBe(before.spentThisMonthCents + 1_250);
    expect(balance(db)).toBe(owed - 1_250);
    expect(listAudit(db, "alice").some((e) => e.eventType === "family.charge_approved")).toBe(true);
  });

  it("declines blocked categories, oversized purchases, the monthly cap and frozen cards — and moves nothing", () => {
    const db = freshDb();
    const owed = balance(db);
    const tryBuy = (category: "gaming" | "dining", amountCents: number) =>
      simulateCardPurchase(db, "alice", "fc_alice_leo", { merchant: "Test", category, amountCents }).charge;
    expect(tryBuy("gaming", 500).declineReason).toBe("CATEGORY_BLOCKED");
    expect(tryBuy("dining", 4_001).declineReason).toBe("OVER_PURCHASE_LIMIT");
    updateFamilyCard(db, "alice", "fc_alice_leo", { monthlyLimitCents: 7_000 });
    expect(tryBuy("dining", 1_000).declineReason).toBe("OVER_MONTHLY_LIMIT");
    updateFamilyCard(db, "alice", "fc_alice_leo", { status: "frozen", monthlyLimitCents: 50_000 });
    expect(tryBuy("dining", 100).declineReason).toBe("CARD_FROZEN");
    expect(balance(db)).toBe(owed);
    const events = listAudit(db, "alice").map((e) => e.eventType);
    expect(events).toContain("family.card_frozen");
    expect(events.filter((e) => e === "family.charge_declined")).toHaveLength(4);
  });

  it("validates parent updates and rejects unknown fields", () => {
    const db = freshDb();
    // Schema errors (ZodError) become 400 BAD_REQUEST in the route layer.
    expect(() => updateFamilyCard(db, "alice", "fc_alice_maya", { userId: "bob" })).toThrow(ZodError);
    expect(() => updateFamilyCard(db, "alice", "fc_alice_maya", { blockedCategories: ["casino"] })).toThrow(ZodError);
    const next = updateFamilyCard(db, "alice", "fc_alice_maya", { blockedCategories: ["gaming", "gaming"] });
    expect(next.blockedCategories).toEqual(["gaming"]);
  });

  it("decision order is frozen → blocked → per-purchase → monthly", () => {
    const base = { status: "active" as const, blockedCategories: [], perPurchaseLimitCents: 1000, monthlyLimitCents: 5000, spentThisMonthCents: 0, category: "dining" as const, amountCents: 500 };
    expect(decidePurchase(base)).toBeNull();
    expect(decidePurchase({ ...base, status: "frozen", amountCents: 99_999 })).toBe("CARD_FROZEN");
    expect(decidePurchase({ ...base, spentThisMonthCents: 4_800 })).toBe("OVER_MONTHLY_LIMIT");
  });

  it("the assistant has no tool to change family cards", () => {
    expect(TOOL_DEFINITIONS.some((t) => /family|card|freeze|limit/i.test(t.name))).toBe(false);
  });
});
