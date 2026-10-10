"use client";

import { useEffect, useState } from "react";
import type {
  Instrument,
  PaperOrder,
  Portfolio,
  PriceHistory,
  Quote,
  TradingControls,
} from "@/lib/markets";
import { api } from "../components/api";
import { PaperLabel } from "../components/Badge";
import { Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents } from "../components/format";
import { useApiData } from "../components/useApiData";
import { OrderReview, OrderStateBadge, creatorLabel, orderTitle } from "./OrderReview";
import { OrderTicket } from "./OrderTicket";
import { PriceChart } from "./PriceChart";
import { TradeAssistant } from "./TradeAssistant";
import { formatShares } from "./shares";

const RANGES = [
  { label: "1W", days: 7, desc: "past week" },
  { label: "1M", days: 30, desc: "past month" },
  { label: "3M", days: 90, desc: "past 3 months" },
  { label: "1Y", days: 365, desc: "past year" },
] as const;

interface InstrumentsResponse {
  instruments: Instrument[];
  market: { status: string; label: string };
  disclaimer: string;
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
  const [symbol, setSymbol] = useState("NVDA");
  const [range, setRange] = useState(1);
  const [selected, setSelected] = useState<PaperOrder | null>(null);
  const [openError, setOpenError] = useState<unknown>(null);

  const instruments = useApiData<InstrumentsResponse>("/api/markets/instruments");
  const quotes = useApiData<{ quotes: Quote[]; disclaimer: string }>("/api/markets/quotes");
  const history = useApiData<{ history: PriceHistory; quote: Quote | null }>(
    `/api/markets/history/${encodeURIComponent(symbol)}?days=${RANGES[range].days}`,
    true,
  );
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const orders = useApiData<{ orders: PaperOrder[] }>("/api/orders?limit=6");
  const controls = useApiData<ControlsResponse>("/api/markets/controls");

  // Simulated quotes move every minute; keep the watchlist fresh.
  const reloadQuotes = quotes.reload;
  useEffect(() => {
    const t = setInterval(() => void reloadQuotes(), 30_000);
    return () => clearInterval(t);
  }, [reloadQuotes]);

  const paper = portfolio.data?.portfolio.accounts.find((a) => a.paper && a.tradable) ?? null;
  const quote = quotes.data?.quotes.find((q) => q.symbol === symbol) ?? history.data?.quote ?? null;
  const instrument = instruments.data?.instruments.find((i) => i.symbol === symbol);
  const points = history.data?.history.points ?? [];
  const first = points[0]?.closeCents ?? 0;
  const last = quote?.priceCents ?? points.at(-1)?.closeCents ?? 0;
  const change = first ? last - first : 0;
  const changePct = first ? (change / first) * 100 : 0;

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

  function onOrderChange(order: PaperOrder) {
    setSelected(order);
    void orders.reload();
    if (order.state === "EXECUTED") {
      void portfolio.reload();
      void controls.reload();
    }
  }

  return (
    <div className="trade">
      <div className="trade-head rise" style={{ ["--i" as string]: 0 }}>
        <div>
          <p className="eyebrow">{paper ? `${paper.name} · ••${paper.mask}` : "Paper trading"}</p>
          <h1>Trade</h1>
        </div>
        <div className="trade-chips">
          <PaperLabel />
          <span className="chip">{instruments.data?.market.label ?? "Simulated market"}</span>
          {paper && (
            <span className="chip">
              <span className="chip-dim">Buying power</span> {formatCents(paper.cashCents)}
            </span>
          )}
        </div>
      </div>

      {controls.data?.paused && (
        <p className="trade-paused" role="status">
          Execution is paused in Controls. New orders will be held until you resume.
        </p>
      )}
      <ErrorBox error={openError} onDismiss={() => setOpenError(null)} />

      <div className="trade-grid">
        <section className="watchlist glass rise" style={{ ["--i" as string]: 1 }} aria-label="Watchlist">
          <header>
            <h2>Watchlist</h2>
            <span className="row-meta">{quotes.data?.quotes.length ?? "…"} symbols</span>
          </header>
          <ErrorBox error={quotes.error} title="Couldn't load quotes" onRetry={() => void quotes.reload()} />
          {quotes.loading && !quotes.data ? (
            <Loading label="Loading quotes…" />
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
        </section>

        <div className="trade-main">
          <section className="tile glass chart-card rise" style={{ ["--i" as string]: 2 }} aria-label={`${symbol} chart`}>
            <header className="chart-head">
              <div>
                <p className="row-meta">
                  {instrument ? `${instrument.name} · ${instrument.type === "etf" ? "ETF" : "Stock"}` : symbol}
                </p>
                <p className="chart-price">
                  <span className="chart-big">{last ? <Price cents={last} /> : "—"}</span>
                  <span className={change >= 0 ? "up" : "down"}>
                    {change >= 0 ? "+" : "−"}
                    {formatCents(Math.abs(change))} ({changePct >= 0 ? "+" : ""}
                    {changePct.toFixed(2)}%)
                  </span>
                  <span className="row-meta">{RANGES[range].desc}</span>
                </p>
              </div>
              <div className="seg range-seg" role="radiogroup" aria-label="Chart range" style={{ ["--n" as string]: RANGES.length, ["--idx" as string]: range }}>
                <span className="seg-lens" aria-hidden />
                {RANGES.map((r, i) => (
                  <button key={r.label} type="button" role="radio" aria-checked={range === i} onClick={() => setRange(i)}>
                    {r.label}
                  </button>
                ))}
              </div>
            </header>
            <ErrorBox error={history.error} title="Couldn't load the chart" onRetry={() => void history.reload()} />
            {points.length > 0 ? (
              <PriceChart
                points={points}
                rising={change >= 0}
                label={`Simulated ${symbol} price over the ${RANGES[range].desc}`}
              />
            ) : (
              <div className="trade-chart">
                <Loading label="Loading chart…" />
              </div>
            )}
            <p className="chart-foot">{history.data?.history.disclaimer ?? "Simulated prices — not real market data"}</p>
          </section>

          <div className="trade-lower">
            <OrderTicket
              symbol={symbol}
              quote={quote}
              account={paper}
              controls={controls.data?.controls ?? null}
              onProposed={(order) => onOrderChange(order)}
            />
            {selected ? (
              <OrderReview order={selected} onChange={onOrderChange} onClose={() => setSelected(null)} />
            ) : (
              <section className="tile glass positions" aria-label="Positions and orders">
                <header className="ticket-head">
                  <h2>Positions</h2>
                  {paper && <span className="row-meta">Paper value {formatCents(paper.totalCents)}</span>}
                </header>
                <ErrorBox error={portfolio.error} onRetry={() => void portfolio.reload()} />
                {paper && paper.positions.length === 0 && <p className="row-meta">No paper positions yet.</p>}
                <ul className="position-list">
                  {paper?.positions.map((p) => (
                    <li key={p.symbol}>
                      <button type="button" className="position-row" onClick={() => setSymbol(p.symbol)}>
                        <span className="squircle ticker">{p.symbol}</span>
                        <span className="position-body">
                          <strong>{formatShares(p.quantityMicros)} sh</strong>
                          <small>{p.weightPct.toFixed(1)}% of paper portfolio</small>
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
                <h3 className="orders-title">Orders</h3>
                {orders.data?.orders.length === 0 && <p className="row-meta">No orders yet.</p>}
                <ul className="order-list">
                  {orders.data?.orders.map((o) => (
                    <li key={o.id}>
                      <button type="button" className="order-row" onClick={() => void openOrder(o.id)}>
                        <span>{orderTitle(o)}</span>
                        <small>{creatorLabel(o)}</small>
                        <OrderStateBadge state={o.state} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>

        <TradeAssistant symbol={symbol} onReviewOrder={(id) => void openOrder(id)} />
      </div>
    </div>
  );
}
