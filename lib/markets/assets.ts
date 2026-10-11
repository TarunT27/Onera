/**
 * Instrument lookup and search beyond the built-in catalog.
 *
 * Simulated mode: only the 12 catalog symbols exist (the simulator has no
 * prices for anything else). Alpaca mode: every active, tradable US stock and
 * ETF Alpaca lists, cached in market_assets and refreshed about once a day.
 * Policy still rejects anything that is not a stock or ETF found here.
 */
import type { DB } from "@/lib/db";
import { alpacaConfigured, listAssets } from "./alpaca";
import { catalogInstruments, findInstrument, normalizeSymbol } from "./instruments";
import type { Instrument, InstrumentType } from "./types";

const ASSETS_REFRESH_MS = 24 * 60 * 60_000;
const SEARCH_LIMIT = 20;
const SYMBOL = /^[A-Z][A-Z.]{0,9}$/;
/**
 * Leveraged and inverse funds ("2X Long", "-1X", "UltraPro", "Daily Target") behave like margin
 * or shorting, which Onera never offers. They are left out of the searchable list.
 */
const LEVERAGED = /(?:^|[\s(])[-–]?\d+(?:\.\d+)?x\b|\bleveraged\b|\binverse\b|\bultra(?:pro|short)\b|\bdaily target\b/i;

interface AssetRow {
  symbol: string;
  name: string;
  exchange: string | null;
  type: InstrumentType;
  fractionable: number;
}

function toInstrument(r: AssetRow): Instrument {
  return { symbol: r.symbol, name: r.name, type: r.type, sector: null, exchange: r.exchange };
}

/** Alpaca doesn't flag funds; its asset names do ("… ETF", "… ETN"). Display only: both types are allowed. */
function typeFromName(name: string): InstrumentType {
  return /\b(ETF|ETN)\b/i.test(name) ? "etf" : "stock";
}

const inFlight = new WeakMap<DB, Promise<void>>();

/** Loads Alpaca's tradable US equities into market_assets (once a day). A no-op in simulated mode. */
export function refreshAssets(db: DB, opts: { force?: boolean } = {}): Promise<void> {
  if (!alpacaConfigured()) return Promise.resolve();
  const state = db.prepare("SELECT fetched_at FROM market_data_state WHERE key = 'assets'").get() as
    { fetched_at: string } | undefined;
  if (!opts.force && state && Date.now() - new Date(state.fetched_at).getTime() < ASSETS_REFRESH_MS) {
    return Promise.resolve();
  }
  const running = inFlight.get(db);
  if (running) return running;
  const p = (async () => {
    const assets = await listAssets();
    const ts = new Date().toISOString();
    db.transaction(() => {
      db.prepare("DELETE FROM market_assets").run();
      const ins = db.prepare(
        `INSERT OR REPLACE INTO market_assets (symbol, name, exchange, type, fractionable, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const a of assets) {
        const symbol = normalizeSymbol(a.symbol);
        if (!a.tradable || a.status !== "active" || !SYMBOL.test(symbol)) continue;
        const name = (a.name ?? symbol).trim() || symbol;
        if (LEVERAGED.test(name)) continue;
        ins.run(symbol, name, a.exchange ?? null, typeFromName(name), a.fractionable ? 1 : 0, ts);
      }
      db.prepare(
        `INSERT INTO market_data_state (key, value, fetched_at) VALUES ('assets', '{}', ?)
         ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at`,
      ).run(ts);
    }).immediate();
  })().finally(() => inFlight.delete(db));
  inFlight.set(db, p);
  return p;
}

/**
 * The instrument for a symbol: the built-in catalog first, then (Alpaca mode) Alpaca's
 * tradable US equities. Null when it is unknown or not tradable.
 */
export function instrumentFor(db: DB | undefined, symbol: string): Instrument | null {
  const sym = normalizeSymbol(symbol);
  const builtIn = findInstrument(sym);
  if (builtIn || !db || !alpacaConfigured()) return builtIn;
  const row = db.prepare("SELECT * FROM market_assets WHERE symbol = ?").get(sym) as AssetRow | undefined;
  return row ? toInstrument(row) : null;
}

/**
 * Up to 20 instruments matching `query` by ticker or name, best first: exact ticker, ticker
 * prefix, name word prefix, then name contains. Catalog symbols rank ahead on ties.
 */
export function searchInstruments(db: DB, query: string): Instrument[] {
  const q = query.trim();
  if (!q) return [];
  const upper = q.toUpperCase();
  const lower = q.toLowerCase();
  const rank = (i: Instrument): number => {
    const name = i.name.toLowerCase();
    if (i.symbol === upper) return 0;
    if (i.symbol.startsWith(upper)) return 1;
    if (name.startsWith(lower) || name.includes(` ${lower}`)) return 2;
    if (name.includes(lower)) return 3;
    return -1;
  };
  const hits = new Map<string, { i: Instrument; r: number; builtIn: boolean }>();
  for (const i of catalogInstruments()) {
    const r = rank(i);
    if (r >= 0) hits.set(i.symbol, { i, r, builtIn: true });
  }
  if (alpacaConfigured()) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const rows = db.prepare(
      `SELECT * FROM market_assets
       WHERE symbol LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\'
       ORDER BY (symbol = ?) DESC, (symbol LIKE ? ESCAPE '\\') DESC, length(symbol), symbol
       LIMIT 200`,
    ).all(like, like, upper, `${upper.replace(/[\\%_]/g, (c) => `\\${c}`)}%`) as AssetRow[];
    for (const row of rows) {
      if (hits.has(row.symbol)) continue;
      const i = toInstrument(row);
      const r = rank(i);
      if (r >= 0) hits.set(i.symbol, { i, r, builtIn: false });
    }
  }
  return [...hits.values()]
    .sort((a, b) => a.r - b.r || Number(b.builtIn) - Number(a.builtIn) || a.i.symbol.length - b.i.symbol.length
      || a.i.symbol.localeCompare(b.i.symbol))
    .slice(0, SEARCH_LIMIT)
    .map((h) => h.i);
}
