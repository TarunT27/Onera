/**
 * Portfolio valuation at current prices (simulated, or cached Alpaca quotes).
 * Covers every brokerage account the user has: imported (view-only) holdings,
 * Onera paper accounts and a linked Alpaca account (positions and cash mirrored
 * from the broker). Only non-paper positions count toward investedValueCents
 * (and so net worth); Alpaca live counts, Alpaca paper does not.
 */
import type { DB } from "@/lib/db";
import { toAccount, type AccountRow } from "@/lib/db/rows";
import type { UserId } from "@/lib/types";
import { pricesDisclaimer, quoteFor, quoteSource } from "./marketdata";
import { MICROS_PER_SHARE, mulDiv, valueCents } from "./math";
import { isTradableAccount } from "./policy";
import { venueOf, type PositionRow } from "./rows";
import { brokerLinkFor, brokerTermsFor } from "./store";
import { SIMULATED_PRICES_DISCLAIMER, type OrderVenue, type Portfolio, type PortfolioAccount, type Position } from "./types";
import { msg } from "@/lib/i18n/msg";

function accountLabel(venue: OrderVenue | null, paper: boolean): string {
  if (venue === "alpaca_paper") return msg("Alpaca paper trading");
  if (venue === "alpaca_live") return msg("Alpaca LIVE — real money");
  return paper ? msg("Paper trading (simulated)") : msg("Imported holdings (view-only)");
}

export function computePortfolio(db: DB, userId: UserId, now: Date): Portfolio {
  const accounts = (db
    .prepare("SELECT * FROM accounts WHERE user_id = ? AND type = 'brokerage' ORDER BY is_paper, id")
    .all(userId) as AccountRow[]).map(toAccount);
  const rows = db
    .prepare("SELECT * FROM positions WHERE user_id = ? ORDER BY account_id, symbol")
    .all(userId) as PositionRow[];

  const prices = new Map<string, number | null>();
  const priceOf = (symbol: string) => {
    if (!prices.has(symbol)) prices.set(symbol, quoteFor(db, symbol, now)?.priceCents ?? null);
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
    const link = brokerLinkFor(db, userId, a.id);
    const tradable = isTradableAccount(a, brokerTermsFor(db, userId, a.id));
    const venue = link ? venueOf(link) : a.paper ? "onera_paper" : null;
    return {
      accountId: a.id,
      name: a.name,
      institution: a.institution,
      mask: a.mask,
      tradable,
      paper: a.paper,
      venue,
      label: accountLabel(venue, a.paper),
      cashCents: a.balanceCents,
      buyingPowerCents: a.availableCents,
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
    quotesSource: quoteSource(),
    disclaimer: pricesDisclaimer(),
  };
}
