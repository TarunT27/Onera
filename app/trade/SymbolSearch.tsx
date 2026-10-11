"use client";

import { useEffect, useRef, useState } from "react";
import { MagnifyingGlass, Star, X } from "@phosphor-icons/react";
import type { InstrumentSearchResult } from "@/lib/markets";
import { api } from "../components/api";
import { ErrorBox } from "../components/ErrorBox";
import { useT } from "../components/I18nContext";

interface SearchResponse {
  results: InstrumentSearchResult[];
  /** "built_in": simulated mode, only Onera's list. "us_equities": every tradable US stock/ETF at Alpaca. */
  scope: "built_in" | "us_equities";
}

/**
 * Ticker/company search for the Trade watchlist. Picking a result opens its chart and ticket;
 * the star adds it to (or removes it from) the user's watchlist. While a query is typed, the
 * results replace the watchlist rows; Escape or the clear button brings the watchlist back.
 */
export function SymbolSearch({
  onSelect,
  onWatchlistChange,
  children,
}: {
  onSelect: (symbol: string) => void;
  onWatchlistChange: () => void;
  /** The normal watchlist, shown when the search box is empty. */
  children: React.ReactNode;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;

  // Debounced search; only the latest query's answer is shown.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(() => {
      api.get<SearchResponse>(`/api/markets/search?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (!cancelled) {
            setData(res);
            setError(null);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) setError(err);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  function clear() {
    setQuery("");
    inputRef.current?.focus();
  }

  function pick(symbol: string) {
    onSelect(symbol);
    setQuery("");
  }

  async function toggleWatch(r: InstrumentSearchResult) {
    setBusy(r.symbol);
    setError(null);
    try {
      if (r.inWatchlist) await api.del(`/api/markets/watchlist/${encodeURIComponent(r.symbol)}`);
      else await api.post("/api/markets/watchlist", { symbol: r.symbol });
      setData((d) => d && {
        ...d,
        results: d.results.map((x) => (x.symbol === r.symbol ? { ...x, inWatchlist: !r.inWatchlist } : x)),
      });
      onWatchlistChange();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="watch-search" role="search">
        <MagnifyingGlass size={15} aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder={t("Search stocks & ETFs")}
          aria-label={t("Search stocks and ETFs by ticker or company name")}
          maxLength={40}
          autoComplete="off"
          spellCheck={false}
        />
        {searching && (
          <button type="button" className="icon-btn" onClick={clear} aria-label={t("Clear search")}>
            <X size={14} aria-hidden />
          </button>
        )}
      </div>

      {!searching ? (
        children
      ) : (
        <div className="search-results" aria-live="polite" aria-busy={loading}>
          <ErrorBox error={error} onDismiss={() => setError(null)} />
          {data?.scope === "built_in" && (
            <p className="search-note">
              {t("Searching Onera's built-in list. Add Alpaca keys to search every US stock and ETF.")}
            </p>
          )}
          {loading && !data ? (
            <p className="search-note">{t("Searching…")}</p>
          ) : data && data.results.length === 0 ? (
            <p className="search-note">{t("No stocks or ETFs match “{query}”.", { query: query.trim() })}</p>
          ) : (
            <div role="list" aria-label={t("Search results")}>
              {data?.results.map((r) => (
                <div role="listitem" key={r.symbol} className="search-row">
                  <button type="button" className="watch-row" onClick={() => pick(r.symbol)}>
                    <span className="watch-name">
                      <strong>
                        {r.symbol}
                        <span className="search-meta">
                          {r.type === "etf" ? t("ETF") : t("Stock")}
                          {r.exchange ? ` · ${r.exchange}` : ""}
                        </span>
                      </strong>
                      <small>{r.name}</small>
                    </span>
                  </button>
                  {!r.builtIn && (
                    <button
                      type="button"
                      className="icon-btn search-star"
                      aria-pressed={r.inWatchlist}
                      disabled={busy === r.symbol}
                      onClick={() => void toggleWatch(r)}
                      aria-label={r.inWatchlist
                        ? t("Remove {symbol} from watchlist", { symbol: r.symbol })
                        : t("Add {symbol} to watchlist", { symbol: r.symbol })}
                      title={r.inWatchlist ? t("On your watchlist") : t("Add to watchlist")}
                    >
                      <Star size={16} weight={r.inWatchlist ? "fill" : "regular"} aria-hidden />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}
