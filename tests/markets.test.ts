// Markets: deterministic simulated quotes, history, portfolio valuation and approval binding.
import { describe, expect, it } from "vitest";
import { netWorth } from "@/lib/finance/accounts";
import {
  getPortfolio,
  getPriceHistory,
  getQuote,
  getQuotes,
  listInstruments,
  orderApprovalHash,
  SIMULATED_PRICES_DISCLAIMER,
} from "@/lib/markets";
import { freshDb } from "./helpers";

const T = new Date("2026-10-10T15:30:20.000Z");

describe("market simulator", () => {
  it("lists a fixed catalog of stocks and ETFs only", () => {
    const instruments = listInstruments();
    expect(instruments.length).toBeGreaterThanOrEqual(12);
    expect(instruments.every((i) => i.type === "stock" || i.type === "etf")).toBe(true);
    expect(instruments.map((i) => i.symbol)).toEqual(expect.arrayContaining(["VTI", "VOO", "AAPL", "BND"]));
  });

  it("returns the same quote for the same symbol and minute", () => {
    const a = getQuote("AAPL", T)!;
    const b = getQuote("aapl", new Date(T.getTime() + 25_000))!; // same minute, lowercase
    expect(b).toEqual(a);
    expect(a.source).toBe("simulated");
    expect(a.delayedMinutes).toBe(0);
    expect(a.asOf).toBe("2026-10-10T15:30:00.000Z");
    expect(Number.isInteger(a.priceCents)).toBe(true);
    expect(Number.isInteger(a.previousCloseCents)).toBe(true);
    expect(a.changePct).toBeCloseTo(((a.priceCents - a.previousCloseCents) / a.previousCloseCents) * 100, 1);
  });

  it("moves less than the 1% order bound from one minute to the next", () => {
    for (const { symbol } of listInstruments()) {
      for (let m = 1; m <= 1440; m += 7) {
        const before = getQuote(symbol, new Date(T.getTime() + (m - 1) * 60_000))!.priceCents;
        const after = getQuote(symbol, new Date(T.getTime() + m * 60_000))!.priceCents;
        expect(Math.abs(after / before - 1)).toBeLessThan(0.01);
      }
    }
  });

  it("returns null for symbols outside the catalog", () => {
    expect(getQuote("TSLA", T)).toBeNull();
    expect(getPriceHistory("TSLA", 30, T)).toBeNull();
    expect(getQuotes(["VTI", "NOPE"], T).unknown).toEqual(["NOPE"]);
  });

  it("produces deterministic daily history that ends at the current quote", () => {
    const h1 = getPriceHistory("VTI", 30, T)!;
    const h2 = getPriceHistory("VTI", 30, T)!;
    expect(h1).toEqual(h2);
    expect(h1.points).toHaveLength(31);
    expect(h1.disclaimer).toBe(SIMULATED_PRICES_DISCLAIMER);
    const q = getQuote("VTI", T)!;
    expect(h1.points.at(-1)).toEqual({ date: "2026-10-10", closeCents: q.priceCents });
    expect(h1.points.at(-2)!.closeCents).toBe(q.previousCloseCents);
    expect(getPriceHistory("VTI", 10_000, T)!.points).toHaveLength(366);
  });
});

describe("portfolio", () => {
  it("values imported and paper holdings at simulated prices", () => {
    const db = freshDb();
    const p = getPortfolio(db, "alice");
    expect(p.quotesSource).toBe("simulated");
    expect(p.disclaimer).toBe(SIMULATED_PRICES_DISCLAIMER);

    const imported = p.accounts.find((a) => a.accountId === "acct_alice_brokerage")!;
    expect(imported.paper).toBe(false);
    expect(imported.tradable).toBe(false);
    expect(imported.cashCents).toBe(42_015);
    expect(imported.positions.map((x) => x.symbol).sort()).toEqual(["AAPL", "BND", "MSFT", "VTI"]);
    // Seeded to ~$355,000 at seed-time prices.
    expect(Math.abs(imported.positionsValueCents - 35_500_000)).toBeLessThan(50_000);
    const weights = imported.positions.reduce((s, x) => s + x.weightPct, 0);
    expect(weights).toBeCloseTo(100, 0);
    for (const pos of imported.positions) {
      const quote = getQuote(pos.symbol, new Date(p.asOf))!;
      expect(pos.priceCents).toBe(quote.priceCents);
      expect(pos.unrealizedPnlCents).toBe(pos.marketValueCents - pos.costBasisCents);
    }

    const paper = p.accounts.find((a) => a.accountId === "acct_alice_paper")!;
    expect(paper.paper).toBe(true);
    expect(paper.tradable).toBe(true);
    expect(paper.positions.map((x) => x.symbol)).toEqual(["VOO"]);
    expect(paper.totalCents).toBe(paper.cashCents + paper.positionsValueCents);
  });

  it("counts only non-paper positions in investedValueCents and net worth", () => {
    const db = freshDb();
    const now = new Date();
    const p = getPortfolio(db, "alice", now);
    const imported = p.accounts.find((a) => !a.paper)!;
    const paper = p.accounts.find((a) => a.paper)!;
    expect(paper.positionsValueCents).toBeGreaterThan(0);
    expect(p.investedValueCents).toBe(imported.positionsValueCents);
    expect(p.paperValueCents).toBe(paper.totalCents);
    expect(netWorth(db, "alice", now).investmentsCents).toBe(p.investedValueCents);
  });

  it("is scoped to the session user", () => {
    const db = freshDb();
    const bob = getPortfolio(db, "bob");
    expect(bob.accounts.map((a) => a.accountId)).toEqual(["acct_bob_paper"]);
    expect(bob.investedValueCents).toBe(0);
  });
});

describe("order approval hash", () => {
  const base = {
    id: "ord_1", userId: "alice", version: 1, accountId: "acct_alice_paper", symbol: "VTI", side: "buy" as const,
    quantityMicros: null, notionalCents: 10_000, priceBoundCents: 30_000, mandateId: null,
  };

  it("changes when any material field changes", () => {
    const h = orderApprovalHash(base);
    expect(orderApprovalHash({ ...base })).toBe(h);
    for (const change of [
      { version: 2 }, { accountId: "acct_x" }, { symbol: "VOO" }, { side: "sell" as const },
      { notionalCents: 10_001 }, { quantityMicros: 1_000_000, notionalCents: null }, { priceBoundCents: 30_001 },
      { mandateId: "mdt_1" }, { userId: "bob" }, { id: "ord_2" },
    ]) {
      expect(orderApprovalHash({ ...base, ...change })).not.toBe(h);
    }
  });
});
