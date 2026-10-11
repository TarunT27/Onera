// Personal assistant: background briefing with evidence-linked tips, research notes and to-dos. Observation only.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTransfer } from "@/lib/actions/service";
import { enqueueJob, getAgent, getLatestBriefing, listInsights, runPendingJobs } from "@/lib/agents";
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import { freshDb } from "./helpers";

let seq = 0;
function prepare(db: DB, userId: UserId) {
  enqueueJob(db, { userId, type: "assistant_briefing", dedupeKey: `test:${userId}:${++seq}` });
  const report = runPendingJobs(db, { userId });
  expect(report.jobs?.find((j) => j.type === "assistant_briefing")?.status).toBe("succeeded");
  return getLatestBriefing(db, userId)!.briefing;
}

const ownedIds = (db: DB, table: string, userId: string, ids: string[]) =>
  ids.length === 0 ||
  (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ? AND id IN (${ids.map(() => "?").join(",")})`)
    .get(userId, ...ids) as { n: number }).n === new Set(ids).size;

describe("personal assistant briefing", () => {
  it("prepares a deterministic briefing: snapshot, savings tips, investment notes", () => {
    const db = freshDb();
    const b = prepare(db, "alice");

    expect(b).toMatchObject({ agentId: "personal_assistant", deterministic: true });
    expect(b.disclaimer).toMatch(/not financial, tax or investment advice/);
    const s = b.snapshot;
    for (const v of [s.monthlyIncomeCents, s.monthlySpendingCents, s.cashCents, s.savingsCents, s.investedCents]) {
      expect(Number.isInteger(v)).toBe(true);
    }
    expect(s.monthlyIncomeCents).toBeGreaterThan(s.monthlySpendingCents);
    expect(s.topCategories.length).toBeGreaterThan(0);

    // The seeded StreamFlix increase becomes a savings estimate: $7.50/month × 12.
    expect(b.tips.find((t) => t.id === "price_increase:streamflix")).toMatchObject({ kind: "save", annualSavingsCents: 9_000 });
    // Small, frequent discretionary purchases (Bean There coffee is seeded) are flagged with their charges.
    const habits = b.tips.filter((t) => t.id.startsWith("habit:"));
    expect(habits.length).toBeGreaterThan(0);
    for (const h of habits) expect(ownedIds(db, "transactions", "alice", h.evidence.transactionIds ?? [])).toBe(true);
    // AAPL + MSFT are individual tech stocks, ~42% of the imported holdings.
    expect(b.tips.find((t) => t.id === "sector:technology")?.evidence.symbols).toEqual(expect.arrayContaining(["AAPL", "MSFT"]));
    expect(b.potentialAnnualSavingsCents).toBe(b.tips.reduce((n, t) => n + (t.annualSavingsCents ?? 0), 0));

    // Research covers every holding; paper-only positions are labeled.
    expect(b.research.map((r) => r.symbol).sort()).toEqual(["AAPL", "BND", "MSFT", "VOO", "VTI"]);
    expect(b.research.find((r) => r.symbol === "VOO")).toMatchObject({ paper: true, weightPct: null });
    expect(b.research.every((r) => /simulated prices/.test(r.note))).toBe(true);
    expect(b.movers).toHaveLength(3);
    expect(b.attention).toEqual([]);
  });

  it("persists only inbox-worthy tips as insights, citing the user's own records, and doesn't re-alert", () => {
    const db = freshDb();
    const b = prepare(db, "alice");
    const persisted = listInsights(db, "alice", { agentId: "personal_assistant" });
    expect(persisted.length).toBe(b.tips.filter((t) => t.insightId).length);
    expect(persisted.every((i) => i.type === "assistant_tip" && i.severity !== "critical")).toBe(true);
    for (const i of persisted) {
      expect(ownedIds(db, "transactions", "alice", i.evidence.transactionIds ?? [])).toBe(true);
      expect(ownedIds(db, "accounts", "alice", i.evidence.accountIds ?? [])).toBe(true);
    }
    // The subscription monitor already alerts on the price increase; the PA doesn't duplicate it.
    expect(b.tips.find((t) => t.id === "price_increase:streamflix")?.insightId).toBeNull();

    prepare(db, "alice");
    const again = listInsights(db, "alice", { agentId: "personal_assistant" });
    expect(again.map((i) => [i.id, i.updatedAt])).toEqual(persisted.map((i) => [i.id, i.updatedAt]));
  });

  it("doesn't re-alert persisted tips on tiny balance changes", () => {
    const db = freshDb();
    prepare(db, "alice");
    const before = listInsights(db, "alice", { agentId: "personal_assistant" });
    db.prepare("UPDATE accounts SET balance_cents = balance_cents + 1 WHERE user_id = 'alice' AND type IN ('checking','savings')").run();
    prepare(db, "alice");
    const after = listInsights(db, "alice", { agentId: "personal_assistant" });
    expect(after.map((i) => [i.id, i.updatedAt, i.title])).toEqual(before.map((i) => [i.id, i.updatedAt, i.title]));
  });

  it("lists transfers that need the user, with links only", () => {
    const db = freshDb();
    const held = createTransfer(db, "alice", {
      sourceAccountId: "acct_alice_checking", recipientId: "rcp_alice_landlord", amountCents: 185_000, memo: "Rent",
    }, "user");
    const b = prepare(db, "alice");
    expect(b.attention).toEqual([
      expect.objectContaining({
        kind: "held", href: `/transfers?id=${held.id}`, evidence: { actionIds: [held.id] },
        title: "$1,850.00 to Oak Street Properties (landlord) is on hold",
      }),
    ]);
    expect(b.headline).toMatch(/1 thing needs your attention/);
  });

  it("is scoped to its own user", () => {
    const db = freshDb();
    prepare(db, "alice");
    const bob = prepare(db, "bob");
    expect(JSON.stringify(bob)).not.toMatch(/alice/);
    expect(bob.research).toEqual([]); // Bob holds no positions
    expect(getLatestBriefing(db, "bob")!.briefing.generatedAt).toBe(bob.generatedAt);
  });

  it("has no powers and no path to money movement", () => {
    expect(getAgent("personal_assistant")).toMatchObject({
      writes: ["insights"], canApprove: false, canExecute: false, canCreateMandates: false,
      canVerifyRecipients: false, canChangeControls: false, usesModel: false,
    });
    const src = fs.readFileSync(path.join(process.cwd(), "lib", "agents", "monitors", "assistant.ts"), "utf8");
    expect(src).not.toMatch(/\b(createTransfer|createOrder|propose\w*|approve\w*|execute\w*|verify\w*|update\w*Controls)\s*\(/);
  });
});

describe("chatguard boundary", () => {
  const FORBIDDEN = [
    "executeOrder", "approveOrder", "createMandate", "revokeMandate", "updateTradingControls",
    "executeTransfer", "approveAction", "updateControls", "verifyRecipient", "createTransfer", "createOrder",
  ];
  const dir = path.join(process.cwd(), "lib", "chatguard");

  it("the monitor and gates never reference privileged or write functions", () => {
    const offenders = fs.readdirSync(dir).flatMap((f) => {
      const text = fs.readFileSync(path.join(dir, f), "utf8");
      return FORBIDDEN.filter((n) => new RegExp(`\\b${n}\\b`).test(text)).map((n) => `${f}: ${n}`);
    });
    expect(offenders).toEqual([]);
  });

  it("the AI reviewer is given no tools", () => {
    const src = fs.readFileSync(path.join(dir, "reviewer.ts"), "utf8");
    expect(src).not.toMatch(/\btools\s*:/);
  });
});
