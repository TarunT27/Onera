/**
 * Public surface of the markets module (simulated quotes, portfolio, paper
 * trading). Other modules import only from "@/lib/markets".
 *
 * PLACEHOLDER: implementations are filled in by the markets workstream.
 * getPortfolio returns an empty portfolio until then so net worth still works.
 */
import type { DB } from "@/lib/db";
import type { UserId } from "@/lib/types";
import type { Instrument, Portfolio, Quote } from "./types";

export type * from "./types";

export function listInstruments(): Instrument[] {
  return [];
}

export function getQuote(_symbol: string, _now?: Date): Quote | null {
  return null;
}

export function getPortfolio(_db: DB, userId: UserId, now: Date = new Date()): Portfolio {
  return { userId, accounts: [], investedValueCents: 0, asOf: now.toISOString(), quotesSource: "simulated" };
}
