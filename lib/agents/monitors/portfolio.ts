/**
 * Portfolio monitor (job type "portfolio_review"). Deterministic rules over
 * the simulated portfolio from lib/markets:
 *
 *  - Concentration: a single position above 25% of its account's positions value.
 *  - Large daily move: a held symbol moved 5% or more since the previous close.
 *
 * Observation only — it cannot place, propose or approve orders. Not
 * investment advice.
 */
import type { AgentHandler } from "../context";
import { dayKey, usd } from "./format";

export const PORTFOLIO_RULES = {
  concentrationPct: 25,
  concentrationCriticalPct: 50,
  /** Re-alert only when the weight crosses a 5-point band. */
  concentrationBandPct: 5,
  dailyMovePct: 5,
  dailyMoveCriticalPct: 10,
} as const;

export const portfolioReview: AgentHandler = (ctx) => {
  const R = PORTFOLIO_RULES;
  const portfolio = ctx.read.portfolio.get();
  let concentrated = 0;
  let moves = 0;
  let positions = 0;

  for (const account of portfolio.accounts) {
    const label = account.paper ? `${account.name} (paper)` : account.name;
    for (const p of account.positions) {
      positions++;
      if (p.weightPct > R.concentrationPct) {
        const band = Math.floor(p.weightPct / R.concentrationBandPct) * R.concentrationBandPct;
        ctx.insights.upsert({
          type: "portfolio_concentration",
          severity: p.weightPct > R.concentrationCriticalPct ? "critical" : "warning",
          title: `${p.symbol} is ${p.weightPct.toFixed(1)}% of ${label}`,
          body:
            `${p.symbol} (${usd(p.marketValueCents)}) is more than ${R.concentrationPct}% of the positions in ${label}. ` +
            `A single holding this large makes the account sensitive to one company or fund. Simulated prices; ` +
            `informational, not investment advice.`,
          evidence: { accountIds: [account.accountId], symbols: [p.symbol], weightBandPct: band },
          dedupeKey: `concentration:${account.accountId}:${p.symbol}`,
        });
        concentrated++;
      }

      const quote = ctx.read.portfolio.quote(p.symbol);
      if (quote && Math.abs(quote.changePct) >= R.dailyMovePct) {
        const direction = quote.changePct > 0 ? "up" : "down";
        const dayChangeCents = Math.round(p.marketValueCents - (p.marketValueCents * 100) / (100 + quote.changePct));
        ctx.insights.upsert({
          type: "portfolio_daily_move",
          severity: Math.abs(quote.changePct) >= R.dailyMoveCriticalPct ? "critical" : "warning",
          title: `${p.symbol} is ${direction} ${Math.abs(quote.changePct).toFixed(1)}% today in ${label}`,
          body:
            `${p.symbol} moved from ${usd(quote.previousCloseCents)} to ${usd(quote.priceCents)} ` +
            `(${quote.source} quote, delayed ${quote.delayedMinutes} min). Your position changed by about ` +
            `${usd(dayChangeCents)}. Informational, not investment advice.`,
          evidence: {
            accountIds: [account.accountId],
            symbols: [p.symbol],
            direction,
            changePctRounded: Math.round(quote.changePct),
            quoteDate: dayKey(new Date(quote.asOf)),
          },
          dedupeKey: `daily_move:${account.accountId}:${p.symbol}:${dayKey(new Date(quote.asOf))}`,
        });
        moves++;
      }
    }
  }

  return {
    summary: `${positions} position(s) reviewed: ${concentrated} concentrated, ${moves} large daily move(s)`,
    data: { positions, concentrated, dailyMoves: moves },
  };
};
