/**
 * Instrument catalog for the market simulator. Real tickers are used only as
 * identifiers; every price is simulated. Stocks and ETFs only — no options,
 * margin, leverage or shorting.
 */
import type { Instrument } from "./types";

export interface SimParams {
  /** Price at the simulator epoch, in cents. */
  basePriceCents: number;
  /** Daily log-return volatility (e.g. 0.012 = 1.2%). */
  dailyVol: number;
  /** Long-run annual drift of the log price. */
  annualDrift: number;
}

interface CatalogEntry extends Instrument {
  sim: SimParams;
}

const CATALOG: CatalogEntry[] = [
  { symbol: "VTI", name: "Vanguard Total Stock Market ETF", type: "etf", sector: "Broad market",
    sim: { basePriceCents: 23_500, dailyVol: 0.009, annualDrift: 0.07 } },
  { symbol: "VOO", name: "Vanguard S&P 500 ETF", type: "etf", sector: "Large cap",
    sim: { basePriceCents: 43_000, dailyVol: 0.009, annualDrift: 0.07 } },
  { symbol: "QQQ", name: "Invesco QQQ Trust", type: "etf", sector: "Technology-heavy",
    sim: { basePriceCents: 40_500, dailyVol: 0.012, annualDrift: 0.09 } },
  { symbol: "SCHD", name: "Schwab U.S. Dividend Equity ETF", type: "etf", sector: "Dividend",
    sim: { basePriceCents: 7_600, dailyVol: 0.008, annualDrift: 0.04 } },
  { symbol: "BND", name: "Vanguard Total Bond Market ETF", type: "etf", sector: "Bonds",
    sim: { basePriceCents: 7_300, dailyVol: 0.003, annualDrift: 0.0 } },
  { symbol: "AAPL", name: "Apple Inc.", type: "stock", sector: "Technology",
    sim: { basePriceCents: 18_500, dailyVol: 0.015, annualDrift: 0.08 } },
  { symbol: "MSFT", name: "Microsoft Corporation", type: "stock", sector: "Technology",
    sim: { basePriceCents: 37_500, dailyVol: 0.014, annualDrift: 0.08 } },
  { symbol: "NVDA", name: "NVIDIA Corporation", type: "stock", sector: "Technology",
    sim: { basePriceCents: 9_000, dailyVol: 0.026, annualDrift: 0.15 } },
  { symbol: "AMZN", name: "Amazon.com, Inc.", type: "stock", sector: "Consumer discretionary",
    sim: { basePriceCents: 15_500, dailyVol: 0.017, annualDrift: 0.08 } },
  { symbol: "GOOGL", name: "Alphabet Inc. Class A", type: "stock", sector: "Communication services",
    sim: { basePriceCents: 14_000, dailyVol: 0.016, annualDrift: 0.08 } },
  { symbol: "JPM", name: "JPMorgan Chase & Co.", type: "stock", sector: "Financials",
    sim: { basePriceCents: 17_000, dailyVol: 0.013, annualDrift: 0.06 } },
  { symbol: "KO", name: "The Coca-Cola Company", type: "stock", sector: "Consumer staples",
    sim: { basePriceCents: 6_000, dailyVol: 0.008, annualDrift: 0.03 } },
];

const BY_SYMBOL = new Map(CATALOG.map((c) => [c.symbol, c]));

export function normalizeSymbol(symbol: string): string {
  return symbol.trim().toUpperCase();
}

export function catalogInstruments(): Instrument[] {
  return CATALOG.map(({ symbol, name, type, sector }) => ({ symbol, name, type, sector }));
}

export function findInstrument(symbol: string): Instrument | null {
  const c = BY_SYMBOL.get(normalizeSymbol(symbol));
  return c ? { symbol: c.symbol, name: c.name, type: c.type, sector: c.sector } : null;
}

export function simParams(symbol: string): SimParams | null {
  return BY_SYMBOL.get(normalizeSymbol(symbol))?.sim ?? null;
}
