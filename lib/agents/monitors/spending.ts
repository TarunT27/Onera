/**
 * Spending monitor (job type "spending_review"). Deterministic rules, no model:
 *
 *  - Category spike: last-30-day spending in a category is ≥ 1.5× its trailing
 *    30-day average AND at least $100 above it. The baseline uses up to three
 *    prior 30-day windows that the user's history fully covers.
 *  - Unusually large transaction: a charge in the last 30 days that is ≥ 3× the
 *    median of at least two earlier charges in the same category, and ≥ $200.
 *
 * Only posted outflows that are not internal transfers count (isSpending), and
 * every amount is converted to USD with the dated demo FX rate first.
 */
import { isSpending } from "@/lib/finance/spending";
import type { Transaction } from "@/lib/types";
import type { AgentHandler } from "../context";
import { median, monthKey, titleCase, usd } from "./format";

const DAY_MS = 86_400_000;

export const SPENDING_RULES = {
  windowDays: 30,
  baselineWindows: 3,
  spikeRatio: 1.5,
  spikeMinIncreaseCents: 10_000,
  spikeWarningRatio: 2,
  spikeWarningIncreaseCents: 50_000,
  largeTxMultiple: 3,
  largeTxMinCents: 20_000,
  largeTxMinHistory: 2,
} as const;

interface SpendItem {
  t: Transaction;
  /** Positive USD cents spent. */
  usdCents: number;
  /** 0 = current window, k = k-th prior window. */
  window: number;
}

export const spendingReview: AgentHandler = (ctx) => {
  const R = SPENDING_RULES;
  const nowMs = ctx.now.getTime();
  const windowMs = R.windowDays * DAY_MS;
  const sinceIso = new Date(nowMs - windowMs * (R.baselineWindows + 1)).toISOString();

  const items: SpendItem[] = ctx.read.transactions
    .list({ sinceIso, untilIso: ctx.now.toISOString() })
    .filter(isSpending) // posted outflows, internal transfer legs (transferGroupId) excluded
    .map((t) => ({
      t,
      usdCents: -ctx.toUsd(t.amountCents, t.currency),
      window: Math.floor((nowMs - Date.parse(t.postedAt)) / windowMs),
    }))
    .filter((i) => i.window >= 0 && i.window <= R.baselineWindows);

  // Prior windows fully covered by the user's history (so a short history doesn't fake a spike).
  const earliest = ctx.read.transactions.earliestPostedAt();
  const earliestMs = earliest ? Date.parse(earliest) : nowMs;
  let covered = 0;
  for (let k = 1; k <= R.baselineWindows; k++) {
    if (earliestMs <= nowMs - (k + 1) * windowMs) covered = k;
  }

  const byCategory = new Map<string, SpendItem[]>();
  for (const i of items) byCategory.set(i.t.category, [...(byCategory.get(i.t.category) ?? []), i]);

  let spikes = 0;
  let large = 0;
  for (const [category, list] of [...byCategory.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const current = list.filter((i) => i.window === 0);
    if (current.length === 0) continue;
    const currentCents = current.reduce((s, i) => s + i.usdCents, 0);

    // --- Category spike -----------------------------------------------------
    if (covered > 0) {
      const baselineTotal = list.filter((i) => i.window >= 1 && i.window <= covered).reduce((s, i) => s + i.usdCents, 0);
      const averageCents = Math.round(baselineTotal / covered);
      const increase = currentCents - averageCents;
      if (averageCents > 0 && currentCents >= averageCents * R.spikeRatio && increase >= R.spikeMinIncreaseCents) {
        const ratio = currentCents / averageCents;
        const pct = Math.round((ratio - 1) * 100);
        ctx.insights.upsert({
          type: "spending_spike",
          severity: ratio >= R.spikeWarningRatio || increase >= R.spikeWarningIncreaseCents ? "warning" : "info",
          title: `${titleCase(category)} spending up ${pct}% vs your trailing average`,
          body:
            `You spent ${usd(currentCents)} on ${category} in the last ${R.windowDays} days, versus an average of ` +
            `${usd(averageCents)} per ${R.windowDays} days over the previous ${covered * R.windowDays} days. ` +
            `Internal transfers between your own accounts are excluded and foreign-currency amounts are converted ` +
            `at the demo FX rate. Deterministic rule on synthetic data: at least ${R.spikeRatio}× and ` +
            `${usd(R.spikeMinIncreaseCents)} above the trailing average.`,
          evidence: { transactionIds: current.map((i) => i.t.id), category, currentCents },
          dedupeKey: `spike:${category}:${monthKey(ctx.now)}`,
        });
        spikes++;
      }
    }

    // --- Unusually large single transactions --------------------------------
    const history = list.filter((i) => i.window >= 1).map((i) => i.usdCents);
    if (history.length < R.largeTxMinHistory) continue;
    const typical = median(history);
    for (const i of current) {
      if (i.usdCents < R.largeTxMinCents || i.usdCents < typical * R.largeTxMultiple) continue;
      const where = i.t.merchant ?? i.t.description;
      ctx.insights.upsert({
        type: "large_transaction",
        severity: "warning",
        title: `Unusually large ${category} charge: ${usd(i.usdCents)} at ${where}`,
        body:
          `This charge is about ${Math.round(i.usdCents / Math.max(typical, 1))}× your typical ${category} charge of ` +
          `${usd(typical)} (median of ${history.length} earlier charges). If you don't recognise it, contact your bank. ` +
          `Deterministic rule on synthetic data: at least ${R.largeTxMultiple}× the category median and ` +
          `${usd(R.largeTxMinCents)} or more.`,
        evidence: { transactionIds: [i.t.id], category, amountCents: i.usdCents },
        dedupeKey: `large_tx:${i.t.id}`,
      });
      large++;
    }
  }

  return {
    summary: `${spikes} category spike(s) and ${large} unusually large transaction(s) in the last ${R.windowDays} days`,
    data: { spikes, largeTransactions: large, baselineWindows: covered, transactionsReviewed: items.length },
  };
};
