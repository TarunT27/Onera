/** Public types for market data, portfolios and paper trading. Owned by the markets module. */
import type { UserId } from "@/lib/types";

export type InstrumentType = "stock" | "etf";

export interface Instrument {
  symbol: string;
  name: string;
  type: InstrumentType;
  sector: string | null;
}

export interface Quote {
  symbol: string;
  priceCents: number;
  previousCloseCents: number;
  changePct: number;
  asOf: string;
  source: "simulated";
  delayedMinutes: number;
}

export interface Position {
  accountId: string;
  symbol: string;
  /** Shares × 1,000,000 (fractional shares as integers). */
  quantityMicros: number;
  costBasisCents: number;
  priceCents: number;
  marketValueCents: number;
  unrealizedPnlCents: number;
  /** Share of this account's positions value, 0–100. */
  weightPct: number;
}

export interface PortfolioAccount {
  accountId: string;
  name: string;
  /** True only for paper accounts with the "trade" capability. */
  tradable: boolean;
  paper: boolean;
  cashCents: number;
  positionsValueCents: number;
  totalCents: number;
  positions: Position[];
}

export interface Portfolio {
  userId: UserId;
  accounts: PortfolioAccount[];
  /** Positions value across non-paper accounts (counted in net worth). */
  investedValueCents: number;
  asOf: string;
  quotesSource: "simulated";
}
