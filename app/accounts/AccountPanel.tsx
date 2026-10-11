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
import { formatDate, formatDateTime, formatNumber } from "../components/format";
import { useI18n } from "../components/I18nContext";
import { CurrencyValue } from "./CurrencyValue";
import { ACCOUNT_TYPE_LABEL, CONNECTION_STATUS_LABEL, TXN_STATUS_LABEL, filterAccountActivity } from "./presentation";

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
  const { t, tr } = useI18n();
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
      title={full ? undefined : account?.name ?? t("Recent activity")}
      subtitle={full ? undefined : account ? `${account.institution} · ••${account.mask} · ${account.currency}` : query ? t("Matching your search") : t("For the accounts shown")}
    >
      {preview && account ? (
        <div className="account-preview-note">
          <div>
            <p className="account-pane-kicker">{t("Activity preview")}</p>
            <p>{t("Latest 6 transactions · Synthetic data")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => onOpen(account.id)}>{t("Open account")}<ArrowUpRight size={16} aria-hidden /></Button>
        </div>
      ) : account ? (
        <div className="account-overview-content">
          <div className="account-balance-card">
            <p className="account-pane-kicker">{account.type === "brokerage" ? t("Cash balance") : t("Current balance")}</p>
            <div className="account-detail-balance"><CurrencyValue cents={account.balanceCents} currency={account.currency} rates={rates} /></div>
            <p className="account-capability">
              {account.capabilities.includes("transfer_source") ? t("Eligible for simulated transfers") : t("View only · cannot send transfers")}
            </p>
            {account.paper && <div className="mt-3 space-y-2"><PaperLabel /><p className="account-capability">{tr("Trade it on the {link}. Orders use simulated prices, wait for your approval and never touch your bank balances.", { link: <Link href="/trade" className="quiet-link">{t("Trade page")}</Link> })}</p></div>}
            {account.capabilities.includes("transfer_source") && (
              <Link href={`/transfers?source=${encodeURIComponent(account.id)}`} className="quiet-link mt-3">{t("Transfer from this account")}<ArrowUpRight size={16} aria-hidden /></Link>
            )}
          </div>
          <section className="account-facts" aria-label={t("Account information")}>
            <dl>
              <div><dt>{t("Available balance")}</dt><dd><CurrencyValue cents={account.availableCents} currency={account.currency} rates={rates} /></dd></div>
              <div><dt>{t("Account type")}</dt><dd className="capitalize">{t(ACCOUNT_TYPE_LABEL[account.type])}</dd></div>
              <div><dt>{t("Connection")}</dt><dd>{connection ? t(CONNECTION_STATUS_LABEL[connection.status]) : t("Demo import")}</dd></div>
              <div><dt>{t("Updated")}</dt><dd>{formatDateTime(account.updatedAt, { full: true })}</dd></div>
            </dl>
            <p>{t("Synthetic account · All activity is simulated.")}</p>
            {account.currency !== "USD" && <p>{fx ? t("USD equivalents use {rate}. Display only; international accounts cannot send transfers.", { rate: `${fx.source} · ${formatDate(fx.asOf)}` }) : t("USD equivalents use an unavailable demo rate. Display only; international accounts cannot send transfers.")}</p>}
          </section>
          <ErrorBox error={holdingsError} title={t("Couldn't load holdings")} />
          {holding && (
            <section className="account-holdings">
              <h3>{t("Holdings")}</h3>
              <p>{holding.label} · {t("Prices are simulated")} · {t("Read-only view")}{holding.paper ? ` · ${t("Not counted in net worth")}` : ""}</p>
              {holding.positions.length === 0 && <EmptyState>{t("No positions in this account.")}</EmptyState>}
              <ul>
                {holding.positions.map((p) => (
                  <li key={p.symbol}>
                    <span>{p.symbol}<small>{t("{qty} shares", { qty: formatNumber(p.quantityMicros / 1_000_000, { maximumFractionDigits: 6 }) })}</small></span>
                    <span>{formatCents(p.marketValueCents)}</span>
                  </li>
                ))}
              </ul>
              <div className="account-holdings-total"><span>{t("Cash + holdings")}</span><strong>{formatCents(holding.totalCents)}</strong></div>
            </section>
          )}
        </div>
      ) : null}
      <section className="account-activity-content" aria-label={preview ? t("Recent account transactions") : t("Account transaction history")}>
      <h3 className="account-activity-heading">{preview ? t("Recent transactions") : t("Transaction activity")}</h3>
      {full && <p className="account-history-note">{t("Scroll for more. Open a transaction for its details.")}</p>}
      <div className="account-activity-scroll" ref={scrollRef} role="region" aria-label={t("Scrollable transactions")} tabIndex={0}>
      <ErrorBox error={transactions.error} onRetry={() => void transactions.reload()} />
      {transactions.loading && !transactions.data ? <Loading label={t("Loading activity…")} /> : transactions.error && !transactions.data ? null : txs.length === 0 ? (
        <EmptyState>{query ? t("No matching transactions. Try another search.") : account ? t("No transactions for this account yet.") : t("No recent transactions.")}</EmptyState>
      ) : (
        <ul className="account-transactions">
          {txs.map((tx) => (
            <li key={tx.id} data-account-id={tx.accountId}>
              {preview ? (
              <div className="transaction-line">
                <div className="min-w-0">
                  <p className="font-medium break-words">{tx.merchant ?? tx.description}</p>
                  <p className="transaction-meta">{formatDate(tx.postedAt)} · {tx.category} · {t(TXN_STATUS_LABEL[tx.status])}</p>
                </div>
                <CurrencyValue cents={tx.amountCents} currency={tx.currency} rates={rates} />
              </div>
              ) : (
                <details className="transaction-details">
                  <summary className="transaction-line" aria-label={t("Transaction details: {name}, {date}, {amount}", { name: tx.merchant ?? tx.description, date: formatDate(tx.postedAt), amount: formatCents(tx.amountCents, tx.currency) })}>
                    <span className="min-w-0">
                      <span className="font-medium break-words block">{tx.merchant ?? tx.description}</span>
                      <span className="transaction-meta block">{formatDate(tx.postedAt)} · {tx.category} · {t(TXN_STATUS_LABEL[tx.status])}</span>
                    </span>
                    <span className="transaction-entry-value"><CurrencyValue cents={tx.amountCents} currency={tx.currency} rates={rates} /><CaretDown size={14} aria-hidden /></span>
                  </summary>
                  <p>{tx.description}{tx.transferGroupId ? ` · ${t("Transfer between your accounts")}` : ""}</p>
                  {tx.actionId && <Link href={`/transfers?id=${encodeURIComponent(tx.actionId)}`}>{t("View transfer receipt")}</Link>}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      <div ref={sentinelRef} className="account-activity-sentinel" aria-hidden />
      <p className="account-history-note" role="status">
        {transactions.loading && transactions.data ? t("Loading activity…") : hasMore ? t("Scroll for more activity") : txs.length ? t("End of recent activity") : ""}
      </p>
      </div>
      </section>
    </Card>
  );
}
