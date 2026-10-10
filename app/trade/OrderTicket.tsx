"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight } from "@phosphor-icons/react";
import type { PaperOrder, PortfolioAccount, Quote, TradingControls } from "@/lib/markets";
import { api } from "../components/api";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents, parseDollarsToCents } from "../components/format";
import { formatShares, parseSharesToMicros } from "./shares";

/** Display-only estimate: the server prices and checks the real order. */
const estimateShares = (cents: number, priceCents: number) => (priceCents > 0 ? cents / priceCents : 0);

export function OrderTicket({
  symbol,
  quote,
  account,
  controls,
  onProposed,
}: {
  symbol: string;
  quote: Quote | null;
  account: PortfolioAccount | null;
  controls: TradingControls | null;
  onProposed: (order: PaperOrder) => void;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("250");
  const [sharesText, setSharesText] = useState("1");
  const [fieldError, setFieldError] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const held = account?.positions.find((p) => p.symbol === symbol)?.quantityMicros ?? 0;
  const amountParsed = parseDollarsToCents(amount);
  const sharesParsed = parseSharesToMicros(sharesText);
  const price = quote?.priceCents ?? 0;
  const valueCents =
    side === "buy"
      ? amountParsed.ok ? amountParsed.cents : 0
      : sharesParsed.ok ? Math.round((sharesParsed.micros / 1_000_000) * price) : 0;
  const overLimit = controls ? valueCents > controls.perOrderLimitCents : false;
  const sliderMax = Math.max(100_000, (controls?.perOrderLimitCents ?? 50_000) * 2);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFieldError("");
    setError(null);
    if (!account) return;
    let sizing: { notionalCents: number } | { quantityMicros: number };
    if (side === "buy") {
      if (!amountParsed.ok) return setFieldError(amountParsed.error);
      if (amountParsed.cents < 100) return setFieldError("Minimum order is $1.00");
      sizing = { notionalCents: amountParsed.cents };
    } else {
      if (!sharesParsed.ok) return setFieldError(sharesParsed.error);
      sizing = { quantityMicros: sharesParsed.micros };
    }
    setBusy(true);
    try {
      const { order } = await api.post<{ order: PaperOrder }>("/api/orders", {
        accountId: account.accountId,
        symbol,
        side,
        ...sizing,
      });
      onProposed(order);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="tile glass ticket" onSubmit={submit} aria-label={`Order ticket for ${symbol}`}>
      <header className="ticket-head">
        <h2>Order · {symbol}</h2>
        <div className="seg" role="radiogroup" aria-label="Side">
          <span className="seg-lens" data-side={side} aria-hidden />
          {(["buy", "sell"] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => {
                setSide(s);
                setFieldError("");
              }}
            >
              {s === "buy" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </header>

      {!account ? (
        <p className="row-meta">No paper trading account is available for this user.</p>
      ) : side === "buy" ? (
        <>
          <div className="ticket-amount">
            <label htmlFor="ticket-amount">Amount (USD)</label>
            <input
              id="ticket-amount"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
            />
          </div>
          <input
            className="ticket-slider"
            type="range"
            min={100}
            max={sliderMax}
            step={100}
            value={amountParsed.ok ? Math.min(amountParsed.cents, sliderMax) : 100}
            onChange={(e) => setAmount(String(Number(e.target.value) / 100))}
            aria-label="Amount"
            style={{ ["--pct" as string]: `${((amountParsed.ok ? Math.min(amountParsed.cents, sliderMax) : 0) / sliderMax) * 100}%` }}
          />
          <p className="ticket-note">
            {price > 0 && amountParsed.ok
              ? `≈ ${estimateShares(amountParsed.cents, price).toFixed(3)} sh at ${formatCents(price)}`
              : "Enter a dollar amount"}
          </p>
        </>
      ) : (
        <>
          <div className="ticket-amount">
            <label htmlFor="ticket-shares">Shares to sell</label>
            <input
              id="ticket-shares"
              inputMode="decimal"
              value={sharesText}
              onChange={(e) => setSharesText(e.target.value)}
              aria-invalid={fieldError ? true : undefined}
            />
          </div>
          <p className="ticket-note">
            You hold {formatShares(held)} sh. Sells are placed in shares.
            {sharesParsed.ok && price > 0 ? ` ≈ ${formatCents(valueCents)}` : ""}
          </p>
        </>
      )}

      {fieldError && (
        <p className="ticket-error" role="alert">
          {fieldError}
        </p>
      )}

      {account && (
        <dl className="ticket-checks">
          <div>
            <dt>Price is locked within 1%</dt>
            <dd>{price > 0 ? formatCents(price) : "—"} now</dd>
          </div>
          <div className={overLimit ? "warn" : undefined}>
            <dt>{overLimit ? "Over your per-order limit, it will be held" : "Per-order limit"}</dt>
            <dd>{controls ? formatCents(controls.perOrderLimitCents) : "—"}</dd>
          </div>
          <div>
            <dt>Paper buying power</dt>
            <dd>{formatCents(account.cashCents)}</dd>
          </div>
        </dl>
      )}

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <button type="submit" className="pill ticket-submit" disabled={!account || busy || !quote}>
        {busy ? "Proposing…" : side === "buy" ? "Propose buy" : "Propose sell"}
        <span className="knob" aria-hidden>
          <ArrowRight size={16} weight="bold" />
        </span>
      </button>
      <p className="ticket-foot">Nothing executes until you approve this exact version.</p>
    </form>
  );
}
