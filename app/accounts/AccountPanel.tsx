"use client";

import { useState } from "react";
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
import { formatCents } from "@/lib/finance/money";
import { CurrencyValue } from "./CurrencyValue";
import { filterAccountActivity } from "./presentation";

export function AccountPanel({ account, preview, holding, rates, connection, query, holdingsError, onOpen }: {
  account?: Account;
  preview: boolean;
  holding?: Portfolio["accounts"][number];
  rates: FxRate[];
  connection?: Connection;
  query: string;
  holdingsError: unknown;
  onOpen: (id: string) => void;
}) {
  // Parent keys this panel by account/mode: old activity cannot flash under a new account.
  const transactions = useApiData<TransactionsResponse>(
    paths.transactions({ accountId: account?.id, limit: preview ? 6 : 100 }),
  );
  const [visibleCount, setVisibleCount] = useState(account && !preview ? 12 : 6);
  const txs = filterAccountActivity(transactions.data?.transactions ?? [], account?.id, query);
  const fx = rates.find((r) => r.currency === account?.currency);
  const full = !!account && !preview;
  return (
    <Card
      className={`account-panel ${full ? "account-full-view" : ""}`}
      bodyClassName={full ? "account-full-layout" : ""}
      title={full ? undefined : account?.name ?? "Recent activity"}
      subtitle={full ? undefined : account ? `${account.institution} · ••${account.mask} · ${account.currency}` : "Latest transactions across your accounts"}
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
              {account.paper ? " · Paper money · Excluded from total balance" : ""}
            </p>
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
              <p>{holding.label} · Prices are simulated. {holding.paper ? "Excluded from total balance." : ""}</p>
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
      {full && <p className="account-history-note">Latest 100 transactions · Open an entry for its details.</p>}
      <ErrorBox error={transactions.error} onRetry={() => void transactions.reload()} />
      {transactions.loading ? <Loading label="Loading activity…" /> : transactions.error ? null : txs.length === 0 ? (
        <EmptyState>{query ? "No matching transactions. Try another search." : account ? "No transactions for this account yet." : "No recent transactions."}</EmptyState>
      ) : (
        <ul className="account-transactions">
          {txs.slice(0, preview ? 6 : visibleCount).map((t) => (
            <li key={t.id}>
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
      {!preview && txs.length > visibleCount && <Button className="mt-4 w-full" onClick={() => setVisibleCount((c) => c + 12)}>Show more activity ({txs.length - visibleCount} remaining)</Button>}
      </section>
    </Card>
  );
}
