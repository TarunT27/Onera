import { describe, expect, it } from "vitest";
import type { FxRate } from "@/lib/types";
import { directoryActivityScope, displayUsdCents, filterAccountActivity } from "@/app/accounts/presentation";
import { convertToUsdCents } from "@/lib/finance/fx";

const rates: FxRate[] = [{ currency: "GBP", rateMicros: 1_270_000, asOf: "2026-10-10", source: "Synthetic demo rate" }];

describe("account USD display equivalents", () => {
  it("converts the pound balance with the dated server rate", () => {
    expect(displayUsdCents(255_820, "GBP", rates)).toBe(324_891);
    expect(displayUsdCents(255_820, "GBP", [{ ...rates[0], rateMicros: 1_300_000 }])).toBe(332_566);
  });
  it("matches server half-away-from-zero rounding, including debits", () => {
    const cents = [0, 1, -1, 50, -50, 255_820, -255_820];
    for (const amount of cents) expect(displayUsdCents(amount, "GBP", rates)).toBe(convertToUsdCents(amount, rates[0].rateMicros));
    expect(displayUsdCents(-1, "GBP", [{ ...rates[0], rateMicros: 1_500_000 }])).toBe(-2);
  });
  it("does not fabricate missing or invalid conversions", () => {
    expect(displayUsdCents(100, "EUR", rates)).toBeNull();
    expect(displayUsdCents(1.5, "GBP", rates)).toBeNull();
    expect(displayUsdCents(100, "GBP", [{ ...rates[0], rateMicros: -1 }])).toBeNull();
    expect(displayUsdCents(Number.MAX_SAFE_INTEGER, "GBP", rates)).toBeNull();
  });
  it("leaves USD values unchanged without any FX rate", () => {
    expect(displayUsdCents(-250, "USD", [])).toBe(-250);
  });
});

describe("account activity display isolation", () => {
  const txs = [
    { accountId: "checking", merchant: "Coffee shop", description: "Breakfast", category: "dining" },
    { accountId: "foreign", merchant: null, description: "London rent", category: "housing" },
  ];
  it("never displays another account's activity under a selected account", () => {
    expect(filterAccountActivity(txs, "foreign", "")).toEqual([txs[1]]);
    expect(filterAccountActivity(txs, "brokerage", "")).toEqual([]);
  });
  it("searches only the selected account, without changing the input", () => {
    expect(filterAccountActivity(txs, "foreign", "RENT")).toEqual([txs[1]]);
    expect(filterAccountActivity(txs, "foreign", "dining")).toEqual([]);
    expect(txs).toHaveLength(2);
  });
  it("supports all activity with no selected account", () => {
    expect(filterAccountActivity(txs, undefined, "")).toEqual(txs);
  });
  it("limits the directory activity to its filtered accounts, including an empty set", () => {
    expect(filterAccountActivity(txs, undefined, "", ["checking"])).toEqual([txs[0]]);
    expect(filterAccountActivity(txs, undefined, "", [])).toEqual([]);
  });
  it("account type and bank search scope activity without breaking merchant search", () => {
    const accounts = [
      { id: "checking", type: "checking" as const, name: "Checking", institution: "Demo Bank", mask: "1234" },
      { id: "foreign", type: "savings" as const, name: "Savings", institution: "Barclays", mask: "5678" },
    ];
    expect(directoryActivityScope(accounts, "checking", "")).toEqual({ accountIds: ["checking"], query: "" });
    expect(directoryActivityScope(accounts, "all", "Barclays")).toEqual({ accountIds: ["foreign"], query: "" });
    expect(directoryActivityScope(accounts, "checking", "coffee")).toEqual({ accountIds: ["checking"], query: "coffee" });
    expect(directoryActivityScope(accounts, "brokerage", "")).toEqual({ accountIds: [], query: "" });
  });
});
