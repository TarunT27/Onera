/**
 * Portfolio valuation at simulated prices. Covers every brokerage account the
 * user has: imported (view-only) holdings and paper trading accounts. Only
 * non-paper positions count toward investedValueCents (and so net worth).
 */
import type { DB } from "@/lib/db";
import { toAccount, type AccountRow } from "@/lib/db/rows";
import type { UserId } from "@/lib/types";
import { MICROS_PER_SHARE, mulDiv, valueCents } from "./math";
import { isTradableAccount } from "./policy";
import type { PositionRow } from "./rows";
import { simulateQuote } from "./simulator";
import { SIMULATED_PRICES_DISCLAIMER, type Portfolio, type PortfolioAccount, type Position } from "./types";
import { msg } from "@/lib/i18n/msg";

export function computePortfolio(db: DB, userId: UserId, now: Date): Portfolio {
  const accounts = (db
    .prepare("SELECT * FROM accounts WHERE user_id = ? AND type = 'brokerage' ORDER BY is_paper, id")
    .all(userId) as AccountRow[]).map(toAccount);
  const rows = db
    .prepare("SELECT * FROM positions WHERE user_id = ? ORDER BY account_id, symbol")
    .all(userId) as PositionRow[];

  const prices = new Map<string, number | null>();
  const priceOf = (symbol: string) => {
    if (!prices.has(symbol)) prices.set(symbol, simulateQuote(symbol, now)?.priceCents ?? null);
    return prices.get(symbol)!;
  };

  const result: PortfolioAccount[] = accounts.map((a) => {
    const positions: Position[] = rows
      .filter((r) => r.account_id === a.id)
      .map((r) => {
        const averageCostCents = mulDiv(r.cost_basis_cents, MICROS_PER_SHARE, r.quantity_micros, "round");
        const priceCents = priceOf(r.symbol) ?? averageCostCents;
        const marketValueCents = valueCents(r.quantity_micros, priceCents);
        return {
          accountId: a.id,
          symbol: r.symbol,
          quantityMicros: r.quantity_micros,
          costBasisCents: r.cost_basis_cents,
          averageCostCents,
          priceCents,
          marketValueCents,
          unrealizedPnlCents: marketValueCents - r.cost_basis_cents,
          weightPct: 0,
        };
      });
    const positionsValueCents = positions.reduce((s, p) => s + p.marketValueCents, 0);
    for (const p of positions) {
      p.weightPct = positionsValueCents > 0 ? Math.round((p.marketValueCents * 10_000) / positionsValueCents) / 100 : 0;
    }
    positions.sort((x, y) => y.marketValueCents - x.marketValueCents || x.symbol.localeCompare(y.symbol));
    return {
      accountId: a.id,
      name: a.name,
      institution: a.institution,
      mask: a.mask,
      tradable: isTradableAccount(a),
      paper: a.paper,
      label: a.paper ? msg("Paper trading (simulated)") : msg("Imported holdings (view-only)"),
      cashCents: a.balanceCents,
      positionsValueCents,
      totalCents: a.balanceCents + positionsValueCents,
      positions,
    };
  });

  return {
    userId,
    accounts: result,
    investedValueCents: result.filter((a) => !a.paper).reduce((s, a) => s + a.positionsValueCents, 0),
    paperValueCents: result.filter((a) => a.paper).reduce((s, a) => s + a.totalCents, 0),
    asOf: now.toISOString(),
    quotesSource: "simulated",
    disclaimer: SIMULATED_PRICES_DISCLAIMER,
  };
}
