"use client";

import Link from "next/link";
import type { Account, SubscriptionIncrease, Transaction, TransferAction } from "@/lib/types";
import {
  paths,
  type AccountsResponse,
  type ActionsResponse,
  type InsightsResponse,
  type TransactionsResponse,
} from "./components/api";
import {
  ActionStateBadge,
  Badge,
  CapabilityChips,
  CreatorBadge,
  HoldReasonChip,
  SyntheticLabel,
} from "./components/Badge";
import { Card, EmptyState, Loading } from "./components/Card";
import { ErrorBox } from "./components/ErrorBox";
import { formatCents, formatDateTime, formatMonth, formatPct, formatTxnDate, mask } from "./components/format";
import { Money } from "./components/Money";
import { useApiData } from "./components/useApiData";

export default function HubPage() {
  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const insights = useApiData<InsightsResponse>(paths.insights);
  const actions = useApiData<ActionsResponse>(paths.actions);
  const txns = useApiData<TransactionsResponse>(paths.transactions({ limit: 10 }));

  const accountList = accounts.data?.accounts ?? [];
  const accountById = new Map(accountList.map((a) => [a.id, a]));

  return (
    <div className="space-y-6">
      <NetWorth data={accounts.data} loading={accounts.loading} />
      <ErrorBox error={accounts.error} title="Couldn't load accounts" onRetry={() => void accounts.reload()} />

      <section aria-labelledby="accounts-heading">
        <h2 id="accounts-heading" className="sr-only">
          Accounts
        </h2>
        {accounts.loading && !accounts.data ? (
          <Loading label="Loading accounts…" />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {accountList.map((a) => (
              <AccountCard key={a.id} account={a} />
            ))}
          </div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="min-w-0 space-y-6 lg:col-span-3">
          <NeedsAttention
            insights={insights.data}
            insightsError={insights.error}
            actions={actions.data?.actions ?? null}
            actionsError={actions.error}
            loading={(insights.loading && !insights.data) || (actions.loading && !actions.data)}
            accountById={accountById}
          />
          <RecentActivity
            transactions={txns.data?.transactions ?? null}
            error={txns.error}
            loading={txns.loading && !txns.data}
            accountById={accountById}
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <SpendingCard insights={insights.data} error={insights.error} loading={insights.loading && !insights.data} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function NetWorth({ data, loading }: { data: AccountsResponse | null; loading: boolean }) {
  const total = data ? (Number.isFinite(data.netWorthCents) ? data.netWorthCents : data.accounts.reduce((s, a) => s + a.balanceCents, 0)) : null;
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Net worth across your linked accounts</p>
          <p className="mt-1 text-4xl font-semibold tracking-tight tabular-nums text-zinc-900 sm:text-5xl dark:text-zinc-50">
            {total === null ? (loading ? <span className="text-zinc-300 dark:text-zinc-700">$—</span> : "—") : formatCents(total)}
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            {data ? (
              <>
                {data.accounts.length} account{data.accounts.length === 1 ? "" : "s"} · as of {formatDateTime(data.asOf)}
              </>
            ) : (
              " "
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/transfers"
            className="rounded-lg bg-brand-700 px-3.5 py-2 text-sm font-medium text-white shadow-sm hover:bg-brand-800 dark:bg-brand-500 dark:text-zinc-950 dark:hover:bg-brand-400"
          >
            New transfer
          </Link>
          <Link
            href="/chat"
            className="rounded-lg border border-zinc-300 bg-white px-3.5 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            Ask ClearFi
          </Link>
        </div>
      </div>
    </div>
  );
}

function AccountCard({ account: a }: { account: Account }) {
  return (
    <article className="flex min-w-0 flex-col rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium tracking-wide break-words text-zinc-500 uppercase dark:text-zinc-400">{a.institution}</p>
          <h3 className="mt-0.5 flex min-w-0 items-baseline gap-1.5 font-semibold text-zinc-900 dark:text-zinc-50">
            <span className="truncate">{a.name}</span>
            <span className="shrink-0 font-normal text-zinc-500 tabular-nums dark:text-zinc-400">{mask(a.mask)}</span>
          </h3>
        </div>
        <SyntheticLabel />
      </div>
      <p className="mt-4 text-2xl font-semibold tracking-tight">
        <Money cents={a.balanceCents} />
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        <Money cents={a.availableCents} /> available · <span className="capitalize">{a.type}</span>
      </p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        <CapabilityChips capabilities={a.capabilities} />
      </div>
      <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-500">Updated {formatDateTime(a.updatedAt)}</p>
    </article>
  );
}

// ---------------------------------------------------------------------------

function NeedsAttention({
  insights,
  insightsError,
  actions,
  actionsError,
  loading,
  accountById,
}: {
  insights: InsightsResponse | null;
  insightsError: unknown;
  actions: TransferAction[] | null;
  actionsError: unknown;
  loading: boolean;
  accountById: Map<string, Account>;
}) {
  const pending = (actions ?? []).filter((a) => a.state === "HELD" || a.state === "AWAITING_APPROVAL");
  const subs = insights?.subscriptions ?? [];
  const count = pending.length + subs.length;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Needs attention
          {count > 0 && <Badge tone="amber">{count}</Badge>}
        </span>
      }
      subtitle="Transfers waiting on you and changes ClearFi spotted in your synthetic transactions."
    >
      <div className="space-y-3">
        <ErrorBox error={actionsError} title="Couldn't load transfers" />
        <ErrorBox error={insightsError} title="Couldn't load insights" />
        {loading ? (
          <Loading />
        ) : count === 0 && !actionsError && !insightsError ? (
          <EmptyState>Nothing needs your attention right now.</EmptyState>
        ) : null}

        {pending.length > 0 && (
          <ul className="space-y-2">
            {pending.map((a) => (
              <li key={a.id}>
                <Link
                  href={`/transfers?id=${encodeURIComponent(a.id)}`}
                  className="group block rounded-xl border border-zinc-200 p-3 transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:border-zinc-800 dark:hover:border-brand-800 dark:hover:bg-brand-950/30"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <ActionStateBadge state={a.state} />
                      <span className="truncate font-medium">
                        <Money cents={a.amountCents} /> to {a.destination.displayName}
                      </span>
                    </div>
                    <span className="text-sm font-medium text-brand-700 group-hover:underline dark:text-brand-400">
                      {a.state === "AWAITING_APPROVAL" ? "Review & approve →" : "Review hold →"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <CreatorBadge createdBy={a.createdBy} />
                    {a.holdReasons.map((r) => (
                      <HoldReasonChip key={r} reason={r} />
                    ))}
                    <span>v{a.version} · {formatDateTime(a.createdAt)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {subs.length > 0 && (
          <ul className="space-y-2">
            {subs.map((s) => (
              <SubscriptionItem
                key={`${s.merchant}-${s.accountId}`}
                sub={s}
                evidence={insights?.evidence ?? {}}
                account={accountById.get(s.accountId)}
              />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function SubscriptionItem({
  sub,
  evidence,
  account,
}: {
  sub: SubscriptionIncrease;
  evidence: Record<string, Transaction>;
  account: Account | undefined;
}) {
  // Computed from cents so it doesn't depend on whether increasePct is a fraction or a percent.
  const pct = sub.previousAmountCents > 0 ? (sub.increaseCents / sub.previousAmountCents) * 100 : NaN;
  const rows = sub.evidenceTransactionIds.map((id) => ({ id, tx: evidence[id] as Transaction | undefined }));

  return (
    <li className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="amber">Price increase</Badge>
          <span className="font-medium">{sub.merchant}</span>
        </div>
        <span className="text-sm whitespace-nowrap">
          <Money cents={sub.previousAmountCents} className="text-zinc-500 line-through decoration-zinc-400 dark:text-zinc-400" />
          <span aria-label="to" className="mx-1.5 text-zinc-400">
            →
          </span>
          <Money cents={sub.currentAmountCents} className="font-semibold" />
          <span className="ml-2 font-medium text-amber-700 tabular-nums dark:text-amber-400">{formatPct(pct)}</span>
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
        Monthly charge up <Money cents={sub.increaseCents} /> · latest {formatTxnDate(sub.latestChargeAt)}
        {account ? ` · ${account.name} ${mask(account.mask)}` : ""}
      </p>
      <details className="group mt-2">
        <summary className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 select-none hover:underline dark:text-brand-400">
          <span className="inline-block transition-transform group-open:rotate-90" aria-hidden>
            ▸
          </span>
          Show evidence ({rows.length} transaction{rows.length === 1 ? "" : "s"})
        </summary>
        <ul className="mt-2 divide-y divide-zinc-100 rounded-lg border border-zinc-100 text-xs dark:divide-zinc-800 dark:border-zinc-800">
          {rows.map(({ id, tx }) => (
            <li key={id} className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-3 gap-y-0.5 px-3 py-2">
              <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{tx ? formatTxnDate(tx.postedAt) : "—"}</span>
              <span className="min-w-0 truncate">{tx ? tx.description : "Transaction not returned"}</span>
              <span className="text-right">{tx ? <Money cents={tx.amountCents} signed /> : "—"}</span>
              <code className="col-span-3 font-mono text-[11px] break-all text-zinc-400 dark:text-zinc-500">{id}</code>
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------------------

function SpendingCard({ insights, error, loading }: { insights: InsightsResponse | null; error: unknown; loading: boolean }) {
  const s = insights?.spending;
  const total = s ? Math.abs(s.totalCents) : 0;
  const prev = s ? Math.abs(s.previousTotalCents) : 0;
  const delta = total - prev;
  const deltaPct = prev > 0 ? (delta / prev) * 100 : NaN;
  const categories = s ? [...s.byCategory].map((c) => ({ ...c, abs: Math.abs(c.totalCents) })).sort((a, b) => b.abs - a.abs).slice(0, 6) : [];
  const maxCat = categories.reduce((m, c) => Math.max(m, c.abs), 0);

  return (
    <Card title="Spending" subtitle={s ? formatMonth(s.month) : "This month"}>
      <ErrorBox error={error} title="Couldn't load spending" />
      {loading ? (
        <Loading />
      ) : s ? (
        <div className="space-y-5">
          <div>
            <p className="text-3xl font-semibold tracking-tight">
              <Money cents={total} />
            </p>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              vs <Money cents={prev} /> in {formatMonth(s.previousMonth)}
              {Number.isFinite(deltaPct) && (
                <span
                  className={`ml-2 font-medium tabular-nums ${delta > 0 ? "text-amber-700 dark:text-amber-400" : "text-green-700 dark:text-green-400"}`}
                >
                  {delta > 0 ? "▲" : delta < 0 ? "▼" : ""} {formatPct(deltaPct)}
                </span>
              )}
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{s.transactionCount} transactions this month</p>
          </div>

          <div>
            <h3 className="mb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">Top categories</h3>
            {categories.length === 0 ? (
              <p className="text-sm text-zinc-500">No spending yet this month.</p>
            ) : (
              <ul className="space-y-2.5">
                {categories.map((c) => (
                  <li key={c.category}>
                    <div className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="truncate capitalize">{c.category}</span>
                      <Money cents={c.abs} className="font-medium" />
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-brand-600 dark:bg-brand-500"
                        style={{ width: `${maxCat > 0 ? Math.max(2, (c.abs / maxCat) * 100) : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800/60 dark:text-zinc-300">
            <span aria-hidden className="mr-1">
              ⇄
            </span>
            <Money cents={Math.abs(s.excludedInternalTransferCents)} className="font-semibold" /> of transfers between your own
            accounts excluded
          </p>
        </div>
      ) : null}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function RecentActivity({
  transactions,
  error,
  loading,
  accountById,
}: {
  transactions: Transaction[] | null;
  error: unknown;
  loading: boolean;
  accountById: Map<string, Account>;
}) {
  return (
    <Card title="Recent activity" subtitle="Latest 10 transactions across all accounts">
      <ErrorBox error={error} title="Couldn't load transactions" />
      {loading ? (
        <Loading />
      ) : transactions && transactions.length === 0 ? (
        <EmptyState>No transactions yet.</EmptyState>
      ) : (
        <ul className="-mx-1 divide-y divide-zinc-100 dark:divide-zinc-800">
          {(transactions ?? []).map((t) => {
            const acct = accountById.get(t.accountId);
            return (
              <li key={t.id} className="flex items-start justify-between gap-3 px-1 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{t.merchant ?? t.description}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
                    <span className="tabular-nums">{formatTxnDate(t.postedAt, { short: true })}</span>
                    <span className="capitalize">{t.category}</span>
                    {acct && (
                      <span>
                        {acct.name} {mask(acct.mask)}
                      </span>
                    )}
                    {t.status === "pending" && <Badge tone="amber">Pending</Badge>}
                    {t.transferGroupId && <Badge tone="gray">Own-account transfer</Badge>}
                    {t.actionId && (
                      <Link href={`/transfers?id=${encodeURIComponent(t.actionId)}`} className="text-brand-700 hover:underline dark:text-brand-400">
                        ClearFi transfer →
                      </Link>
                    )}
                  </p>
                </div>
                <Money cents={t.amountCents} signed colorize className="shrink-0 text-sm font-medium" />
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
