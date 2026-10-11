/**
 * Per-user watchlist: symbols added from search, shown on Trade after the
 * built-in catalog. Session user only; nothing here trades.
 */
import type { DB } from "@/lib/db";
import { badRequest, notFound } from "@/lib/errors";
import { msg, tpl } from "@/lib/i18n/msg";
import type { UserId } from "@/lib/types";
import { instrumentFor } from "./assets";
import { findInstrument, normalizeSymbol } from "./instruments";
import type { Instrument } from "./types";

export const MAX_WATCHLIST = 50;

/** Symbols the user added, oldest first. */
export function listWatchlist(db: DB, userId: UserId): string[] {
  return (db.prepare("SELECT symbol FROM watchlist WHERE user_id = ? ORDER BY added_at, symbol").all(userId) as
    { symbol: string }[]).map((r) => r.symbol);
}

/** Watchlist symbols that still resolve to an instrument (catalog symbols are always listed separately). */
export function watchlistInstruments(db: DB, userId: UserId): Instrument[] {
  return listWatchlist(db, userId)
    .map((s) => instrumentFor(db, s))
    .filter((i): i is Instrument => i !== null && !findInstrument(i.symbol));
}

export function addToWatchlist(db: DB, userId: UserId, input: unknown): string[] {
  const raw = (input as { symbol?: unknown } | null)?.symbol;
  if (typeof raw !== "string" || !/^[A-Za-z][A-Za-z.]{0,9}$/.test(raw.trim())) throw badRequest(msg("Invalid symbol"));
  const symbol = normalizeSymbol(raw);
  if (!instrumentFor(db, symbol)) throw notFound("Instrument");
  const current = listWatchlist(db, userId);
  if (!current.includes(symbol) && current.length >= MAX_WATCHLIST) {
    throw badRequest(tpl("Your watchlist holds up to {max} symbols. Remove one first.", { max: MAX_WATCHLIST }));
  }
  db.prepare("INSERT OR IGNORE INTO watchlist (user_id, symbol, added_at) VALUES (?, ?, ?)")
    .run(userId, symbol, new Date().toISOString());
  return listWatchlist(db, userId);
}

export function removeFromWatchlist(db: DB, userId: UserId, symbol: string): string[] {
  db.prepare("DELETE FROM watchlist WHERE user_id = ? AND symbol = ?").run(userId, normalizeSymbol(symbol));
  return listWatchlist(db, userId);
}
