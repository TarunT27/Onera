/**
 * Personal assistant (job type "assistant_briefing").
 *
 * Prepares a briefing in the background from the user's own data:
 *  - a snapshot: average monthly income and spending, savings rate, cash,
 *    emergency-fund months, invested value, top spending categories;
 *  - tips: where to save (recurring charges, price increases, small frequent
 *    purchases, fees, idle checking cash), where spending looks too high or
 *    doesn't add up (spending above income, rent share, possible duplicate
 *    charges), and investment concentration;
 *  - research notes on each holding from simulated price history, plus the
 *    day's biggest simulated movers;
 *  - things that need the user: transfers awaiting approval or held, approved
 *    but not executed, bank connections that need a sign-in.
 *
 * Deterministic rules, no model. Every amount is integer USD cents computed in
 * code, and every tip cites the records behind it. The briefing is returned as
 * job data (the latest one is the current snapshot); tips worth an inbox alert
 * are also persisted as insights. Observation only: the context offers no way
 * to move money, propose, approve, trade or change settings. Not financial
 * advice.
 */
import { isSpending } from "@/lib/finance/spending";
import type { Transaction } from "@/lib/types";
import type { AgentHandler } from "../context";
import type {
  Briefing,
  BriefingAttentionItem,
  BriefingMarketMover,
  BriefingResearchNote,
  BriefingSnapshot,
  BriefingTip,
} from "../types";
import { median, monthKey, usd } from "./format";
import { msg } from "@/lib/i18n/msg";

const DAY_MS = 86_400_000;

export const ASSISTANT_RULES = {
  lookbackDays: 90,
  recurring: { minCharges: 2, minGapDays: 25, maxGapDays: 35, recentDays: 45 },
  habit: {
    windowDays: 30, minVisits: 4, maxTicketCents: 2_500, cutPct: 50, minAnnualCents: 10_000, maxTips: 3,
    /** Discretionary categories only: commuting or groceries aren't "habits" to cut. */
    categories: new Set(["dining", "shopping", "entertainment", "coffee"]),
  },
  duplicate: { windowDays: 30, withinDays: 3, minCents: 1_000 },
  fees: /\b(fee|fees|overdraft|late charge|finance charge|atm withdrawal fee|service charge)\b/i,
  idleCash: { bufferMonths: 1.5, minExcessCents: 50_000, bandCents: 25_000 },
  emergency: { lowMonths: 3 },
  housingSharePct: 30,
  sector: { warningPct: 35, criticalPct: 50 },
  /** Persist a tip as an inbox insight only when it's a warning or worth at least this much a year. */
  persistMinAnnualCents: 10_000,
  singleStocksPct: 40,
  research: { historyDays: 90, notableMovePct: 8, notableDrawdownPct: -10 },
  movers: 3,
} as const;

const DISCLAIMER =
  msg("Prepared automatically by deterministic rules over synthetic data and simulated prices. General information, " +
  "not financial, tax or investment advice. Your assistant can't move money, propose, approve or trade.");

const daysBetween = (a: string, b: Date) => (b.getTime() - Date.parse(a)) / DAY_MS;
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
const merchantKey = (t: Transaction) => (t.merchant ?? t.description).trim().toLowerCase();
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (xs.length - 1));
}

const round1 = (x: number) => Math.round(x * 10) / 10;

export const assistantBriefing: AgentHandler = (ctx) => {
  const R = ASSISTANT_RULES;
  const now = ctx.now;
  const nowIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - R.lookbackDays * DAY_MS).toISOString();

  // ---------------------------------------------------------------------------
  // Data (all user-scoped through the context)
  // ---------------------------------------------------------------------------
  const accounts = ctx.read.accounts.list().filter((a) => !a.paper);
  const txns = ctx.read.transactions.list({ sinceIso, untilIso: nowIso });
  const earliest = ctx.read.transactions.earliestPostedAt();
  const windowDays = Math.max(1, Math.min(R.lookbackDays, earliest ? Math.floor(daysBetween(earliest, now)) : 1));
  const toUsd = (t: Transaction) => ctx.toUsd(t.amountCents, t.currency);

  const spending = txns.filter(isSpending);
  const income = txns.filter((t) => t.status === "posted" && t.amountCents > 0 && t.transferGroupId === null);
  const spendCents = spending.reduce((s, t) => s - toUsd(t), 0);
  const incomeCents = income.reduce((s, t) => s + toUsd(t), 0);
  const monthlySpending = Math.round((spendCents / windowDays) * 30);
  const monthlyIncome = Math.round((incomeCents / windowDays) * 30);

  const cashAccounts = accounts.filter((a) => a.type === "checking" || a.type === "savings");
  const cashCents = cashAccounts.reduce((s, a) => s + ctx.toUsd(a.balanceCents, a.currency), 0);
  const savingsAccounts = accounts.filter((a) => a.type === "savings");
  const savingsCents = savingsAccounts.reduce((s, a) => s + ctx.toUsd(a.balanceCents, a.currency), 0);
  const portfolio = ctx.read.portfolio.get();

  const last30 = spending.filter((t) => daysBetween(t.postedAt, now) <= 30);
  const last30Total = last30.reduce((s, t) => s - toUsd(t), 0);
  const byCategory = new Map<string, number>();
  for (const t of last30) byCategory.set(t.category, (byCategory.get(t.category) ?? 0) - toUsd(t));

  const snapshot: BriefingSnapshot = {
    windowDays,
    monthlyIncomeCents: monthlyIncome,
    monthlySpendingCents: monthlySpending,
    savingsRatePct: monthlyIncome > 0 ? round1(((monthlyIncome - monthlySpending) / monthlyIncome) * 100) : null,
    cashCents,
    savingsCents,
    emergencyFundMonths: monthlySpending > 0 ? round1(savingsCents / monthlySpending) : null,
    investedCents: portfolio.investedValueCents,
    topCategories: [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([category, cents]) => ({ category, cents, pct: pct(cents, last30Total) })),
  };

  const tips: (BriefingTip & { persist: boolean })[] = [];
  const tip = (t: Omit<BriefingTip, "insightId" | "oneTimeCents"> & { oneTimeCents?: number | null; persist?: boolean }) =>
    tips.push({ oneTimeCents: null, persist: true, ...t, insightId: null });

  // ---------------------------------------------------------------------------
  // Recurring charges and price increases
  // ---------------------------------------------------------------------------
  const byMerchant = new Map<string, Transaction[]>();
  for (const t of spending) {
    if (!t.merchant) continue;
    byMerchant.set(merchantKey(t), [...(byMerchant.get(merchantKey(t)) ?? []), t]);
  }
  const recurring: { merchant: string; latest: Transaction; monthlyCents: number }[] = [];
  for (const charges of byMerchant.values()) {
    const sorted = [...charges].sort((a, b) => a.postedAt.localeCompare(b.postedAt));
    if (sorted.length < R.recurring.minCharges) continue;
    const monthly = sorted.slice(1).every((t, i) => {
      const gap = (Date.parse(t.postedAt) - Date.parse(sorted[i].postedAt)) / DAY_MS;
      return gap >= R.recurring.minGapDays && gap <= R.recurring.maxGapDays;
    });
    const latest = sorted[sorted.length - 1];
    if (!monthly || daysBetween(latest.postedAt, now) > R.recurring.recentDays) continue;
    // Rent and similar fixed costs aren't "subscriptions".
    if (latest.category === "housing" || latest.category === "utilities") continue;
    recurring.push({ merchant: latest.merchant!, latest, monthlyCents: -toUsd(latest) });
  }
  recurring.sort((a, b) => b.monthlyCents - a.monthlyCents);
  const recurringKeys = new Set(recurring.map((r) => merchantKey(r.latest)));

  if (recurring.length >= 2) {
    const monthly = recurring.reduce((s, r) => s + r.monthlyCents, 0);
    tip({
      id: "recurring:total",
      kind: "save",
      severity: "info",
      title: `${plural(recurring.length, "recurring charge")}: ${usd(monthly)} a month (${usd(monthly * 12)} a year)`,
      body:
        `${recurring.map((r) => `${r.merchant} ${usd(r.monthlyCents)}`).join(", ")}. ` +
        `Cancelling one you rarely use saves its full yearly cost. Onera never cancels anything for you.`,
      annualSavingsCents: null,
      evidence: { transactionIds: recurring.map((r) => r.latest.id), monthlyCents: monthly },
      persist: false,
    });
  }

  for (const inc of ctx.read.transactions.subscriptionIncreases()) {
    tip({
      id: `price_increase:${inc.merchant.toLowerCase()}`,
      kind: "save",
      severity: inc.increasePct >= 25 ? "warning" : "info",
      title: `${inc.merchant} now costs ${usd(inc.increaseCents * 12)} more a year`,
      body:
        `The latest charge rose from ${usd(inc.previousAmountCents)} to ${usd(inc.currentAmountCents)} ` +
        `(+${inc.increasePct}%). Switching to a cheaper plan or cancelling would save about ` +
        `${usd(inc.increaseCents * 12)} a year compared with keeping it.`,
      annualSavingsCents: inc.increaseCents * 12,
      evidence: { transactionIds: inc.evidenceTransactionIds, accountIds: [inc.accountId], merchant: inc.merchant },
      // The subscription monitor already raises its own alert for this.
      persist: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Small frequent purchases ("habits")
  // ---------------------------------------------------------------------------
  const habitWindow = spending.filter((t) => daysBetween(t.postedAt, now) <= R.habit.windowDays);
  const habits = new Map<string, Transaction[]>();
  for (const t of habitWindow) {
    if (!t.merchant || recurringKeys.has(merchantKey(t)) || !R.habit.categories.has(t.category)) continue;
    habits.set(merchantKey(t), [...(habits.get(merchantKey(t)) ?? []), t]);
  }
  const habitCandidates = [...habits.values()]
    .filter((v) => v.length >= R.habit.minVisits && v.every((t) => -toUsd(t) <= R.habit.maxTicketCents))
    .map((visits) => {
      const total = visits.reduce((s, t) => s - toUsd(t), 0);
      return { visits, total, annual: Math.round((total / R.habit.windowDays) * 365) };
    })
    .filter((h) => h.annual >= R.habit.minAnnualCents)
    .sort((a, b) => b.annual - a.annual)
    .slice(0, R.habit.maxTips);
  for (const { visits, total, annual } of habitCandidates) {
    const merchant = visits[0].merchant!;
    const saving = Math.round((annual * R.habit.cutPct) / 100);
    tip({
      id: `habit:${merchantKey(visits[0])}`,
      kind: "save",
      severity: "info",
      title: `${merchant}: ${plural(visits.length, "visit")} in ${R.habit.windowDays} days adds up to about ${usd(annual)} a year`,
      body:
        `You spent ${usd(total)} at ${merchant} in the last ${R.habit.windowDays} days (typical ticket ` +
        `${usd(median(visits.map((t) => -toUsd(t))))}). Cutting it by half would save about ${usd(saving)} a year.`,
      annualSavingsCents: saving,
      evidence: { transactionIds: visits.map((t) => t.id), merchant, month: monthKey(now) },
    });
  }

  // ---------------------------------------------------------------------------
  // Things that don't add up
  // ---------------------------------------------------------------------------
  const dupWindow = spending
    .filter((t) => daysBetween(t.postedAt, now) <= R.duplicate.windowDays && -toUsd(t) >= R.duplicate.minCents)
    .sort((a, b) => a.postedAt.localeCompare(b.postedAt));
  const flagged = new Set<string>();
  for (let i = 0; i < dupWindow.length; i++) {
    for (let j = i + 1; j < dupWindow.length; j++) {
      const a = dupWindow[i];
      const b = dupWindow[j];
      if ((Date.parse(b.postedAt) - Date.parse(a.postedAt)) / DAY_MS > R.duplicate.withinDays) break;
      if (flagged.has(b.id) || merchantKey(a) !== merchantKey(b) || a.amountCents !== b.amountCents || a.accountId !== b.accountId) continue;
      flagged.add(b.id);
      tip({
        id: `duplicate:${b.id}`,
        kind: "spending",
        severity: "warning",
        title: `Possible duplicate charge: ${usd(-toUsd(b))} at ${b.merchant ?? b.description}`,
        body:
          `Two identical charges posted ${a.postedAt.slice(0, 10)} and ${b.postedAt.slice(0, 10)}. If you only made ` +
          `one purchase, ask the merchant or your bank to refund the second.`,
        annualSavingsCents: null,
        oneTimeCents: -toUsd(b),
        evidence: { transactionIds: [a.id, b.id], accountIds: [b.accountId] },
      });
    }
  }

  const fees = spending.filter((t) => R.fees.test(`${t.description} ${t.category}`));
  if (fees.length > 0) {
    const total = fees.reduce((s, t) => s - toUsd(t), 0);
    const annual = Math.round((total / windowDays) * 365);
    tip({
      id: "fees",
      kind: "save",
      severity: "warning",
      title: `${usd(total)} in fees over ${windowDays} days`,
      body: `${plural(fees.length, "charge")} look like bank or card fees (about ${usd(annual)} a year at this rate). Many can be avoided or waived on request.`,
      annualSavingsCents: annual,
      evidence: { transactionIds: fees.map((t) => t.id) },
    });
  }

  if (monthlyIncome > 0 && monthlySpending > monthlyIncome && windowDays >= 30) {
    tip({
      id: `overspend:${monthKey(now)}`,
      kind: "spending",
      severity: "warning",
      title: `Spending is ${usd(monthlySpending - monthlyIncome)} a month above income`,
      body:
        `Over the last ${windowDays} days you averaged ${usd(monthlySpending)} a month in spending against ` +
        `${usd(monthlyIncome)} of income. Moves between your own accounts are excluded.`,
      annualSavingsCents: null,
      evidence: { transactionIds: [], monthlySpendingCents: monthlySpending, monthlyIncomeCents: monthlyIncome },
    });
  }

  const housing = spending.filter((t) => t.category === "housing").reduce((s, t) => s - toUsd(t), 0);
  const housingMonthly = Math.round((housing / windowDays) * 30);
  if (monthlyIncome > 0 && pct(housingMonthly, monthlyIncome) >= R.housingSharePct) {
    tip({
      id: "housing_share",
      kind: "spending",
      severity: "info",
      title: `Housing takes ${pct(housingMonthly, monthlyIncome)}% of your income`,
      body:
        `About ${usd(housingMonthly)} a month against ${usd(monthlyIncome)} of income. A common rule of thumb is to ` +
        `keep housing near ${R.housingSharePct}%.`,
      annualSavingsCents: null,
      evidence: { transactionIds: spending.filter((t) => t.category === "housing").map((t) => t.id) },
      persist: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Cash
  // ---------------------------------------------------------------------------
  // Estimated savings yield from the interest the user actually received.
  const interest = income.filter((t) => t.category === "interest" && savingsAccounts.some((a) => a.id === t.accountId));
  const interestCents = interest.reduce((s, t) => s + toUsd(t), 0);
  const yieldPerYear = savingsCents > 0 && interestCents > 0 ? (interestCents / windowDays) * 365 / savingsCents : null;
  const buffer = Math.round(monthlySpending * R.idleCash.bufferMonths);
  // Persisted tips re-alert when their evidence changes, so figures that move with every balance change are
  // rounded to bands and the text quotes the same banded figures it hashes.
  const band = (cents: number, step: number) => Math.floor(cents / step) * step;
  for (const a of accounts.filter((x) => x.type === "checking" && x.currency === "USD")) {
    const excess = band(a.balanceCents - buffer, R.idleCash.bandCents);
    if (monthlySpending === 0 || excess < R.idleCash.minExcessCents || savingsAccounts.length === 0) continue;
    const earn = yieldPerYear ? band(Math.round(excess * yieldPerYear), 100) : null;
    tip({
      id: `idle_cash:${a.id}`,
      kind: "save",
      severity: "info",
      title: `About ${usd(excess)} in ${a.name} is more than you usually need`,
      body:
        `About ${R.idleCash.bufferMonths} months of spending is enough to keep in ${a.name}; the rest could sit in ` +
        `${savingsAccounts[0].name}` +
        (earn ? `, earning roughly ${usd(earn)} a year at the rate your savings paid recently.` : ".") +
        ` You'd make that transfer yourself; the assistant can't.`,
      annualSavingsCents: earn,
      evidence: { accountIds: [a.id, savingsAccounts[0].id], excessCents: excess },
    });
  }

  if (snapshot.emergencyFundMonths !== null && snapshot.emergencyFundMonths < R.emergency.lowMonths) {
    const months = Math.max(0, Math.round(snapshot.emergencyFundMonths));
    tip({
      id: "emergency_fund",
      kind: "save",
      severity: "warning",
      title: months < 1 ? msg("Savings cover less than a month of spending") : `Savings cover about ${months} month${months === 1 ? "" : "s"} of spending`,
      body: msg("Three to six months of spending is a common cushion for emergencies. Your briefing shows the current figures."),
      annualSavingsCents: null,
      evidence: { accountIds: savingsAccounts.map((a) => a.id), months },
    });
  }

  for (const card of accounts.filter((a) => a.type === "credit" && a.balanceCents < 0)) {
    const owed = -ctx.toUsd(card.balanceCents, card.currency);
    if (savingsCents < owed) continue;
    tip({
      id: `card_balance:${card.id}`,
      kind: "save",
      severity: "info",
      title: `${usd(owed)} owed on ${card.name}`,
      body:
        `Your savings could cover this balance. Card interest usually costs far more than savings earn, so paying it ` +
        `in full avoids interest.`,
      annualSavingsCents: null,
      evidence: { accountIds: [card.id] },
      persist: false,
    });
  }

  // ---------------------------------------------------------------------------
  // Investments (simulated prices)
  // ---------------------------------------------------------------------------
  const catalog = new Map(ctx.read.portfolio.instruments().map((i) => [i.symbol, i]));
  const invested = portfolio.accounts.filter((a) => !a.paper).flatMap((a) => a.positions);
  const investedTotal = invested.reduce((s, p) => s + p.marketValueCents, 0);
  if (investedTotal > 0) {
    // Concentration counts single companies and sector funds; broad index funds are diversification, not a bet.
    const sectorOf = (symbol: string): string | null => {
      const inst = catalog.get(symbol);
      if (!inst) return null;
      if (inst.type === "stock") return inst.sector;
      return /technology/i.test(inst.sector ?? "") ? "Technology" : null;
    };
    const bySector = new Map<string, { cents: number; symbols: Set<string>; accounts: Set<string> }>();
    for (const p of invested) {
      const sector = sectorOf(p.symbol);
      if (!sector) continue;
      const g = bySector.get(sector) ?? { cents: 0, symbols: new Set<string>(), accounts: new Set<string>() };
      g.cents += p.marketValueCents;
      g.symbols.add(p.symbol);
      g.accounts.add(p.accountId);
      bySector.set(sector, g);
    }
    const [topSector, top] = [...bySector.entries()].sort((a, b) => b[1].cents - a[1].cents)[0] ??
      ["", { cents: 0, symbols: new Set<string>(), accounts: new Set<string>() }];
    const topPct = pct(top.cents, investedTotal);
    const stocks = invested.filter((p) => catalog.get(p.symbol)?.type === "stock");
    const stocksPct = pct(stocks.reduce((s, p) => s + p.marketValueCents, 0), investedTotal);
    if (topPct >= R.sector.warningPct) {
      tip({
        id: `sector:${topSector.toLowerCase()}`,
        kind: "invest",
        severity: topPct >= R.sector.criticalPct ? "warning" : "info",
        title: `${topSector} is ${topPct}% of your invested money`,
        body:
          `${[...top.symbols].join(", ")} make up ${usd(top.cents)} of ${usd(investedTotal)} in holdings` +
          (stocksPct >= R.singleStocksPct ? `, and ${stocksPct}% of everything is in individual stocks rather than funds` : "") +
          `. A large share in one area makes results depend on it. Simulated prices; general information only.`,
        annualSavingsCents: null,
        evidence: { accountIds: [...top.accounts], symbols: [...top.symbols] },
      });
    } else if (stocksPct >= R.singleStocksPct) {
      tip({
        id: "single_stocks",
        kind: "invest",
        severity: "info",
        title: `${stocksPct}% of your invested money is in individual stocks`,
        body: `${stocks.map((p) => p.symbol).join(", ")} are single companies; funds spread money across many. Simulated prices; general information only.`,
        annualSavingsCents: null,
        evidence: { accountIds: [...new Set(stocks.map((p) => p.accountId))], symbols: stocks.map((p) => p.symbol) },
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Research notes: each holding over the last 90 days of simulated prices
  // ---------------------------------------------------------------------------
  const held = new Map<string, { accountIds: Set<string>; paperOnly: boolean; value: number; pnl: number; investedValue: number }>();
  for (const acct of portfolio.accounts) {
    for (const p of acct.positions) {
      const h = held.get(p.symbol) ?? { accountIds: new Set<string>(), paperOnly: true, value: 0, pnl: 0, investedValue: 0 };
      h.accountIds.add(acct.accountId);
      h.paperOnly &&= acct.paper;
      h.value += p.marketValueCents;
      h.pnl += p.unrealizedPnlCents;
      if (!acct.paper) h.investedValue += p.marketValueCents;
      held.set(p.symbol, h);
    }
  }
  const research: BriefingResearchNote[] = [];
  for (const [symbol, h] of held) {
    const inst = catalog.get(symbol) ?? null;
    const history = ctx.read.portfolio.history(symbol, R.research.historyDays);
    const closes = history?.points.map((pt) => pt.closeCents) ?? [];
    const last = closes[closes.length - 1];
    const change = (back: number) =>
      closes.length > back ? round1(((last - closes[closes.length - 1 - back]) / closes[closes.length - 1 - back]) * 100) : null;
    const change30 = change(30);
    const change90 = closes.length > 1 ? round1(((last - closes[0]) / closes[0]) * 100) : null;
    const returns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));
    const volatility = returns.length > 1 ? round1(stdev(returns) * Math.sqrt(252) * 100) : null;
    let peak = closes[0] ?? 0;
    let drawdown = 0;
    for (const c of closes) {
      peak = Math.max(peak, c);
      drawdown = Math.min(drawdown, (c - peak) / peak);
    }
    const maxDrawdown = closes.length > 1 ? round1(drawdown * 100) : null;
    const notable =
      (change30 !== null && Math.abs(change30) >= R.research.notableMovePct) ||
      (maxDrawdown !== null && maxDrawdown <= R.research.notableDrawdownPct);
    const kind = inst ? (inst.type === "etf" ? `${inst.sector ?? "diversified"} fund` : `${inst.sector ?? "single"} stock`) : "holding";
    const moves = [
      change30 !== null ? `${change30 >= 0 ? "up" : "down"} ${Math.abs(change30)}% over 30 days` : null,
      change90 !== null ? `${change90 >= 0 ? "up" : "down"} ${Math.abs(change90)}% over ${closes.length - 1} days` : null,
    ].filter(Boolean).join(" and ");
    research.push({
      symbol,
      name: inst?.name ?? symbol,
      sector: inst?.sector ?? null,
      instrumentType: inst?.type ?? null,
      accountIds: [...h.accountIds],
      paper: h.paperOnly,
      marketValueCents: h.value,
      unrealizedPnlCents: h.pnl,
      weightPct: h.paperOnly || investedTotal === 0 ? null : pct(h.investedValue, investedTotal),
      change30dPct: change30,
      change90dPct: change90,
      volatilityPct: volatility,
      maxDrawdownPct: maxDrawdown,
      notable,
      note:
        `${inst?.name ?? symbol} (${kind}) is ${moves || "without enough price history"} at simulated prices` +
        (volatility !== null ? `, with about ${volatility}% annualized swings` : "") +
        (maxDrawdown !== null && maxDrawdown < 0 ? ` and a deepest dip of ${Math.abs(maxDrawdown)}%` : "") +
        `. Your position is ${h.pnl >= 0 ? "up" : "down"} ${usd(Math.abs(h.pnl))} versus what you paid` +
        (h.paperOnly ? " (paper money)." : "."),
    });
  }
  research.sort((a, b) => Number(b.notable) - Number(a.notable) || b.marketValueCents - a.marketValueCents);

  const movers: BriefingMarketMover[] = [...catalog.values()]
    .flatMap((i) => {
      const q = ctx.read.portfolio.quote(i.symbol);
      return q ? [{ symbol: i.symbol, name: i.name, priceCents: q.priceCents, changePct: round1(q.changePct) }] : [];
    })
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct))
    .slice(0, R.movers);

  // ---------------------------------------------------------------------------
  // Needs your attention (links only: the assistant can't act on any of these)
  // ---------------------------------------------------------------------------
  const attention: BriefingAttentionItem[] = [];
  for (const a of ctx.read.actions.list({ states: ["AWAITING_APPROVAL", "HELD", "APPROVED"], limit: 20 })) {
    const what = `${usd(a.amountCents)} to ${a.destination.displayName}`;
    const href = `/transfers?id=${encodeURIComponent(a.id)}`;
    if (a.state === "AWAITING_APPROVAL") {
      attention.push({ id: `approval:${a.id}`, kind: "approval", title: `${what} is waiting for your approval`,
        detail: msg("Review the exact details on the transfer card before approving."), href, evidence: { actionIds: [a.id] } });
    } else if (a.state === "HELD") {
      attention.push({ id: `held:${a.id}`, kind: "held", title: `${what} is on hold`,
        detail: `Held for ${a.holdReasons.join(", ") || "a policy check"}.`, href, evidence: { actionIds: [a.id] } });
    } else {
      attention.push({ id: `approved:${a.id}`, kind: "approved", title: `${what} is approved but not executed`,
        detail: msg("Execute it from the transfer card, or edit it to withdraw the approval."), href, evidence: { actionIds: [a.id] } });
    }
  }
  for (const c of ctx.read.connections.list()) {
    if (c.status !== "login_required" && c.status !== "error") continue;
    attention.push({
      id: `connection:${c.id}`,
      kind: "connection",
      title: `${c.institutionName} ${c.status === "login_required" ? "needs you to sign in again" : "couldn't sync"}`,
      detail: c.lastError ?? msg("Reconnect it from the Accounts page (simulated connection)."),
      href: "/accounts",
      evidence: { connectionIds: [c.id] },
    });
  }

  // ---------------------------------------------------------------------------
  // Persist inbox-worthy tips; assemble the briefing
  // ---------------------------------------------------------------------------
  for (const t of tips) {
    const worthAlert = t.severity !== "info" || (t.annualSavingsCents ?? 0) >= R.persistMinAnnualCents;
    if (!t.persist || !worthAlert) continue;
    const { id } = ctx.insights.upsert({
      type: "assistant_tip",
      severity: t.severity,
      title: t.title,
      body: `${t.body}\n\n${DISCLAIMER}`,
      evidence: { ...t.evidence, tipKind: t.kind, annualSavingsCents: t.annualSavingsCents ?? undefined },
      dedupeKey: `tip:${t.id}`,
    });
    t.insightId = id;
  }

  const potential = tips.reduce((s, t) => s + (t.annualSavingsCents ?? 0), 0);
  const kindRank = { spending: 0, save: 1, invest: 2 } as const;
  const sevRank = { critical: 0, warning: 1, info: 2 } as const;
  const ordered = tips
    .map(({ persist: _persist, ...t }) => t)
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity] || kindRank[a.kind] - kindRank[b.kind] ||
      (b.annualSavingsCents ?? 0) - (a.annualSavingsCents ?? 0));

  const parts = [
    potential > 0 ? `You could save about ${usd(potential)} a year` : `${plural(ordered.length, "tip")} for you`,
    attention.length > 0 ? `${plural(attention.length, "thing")} need${attention.length === 1 ? "s" : ""} your attention` : null,
    research.some((r) => r.notable) ? `${plural(research.filter((r) => r.notable).length, "holding")} moved notably` : null,
  ].filter(Boolean);

  const briefing: Briefing = {
    agentId: "personal_assistant",
    generatedAt: nowIso,
    headline: parts.join(" · "),
    snapshot,
    potentialAnnualSavingsCents: potential,
    tips: ordered,
    research,
    movers,
    attention,
    disclaimer: DISCLAIMER,
    deterministic: true,
  };

  return {
    summary:
      `${plural(ordered.length, "tip")} (${usd(potential)}/yr potential), ${plural(research.length, "research note")}, ` +
      `${plural(attention.length, "attention item")}`,
    data: { briefing },
  };
};
