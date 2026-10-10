"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CaretDown } from "@phosphor-icons/react";
import type { Account, FxRate } from "@/lib/types";
import type { Portfolio } from "@/lib/markets";
import type { Connection } from "@/lib/providers";
import { paths, type TransactionsResponse } from "../components/api";
import { useApiData } from "../components/useApiData";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { PaperLabel } from "../components/Badge";
import { formatCents } from "@/lib/finance/money";
import { CurrencyValue } from "./CurrencyValue";
import { filterAccountActivity } from "./presentation";

export function AccountPanel({ account, preview, holding, rates, connection, query, allowedAccountIds, holdingsError, onOpen }: {
  account?: Account;
  preview: boolean;
  holding?: Portfolio["accounts"][number];
  rates: FxRate[];
  connection?: Connection;
  query: string;
  allowedAccountIds?: readonly string[];
  holdingsError: unknown;
  onOpen: (id: string) => void;
}) {
  // Parent keys this panel by account/mode: old activity cannot flash under a new account.
  const [requestedLimit, setRequestedLimit] = useState(16);
  const limit = query ? 100 : requestedLimit;
  const accountId = account?.id ?? (allowedAccountIds?.length === 1 ? allowedAccountIds[0] : undefined);
  const transactions = useApiData<TransactionsResponse>(
    allowedAccountIds?.length === 0 ? null : paths.transactions({ accountId, limit }), true,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = !!transactions.data && transactions.data.transactions.length === limit && limit < 100;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || transactions.loading || transactions.error || query) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setRequestedLimit((previous) => Math.min(previous + 16, 100));
    }, { root: scrollRef.current, rootMargin: "0px 0px 200px 0px" });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, transactions.loading, transactions.error, query, limit]);
  const txs = filterAccountActivity(transactions.data?.transactions ?? [], account?.id, query, allowedAccountIds);
  const fx = rates.find((r) => r.currency === account?.currency);
  const full = !!account && !preview;
  return (
    <Card
      className={`account-panel ${full ? "account-full-view" : ""}`}
      bodyClassName={full ? "account-full-layout" : ""}
      title={full ? undefined : account?.name ?? "Recent activity"}
      subtitle={full ? undefined : account ? `${account.institution} · ••${account.mask} · ${account.currency}` : query ? "Matching your search" : "For the accounts shown"}
    >
      {preview && account ? (
        <div className="account-preview-note">
          <div>
            <p className="account-pane-kicker">Activity preview</p>
            <p>Latest 6 transactions · Synthetic data</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpen(account.id)}>Open account<ArrowUpRight size={16} aria-hidden /></Button>
        </div>
      ) : account ? (
        <div className="account-overview-content">
          <div className="account-balance-card">
            <p className="account-pane-kicker">{account.type === "brokerage" ? "Cash balance" : "Current balance"}</p>
            <div className="account-detail-balance"><CurrencyValue cents={account.balanceCents} currency={account.currency} rates={rates} /></div>
            <p className="account-capability">
              {account.capabilities.includes("transfer_source") ? "Eligible for simulated transfers" : "View only · cannot send transfers"}
            </p>
            {account.paper && <div className="mt-3 space-y-2"><PaperLabel /><p className="account-capability">Trade it on the <Link href="/trade" className="quiet-link">Trade page</Link>. Orders use simulated prices, wait for your approval and never touch your bank balances.</p></div>}
            {account.capabilities.includes("transfer_source") && (
              <Link href={`/transfers?source=${encodeURIComponent(account.id)}`} className="quiet-link mt-3">Transfer from this account<ArrowUpRight size={16} aria-hidden /></Link>
            )}
          </div>
          <section className="account-facts" aria-label="Account information">
            <dl>
              <div><dt>Available balance</dt><dd><CurrencyValue cents={account.availableCents} currency={account.currency} rates={rates} /></dd></div>
              <div><dt>Account type</dt><dd className="capitalize">{account.type}</dd></div>
              <div><dt>Connection</dt><dd>{connection ? connection.status.replaceAll("_", " ") : "Demo import"}</dd></div>
              <div><dt>Updated</dt><dd>{new Date(account.updatedAt).toLocaleString()}</dd></div>
            </dl>
            <p>Synthetic account · All activity is simulated.</p>
            {account.currency !== "USD" && <p>USD equivalents use {fx ? `${fx.source} · ${new Date(fx.asOf).toLocaleDateString()}` : "an unavailable demo rate"}. Display only; international accounts cannot send transfers.</p>}
          </section>
          <ErrorBox error={holdingsError} title="Couldn't load holdings" />
          {holding && (
            <section className="account-holdings">
              <h3>Holdings</h3>
              <p>{holding.label} · Prices are simulated · Read-only view{holding.paper ? " · Not counted in net worth" : ""}</p>
              {holding.positions.length === 0 && <EmptyState>No positions in this account.</EmptyState>}
              <ul>
                {holding.positions.map((p) => (
                  <li key={p.symbol}>
                    <span>{p.symbol}<small>{(p.quantityMicros / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 6 })} shares</small></span>
                    <span>{formatCents(p.marketValueCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="account-holdings-total"><span>Cash + holdings</span><strong>{formatCents(holding.totalCents)}</strong></div>
            </section>
          )}
        </div>
      ) : null}
      <section className="account-activity-content" aria-label={preview ? "Recent account transactions" : "Account transaction history"}>
      <h3 className="account-activity-heading">{preview ? "Recent transactions" : "Transaction activity"}</h3>
      {full && <p className="account-history-note">Scroll for more. Open a transaction for its details.</p>}
      <div className="account-activity-scroll" ref={scrollRef} role="region" aria-label="Scrollable transactions" tabIndex={0}>
      <ErrorBox error={transactions.error} onRetry={() => void transactions.reload()} />
      {transactions.loading && !transactions.data ? <Loading label="Loading activity…" /> : transactions.error && !transactions.data ? null : txs.length === 0 ? (
        <EmptyState>{query ? "No matching transactions. Try another search." : account ? "No transactions for this account yet." : "No recent transactions."}</EmptyState>
      ) : (
        <ul className="account-transactions">
          {txs.map((t) => (
            <li key={t.id} data-account-id={t.accountId}>
              {preview ? (
              <div className="transaction-line">
                <div className="min-w-0">
                  <p className="font-medium break-words">{t.merchant ?? t.description}</p>
                  <p className="transaction-meta">{new Date(t.postedAt).toLocaleDateString()} · {t.category} · {t.status}</p>
                </div>
                <CurrencyValue cents={t.amountCents} currency={t.currency} rates={rates} />
              </div>
              ) : (
                <details className="transaction-details">
                  <summary className="transaction-line" aria-label={`Transaction details: ${t.merchant ?? t.description}, ${new Date(t.postedAt).toLocaleDateString()}, ${formatCents(t.amountCents, t.currency)}`}>
                    <span className="min-w-0">
                      <span className="font-medium break-words block">{t.merchant ?? t.description}</span>
                      <span className="transaction-meta block">{new Date(t.postedAt).toLocaleDateString()} · {t.category} · {t.status}</span>
                    </span>
                    <span className="transaction-entry-value"><CurrencyValue cents={t.amountCents} currency={t.currency} rates={rates} /><CaretDown size={14} aria-hidden /></span>
                  </summary>
                  <p>{t.description}{t.transferGroupId ? " · Transfer between your accounts" : ""}</p>
                  {t.actionId && <Link href={`/transfers?id=${encodeURIComponent(t.actionId)}`}>View transfer receipt</Link>}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinelRef} className="account-activity-sentinel" aria-hidden />
      <p className="account-history-note" role="status">
        {transactions.loading && transactions.data ? "Loading activity…" : hasMore ? "Scroll for more activity" : txs.length ? "End of recent activity" : ""}
      </p>
      </div>
      </section>
    </Card>
  );
}
