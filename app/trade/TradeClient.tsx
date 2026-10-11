"use client";

import { useSearchParams } from "next/navigation";
/* eslint-disable @next/next/no-img-element -- small static mascot PNG */
import { useCallback, useEffect, useRef, useState } from "react";
import { Star } from "@phosphor-icons/react";
import type {
  BrokerConnection,
  Instrument,
  MarketStatus,
  PaperOrder,
  Portfolio,
  PortfolioAccount,
  PriceHistory,
  Quote,
  TradingControls,
} from "@/lib/markets";
import { api } from "../components/api";
import { Badge, PaperLabel } from "../components/Badge";
import { Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents } from "../components/format";
import { useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import { useApiData } from "../components/useApiData";
import { OrderReview, OrderStateBadge, creatorLabel, orderTitle } from "./OrderReview";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { SymbolSearch } from "./SymbolSearch";
import "./trade-search.css";
import { TradeAssistant } from "./TradeAssistant";
import { formatShares } from "./shares";

const RANGES = [
  { label: "1W", days: 7, desc: msg("past week") },
  { label: "1M", days: 30, desc: msg("past month") },
  { label: "3M", days: 90, desc: msg("past 3 months") },
  { label: "1Y", days: 365, desc: msg("past year") },
] as const;

interface InstrumentsResponse {
  instruments: Instrument[];
  /** Symbols this user added from search (also included in `instruments`). */
  watchlist: string[];
  market: MarketStatus;
  disclaimer: string;
}

function VenueBadge({ account }: { account: PortfolioAccount }) {
  const t = useT();
  if (account.venue === "alpaca_live") {
    return <Badge tone="red" title={t("Alpaca live account: real money")}>{t("LIVE · real money")}</Badge>;
  }
  if (account.venue === "alpaca_paper") {
    return <Badge tone="brand" title={t("Alpaca paper trading: real market prices, paper money")}>{t("Alpaca paper")}</Badge>;
  }
  return <PaperLabel />;
}

/** Shown when the server has Alpaca keys for this user. Connecting is always the user's own click. */
function AlpacaCard({ connection, onConnected }: { connection: BrokerConnection; onConnected: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const live = connection.env === "live";

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      await api.post<{ connection: BrokerConnection }>("/api/brokers/alpaca/connect");
      onConnected();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (connection.accountId) {
    return connection.lastSyncError ? (
      <p className="trade-paused" role="status">{t("Alpaca sync problem: {error}", { error: connection.lastSyncError })}</p>
    ) : null;
  }
  return (
    <section className="trade-connect glass" aria-label={t("Connect Alpaca")}>
      <div>
        <strong>{live ? t("Connect your Alpaca LIVE account") : t("Connect your Alpaca paper account")}</strong>
        <p className="row-meta">
          {live
            ? t("Real money. Orders you approve are sent to Alpaca as limit orders, capped per order.")
            : t("Trade with real market prices and Alpaca paper money. You still approve every order before it's sent.")}
        </p>
      </div>
      <button type="button" className="pill" disabled={busy} onClick={() => void connect()}>
        {busy ? t("Connecting…") : t("Connect Alpaca")}
      </button>
      <ErrorBox error={error} onDismiss={() => setError(null)} />
    </section>
  );
}
interface ControlsResponse {
  controls: TradingControls;
  paused: boolean;
  usage: { executedTodayCents: number };
}

/** "$187.42" → whole dollars and a quieter ".42". */
function Price({ cents }: { cents: number }) {
  const text = formatCents(cents);
  const dot = text.lastIndexOf(".");
  return (
    <>
      {text.slice(0, dot)}
      <span className="cents">{text.slice(dot)}</span>
    </>
  );
}

export function TradeClient() {
  const t = useT();
  const [symbol, setSymbol] = useState("NVDA");
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState<PaperOrder | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  // Bottom-right pane when no order is open: 0 = positions, 1 = orders.
  const [lowerTab, setLowerTab] = useState(0);
  // Below 1200px the assistant is a slide-over opened from a floating button.
  const [assistantOpen, setAssistantOpen] = useState(false);
  const fabRef = useRef<HTMLButtonElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const closeAssistant = useCallback(() => setAssistantOpen(false), []);
  // Return focus to the button once it is visible again (it is hidden while open).
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !assistantOpen) fabRef.current?.focus();
    wasOpen.current = assistantOpen;
  }, [assistantOpen]);

  const instruments = useApiData<InstrumentsResponse>("/api/markets/instruments");
  const quotes = useApiData<{ quotes: Quote[]; disclaimer: string }>("/api/markets/quotes");
  const history = useApiData<{ history: PriceHistory; quote: Quote | null; instrument: Instrument | null }>(
    `/api/markets/history/${encodeURIComponent(symbol)}?days=${RANGES[range].days}`,
    true,
  );
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const orders = useApiData<{ orders: PaperOrder[] }>("/api/orders?limit=6");
  const controls = useApiData<ControlsResponse>("/api/markets/controls");
  const broker = useApiData<{ connection: BrokerConnection }>("/api/brokers/alpaca");

  // Quotes move every minute (simulated or real); keep the watchlist fresh.
  const reloadQuotes = quotes.reload;
  useEffect(() => {
    const timer = setInterval(() => void reloadQuotes(), 30_000);
    return () => clearInterval(timer);
  }, [reloadQuotes]);

  // Tradable accounts: Onera paper and, once connected, Alpaca. Default to Alpaca when it's there.
  const tradable = portfolio.data?.portfolio.accounts.filter((a) => a.tradable) ?? [];
  const paper =
    tradable.find((a) => a.accountId === accountId) ??
    tradable.find((a) => a.venue === "alpaca_paper" || a.venue === "alpaca_live") ??
    tradable[0] ??
    null;
  const realPrices = portfolio.data?.portfolio.quotesSource === "alpaca_iex";
  const market = instruments.data?.market;
  const quote = quotes.data?.quotes.find((q) => q.symbol === symbol) ?? history.data?.quote ?? null;
  const instrument =
    instruments.data?.instruments.find((i) => i.symbol === symbol) ??
    (history.data?.history.symbol === symbol ? history.data.instrument : null) ??
    undefined;
  const watched = instruments.data?.watchlist.includes(symbol) ?? false;
  // Built-in symbols are always listed; anything else (found through search) can be starred.
  const builtIn = Boolean(instruments.data?.instruments.some((i) => i.symbol === symbol)) && !watched;
  const [watchBusy, setWatchBusy] = useState(false);
  const [watchError, setWatchError] = useState<unknown>(null);
  const reloadWatchlist = useCallback(() => {
    void instruments.reload();
    void quotes.reload();
  }, [instruments, quotes]);
  async function toggleWatch() {
    setWatchBusy(true);
    setWatchError(null);
    try {
      if (watched) await api.del(`/api/markets/watchlist/${encodeURIComponent(symbol)}`);
      else await api.post("/api/markets/watchlist", { symbol });
      reloadWatchlist();
    } catch (err) {
      setWatchError(err);
    } finally {
      setWatchBusy(false);
    }
  }
  const points = history.data?.history.points ?? [];
  const first = points[0]?.closeCents ?? 0;
  const last = quote?.priceCents ?? points.at(-1)?.closeCents ?? 0;
  const change = first ? last - first : 0;
  const changePct = first ? (change / first) * 100 : 0;

  // Voice and other pages link here with ?order=<id> to open a proposal for review.
  const linkedOrder = useSearchParams().get("order");
  const lowerRef = useRef<HTMLDivElement>(null);
  const revealReview = useRef(false);
  useEffect(() => {
    if (!linkedOrder) return;
    revealReview.current = true;
    void openOrder(linkedOrder);
  }, [linkedOrder]); // Once per linked order; openOrder is recreated every render.
  // Wait for the chart and watchlist so the page is tall enough to scroll.
  const pageReady = Boolean(history.data && quotes.data && portfolio.data);
  useEffect(() => {
    if (!selected || !pageReady || !revealReview.current) return;
    revealReview.current = false;
    lowerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected, pageReady]);

  async function openOrder(id: string) {
    setOpenError(null);
    try {
      const res = await api.get<{ order: PaperOrder }>(`/api/orders/${encodeURIComponent(id)}`);
      setSelected(res.order);
      setSymbol(res.order.symbol);
    } catch (err) {
      setOpenError(err);
    }
    void orders.reload();
  }

  // Slide-over: Esc closes, focus moves in on open, and widening the window
  // past the breakpoint (where the assistant is a column again) closes it.
  useEffect(() => {
    if (!assistantOpen) return;
    slotRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeAssistant();
    };
    const wide = window.matchMedia("(min-width: 1201px)");
    const onWide = () => wide.matches && setAssistantOpen(false);
    window.addEventListener("keydown", onKey);
    wide.addEventListener("change", onWide);
    return () => {
      window.removeEventListener("keydown", onKey);
      wide.removeEventListener("change", onWide);
    };
  }, [assistantOpen, closeAssistant]);

  function onOrderChange(order: PaperOrder) {
    setSelected(order);
    void orders.reload();
    if (["EXECUTED", "SUBMITTED", "CANCELED", "FAILED"].includes(order.state)) {
      void portfolio.reload();
      void controls.reload();
    }
  }

  return (
    <div className="trade">
      <div className="trade-head rise" style={{ ["--i" as string]: 0 }} inert={assistantOpen || undefined}>
        <div className="trade-title">
          <h1>{t("Trade")}</h1>
          <p className="eyebrow">{paper ? `${paper.name} · ••${paper.mask}` : t("Paper trading")}</p>
        </div>
        <div className="trade-chips">
          {(!paper || paper.venue === "onera_paper") && <span className="chip">{t("Synthetic data · simulated money")}</span>}
          {paper ? <VenueBadge account={paper} /> : <PaperLabel />}
          <span className="chip" title={market?.nextOpen ? t("Next open {time}", { time: new Date(market.nextOpen).toLocaleString() }) : undefined}>
            {t(market?.label ?? "Simulated market")}
          </span>
          <span className="chip">
            <span className="chip-dim">{t("Prices")}</span> {realPrices ? t("Alpaca · IEX") : t("Simulated")}
          </span>
          {paper && (
            <span className="chip">
              <span className="chip-dim">{t("Buying power")}</span> {formatCents(paper.buyingPowerCents)}
            </span>
          )}
        </div>
      </div>

      {tradable.length > 1 && (
        <div className="trade-accounts" role="radiogroup" aria-label={t("Trading account")}>
          {tradable.map((a) => (
            <button
              key={a.accountId}
              type="button"
              role="radio"
              aria-checked={a.accountId === paper?.accountId}
              className="chip"
              onClick={() => setAccountId(a.accountId)}
            >
              {a.name} ••{a.mask}
            </button>
          ))}
        </div>
      )}

      {broker.data?.connection.availableToUser && (
        <AlpacaCard
          connection={broker.data.connection}
          onConnected={() => {
            void broker.reload();
            void portfolio.reload();
            void quotes.reload();
          }}
        />
      )}
      {paper?.venue === "alpaca_live" && (
        <p className="trade-paused trade-live" role="status">
          {t("LIVE account: orders you submit here trade real money at Alpaca.")}
        </p>
      )}

      {controls.data?.paused && (
        <p className="trade-paused" role="status">
          {t("Execution is paused in Controls. New orders will be held until you resume.")}
        </p>
      )}
      <ErrorBox error={openError} onDismiss={() => setOpenError(null)} />

      <div className="trade-grid">
        <section className="watchlist glass rise" style={{ ["--i" as string]: 1 }} aria-label={t("Watchlist")} inert={assistantOpen || undefined}>
          <header>
            <h2>{t("Watchlist")}</h2>
            <span className="row-meta">{t("{count} symbols", { count: quotes.data?.quotes.length ?? "…" })}</span>
          </header>
          <SymbolSearch onSelect={setSymbol} onWatchlistChange={reloadWatchlist}>
          <ErrorBox error={quotes.error} title={t("Couldn't load quotes")} onRetry={() => void quotes.reload()} />
          {quotes.loading && !quotes.data ? (
            <Loading label={t("Loading quotes…")} />
          ) : (
            <ul>
              {quotes.data?.quotes.map((q) => {
                const name = instruments.data?.instruments.find((i) => i.symbol === q.symbol)?.name ?? "";
                return (
                  <li key={q.symbol}>
                    <button
                      type="button"
                      className="watch-row"
                      aria-pressed={q.symbol === symbol}
                      onClick={() => setSymbol(q.symbol)}
                    >
                      <span className="watch-name">
                        <strong>{q.symbol}</strong>
                        <small>{name}</small>
                      </span>
                      <span className="watch-price">
                        <strong>{formatCents(q.priceCents)}</strong>
                        <small className={q.changePct >= 0 ? "up" : "down"}>
                          {q.changePct >= 0 ? "+" : ""}
                          {q.changePct.toFixed(2)}%
                        </small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          </SymbolSearch>
        </section>

        <div className="trade-main" inert={assistantOpen || undefined}>
          <section className="tile glass chart-card rise" style={{ ["--i" as string]: 2 }} aria-label={t("{symbol} chart", { symbol })}>
            <header className="chart-head">
              <div>
                <p className="row-meta">
                  {instrument ? `${instrument.name} · ${instrument.type === "etf" ? t("ETF") : t("Stock")}` : symbol}
                </p>
                <p className="chart-price">
                  <span className="chart-big">{last ? <Price cents={last} /> : "—"}</span>
                  <span className={change >= 0 ? "up" : "down"}>
                    {change >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
                    {changePct.toFixed(2)}%)
                  </span>
                  <span className="row-meta">{t(RANGES[range].desc)}</span>
                </p>
              </div>
              {instrument && !builtIn && (
                <button
                  type="button"
                  className="icon-btn chart-watch"
                  aria-pressed={watched}
                  disabled={watchBusy}
                  onClick={() => void toggleWatch()}
                  aria-label={watched
                    ? t("Remove {symbol} from watchlist", { symbol })
                    : t("Add {symbol} to watchlist", { symbol })}
                  title={watched ? t("On your watchlist") : t("Add to watchlist")}
                >
                  <Star size={18} weight={watched ? "fill" : "regular"} aria-hidden />
                </button>
              )}
              <div className="seg range-seg" role="radiogroup" aria-label={t("Chart range")} style={{ ["--n" as string]: RANGES.length, ["--idx" as string]: range }}>
                <span className="seg-lens" aria-hidden />
                {RANGES.map((r, i) => (
                  <button key={r.label} type="button" role="radio" aria-checked={range === i} onClick={() => setRange(i)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </header>
            <ErrorBox error={history.error} title={t("Couldn't load the chart")} onRetry={() => void history.reload()} />
            <ErrorBox error={watchError} onDismiss={() => setWatchError(null)} />
            {points.length > 0 ? (
              <PriceChart
                points={points}
                rising={change >= 0}
                label={
                  history.data?.history.source === "simulated"
                    ? t("Simulated {symbol} price over the {range}", { symbol, range: t(RANGES[range].desc) })
                    : t("Alpaca {symbol} price over the {range}", { symbol, range: t(RANGES[range].desc) })
                }
              />
            ) : (
              <div className="trade-chart">
                <Loading label={t("Loading chart…")} />
              </div>
            )}
            <p className="chart-foot">{t(history.data?.history.disclaimer ?? "Simulated prices — not real market data")}</p>
          </section>

          <div className="trade-lower" ref={lowerRef}>
            <OrderTicket
              symbol={symbol}
              quote={quote}
              account={paper}
              controls={controls.data?.controls ?? null}
              onProposed={(order) => onOrderChange(order)}
            />
            {selected ? (
              <OrderReview
                order={selected}
                marketOpen={market?.status !== "closed"}
                onChange={onOrderChange}
                onClose={() => setSelected(null)}
              />
            ) : (
              <section className="tile glass positions" aria-label={t("Positions and orders")}>
                <header className="ticket-head">
                  <div
                    className="seg lower-seg"
                    role="radiogroup"
                    aria-label={t("Show positions or orders")}
                    style={{ ["--n" as string]: 2, ["--idx" as string]: lowerTab }}
                  >
                    <span className="seg-lens" aria-hidden />
                    {[msg("Positions"), msg("Orders")].map((label, i) => (
                      <button key={label} type="button" role="radio" aria-checked={lowerTab === i} onClick={() => setLowerTab(i)}>
                        {t(label)}
                      </button>
                    ))}
                  </div>
                  {paper && (
                    <span className="row-meta">
                      {paper.venue === "onera_paper"
                        ? t("Paper value {amount}", { amount: formatCents(paper.totalCents) })
                        : t("Account value {amount}", { amount: formatCents(paper.totalCents) })}
                    </span>
                  )}
                </header>
                {lowerTab === 0 ? (
                  <div className="pane-scroll">
                    <ErrorBox error={portfolio.error} onRetry={() => void portfolio.reload()} />
                    {paper && paper.positions.length === 0 && <p className="row-meta">{t("No positions yet.")}</p>}
                    <ul className="position-list">
                      {paper?.positions.map((p) => (
                        <li key={p.symbol}>
                          <button type="button" className="position-row" onClick={() => setSymbol(p.symbol)}>
                            <span className="squircle ticker">{p.symbol}</span>
                            <span className="position-body">
                              <strong>{t("{shares} sh", { shares: formatShares(p.quantityMicros) })}</strong>
                              <small>
                                {paper.venue === "onera_paper"
                                  ? t("{pct}% of paper portfolio", { pct: p.weightPct.toFixed(1) })
                                  : t("{pct}% of portfolio", { pct: p.weightPct.toFixed(1) })}
                              </small>
                            </span>
                            <span className="position-value">
                              <strong>{formatCents(p.marketValueCents)}</strong>
                              <small className={p.unrealizedPnlCents >= 0 ? "up" : "down"}>
                                {p.unrealizedPnlCents >= 0 ? "+" : "−"}
                                {formatCents(Math.abs(p.unrealizedPnlCents))}
                              </small>
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <div className="pane-scroll">
                    {orders.data?.orders.length === 0 && <p className="row-meta">{t("No orders yet.")}</p>}
                    <ul className="order-list">
                      {orders.data?.orders.map((o) => (
                        <li key={o.id}>
                          <button type="button" className="order-row" onClick={() => void openOrder(o.id)}>
                            <span>{orderTitle(o, t)}</span>
                            <small>{creatorLabel(o, t)}</small>
                            <OrderStateBadge state={o.state} />
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </section>
            )}
          </div>
        </div>

        <div
          className={`assistant-scrim${assistantOpen ? " open" : ""}`}
          onClick={closeAssistant}
          aria-hidden
        />
        <div
          ref={slotRef}
          className={`assistant-slot${assistantOpen ? " open" : ""}`}
          role={assistantOpen ? "dialog" : undefined}
          aria-modal={assistantOpen || undefined}
          aria-label={assistantOpen ? t("Ask Onera") : undefined}
          tabIndex={-1}
        >
          <TradeAssistant
            symbol={symbol}
            onClose={closeAssistant}
            onReviewOrder={(id) => {
              // Close the slide-over so the review pane it opens is visible.
              setAssistantOpen(false);
              void openOrder(id);
            }}
          />
        </div>
      </div>

      <button
        ref={fabRef}
        type="button"
        className="assistant-fab"
        aria-expanded={assistantOpen}
        onClick={() => setAssistantOpen(true)}
        hidden={assistantOpen}
      >
        <img src="/agents/research.png" alt="" width={28} height={28} />
        {t("Ask Onera")}
      </button>
    </div>
  );
}
