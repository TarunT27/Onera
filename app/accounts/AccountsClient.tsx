"use client";
import type { Portfolio } from "@/lib/markets";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bank,
  MagnifyingGlass,
  Plus,
  ArrowsClockwise,
  CaretRight,
  ArrowLeft,
  ArrowUpRight,
  CreditCard,
} from "@phosphor-icons/react";
import type { Connection, Institution, SyncSummary } from "@/lib/providers";
import {
  api,
  paths,
  type AccountsResponse,
  type TransactionsResponse,
} from "../components/api";
import { useApiData } from "../components/useApiData";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, Loading, EmptyState } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents } from "@/lib/finance/money";

export function AccountsClient() {
  const search = useSearchParams();
  const router = useRouter();
  const selected = search.get("id");
  useEffect(() => {
    if (selected && window.matchMedia("(max-width: 1000px)").matches) {
      document
        .getElementById("account-detail")
        ?.scrollIntoView({ block: "start" });
    }
  }, [selected]);
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const connections = useApiData<{ connections: Connection[] }>(
    "/api/connections",
  );
  const institutions = useApiData<{ institutions: Institution[] }>(
    "/api/institutions",
  );
  const transactions = useApiData<TransactionsResponse>(
    paths.transactions({ accountId: selected ?? undefined, limit: 100 }),
  );
  const [visibleCount, setVisibleCount] = useState(12);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [showBanks, setShowBanks] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const account = accounts.data?.accounts.find((a) => a.id === selected);
  const holding = portfolio.data?.portfolio.accounts.find(
    (a) => a.accountId === selected,
  );
  const rows = (accounts.data?.accounts ?? []).filter(
    (a) =>
      (kind === "all" || a.type === kind) &&
      `${a.name} ${a.institution} ${a.mask}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const txs = (transactions.data?.transactions ?? []).filter((t) =>
    `${t.description} ${t.merchant ?? ""} ${t.category}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  async function run(key: string, path: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setNotice("");
    try {
      const result = await api.post<{ sync?: SyncSummary }>(path, body);
      setNotice(
        result.sync
          ? `Sync complete. ${result.sync.added} added, ${result.sync.modified} updated.`
          : key.startsWith("link")
            ? "Demo bank linked. Accounts are ready."
            : "Connection updated.",
      );
      await Promise.all([
        accounts.reload(),
        connections.reload(),
        transactions.reload(),
      ]);
      if (key.startsWith("link")) setShowBanks(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  function choose(id: string | null) {
    setQuery("");
    setVisibleCount(12);
    router.push(
      id
        ? `/accounts?id=${encodeURIComponent(id)}&view=activity`
        : "/accounts?view=activity",
      { scroll: false },
    );
  }
  return (
    <div>
      <div className="page-intro flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Your accounts</h1>
          <p>One clear view. Every balance, every bank.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowBanks(!showBanks)}
          aria-expanded={showBanks}
        >
          <Plus size={18} aria-hidden />
          {showBanks ? "Close bank picker" : "Link demo bank"}
        </Button>
      </div>
      <p className="mb-6 text-sm text-zinc-400">
        Simulated connections only. No bank credentials or real funds are used.
        International accounts are view-only; totals use dated demo exchange
        rates.
      </p>
      <ErrorBox error={error} />
      <ErrorBox error={accounts.error} onRetry={() => void accounts.reload()} />
      <ErrorBox
        error={connections.error}
        onRetry={() => void connections.reload()}
      />
      {notice && (
        <p
          role="status"
          className="mb-5 rounded-xl bg-brand-950 p-4 text-brand-200"
        >
          {notice}
        </p>
      )}
      {showBanks && (
        <Card
          title="Choose a demo bank"
          subtitle="Explore realistic synthetic accounts and 90 days of activity."
          className="mb-6"
        >
          <ErrorBox error={institutions.error} />
          {institutions.loading && !institutions.data ? (
            <Loading />
          ) : (
            <div className="bank-grid">
              {institutions.data?.institutions.map((i) => {
                const linked = connections.data?.connections.some(
                  (c) =>
                    c.institutionId === i.id && c.status !== "disconnected",
                );
                return (
                  <article className="bank-item" key={i.id}>
                    <Bank
                      size={24}
                      className="mb-3 text-brand-300"
                      aria-hidden
                    />
                    <h3>{i.name}</h3>
                    <p>
                      {i.country} · {i.currency} · {i.products.join(", ")}
                      <br />
                      {i.supportsTransfers
                        ? "Simulated transfers supported"
                        : "View-only accounts"}
                    </p>
                    <Button
                      disabled={linked || !!busy || !connections.data}
                      busy={busy === `link-${i.id}`}
                      onClick={() =>
                        run(`link-${i.id}`, "/api/connections", {
                          institutionId: i.id,
                        })
                      }
                    >
                      {linked ? "Already linked" : `Link ${i.brand}`}
                    </Button>
                    <p className="!mb-0 text-xs">{i.disclaimer}</p>
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <div className="account-toolbar">
        <label className="sr-only" htmlFor="account-search">
          Search accounts or activity
        </label>
        <div className="relative flex-1">
          <MagnifyingGlass
            size={19}
            className="absolute left-3 top-3 text-zinc-400"
            aria-hidden
          />
          <input
            id="account-search"
            className={`${inputClass} !pl-10`}
            placeholder="Search accounts or activity"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="account-type">
          Account type
        </label>
        <select
          id="account-type"
          className={`${inputClass} !w-auto`}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">All account types</option>
          <option value="checking">Checking</option>
          <option value="savings">Savings</option>
          <option value="credit">Credit</option>
          <option value="brokerage">Brokerage</option>
        </select>
      </div>
      <div className="account-workspace">
        <Card
          title="Accounts"
          subtitle={`${accounts.data?.accounts.length ?? "…"} synthetic accounts`}
        >
          <Button variant="ghost" onClick={() => choose(null)} className="mb-3">
            All activity
          </Button>
          {accounts.loading && !accounts.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState>
              No matching accounts. Try another search or link a demo bank.
            </EmptyState>
          ) : (
            rows.map((a) => (
              <button
                key={a.id}
                onClick={() => choose(a.id)}
                aria-pressed={selected === a.id}
                className={`account-row w-full text-left ${selected === a.id ? "account-selected" : ""}`}
              >
                <span className="round-icon">
                  <CreditCard size={23} aria-hidden />
                </span>
                <span className="row-body">
                  <span className="row-title block">{a.name}</span>
                  <span className="row-meta block">
                    {a.institution} · ••{a.mask}
                    {a.paper ? " · Paper" : ""}
                  </span>
                </span>
                <span className="row-value">
                  {a.type === "brokerage" && !portfolio.data
                    ? portfolio.error
                      ? "Unavailable"
                      : "Loading…"
                    : formatCents(
                        portfolio.data?.portfolio.accounts.find(
                          (p) => p.accountId === a.id,
                        )?.totalCents ?? a.balanceCents,
                        a.currency,
                      )}
                </span>
                <CaretRight size={16} aria-hidden />
              </button>
            ))
          )}
        </Card>
        <div className="space-y-6">
          {selected && accounts.data && !account && (
            <ErrorBox
              error={
                new Error(
                  "This account is not available. Choose another account.",
                )
              }
            />
          )}
          <Card
            id="account-detail"
            title={account?.name ?? "Recent activity"}
            subtitle={
              account
                ? `${account.institution} · ••${account.mask} · ${account.currency}`
                : "Latest 100 transactions across your accounts"
            }
            action={
              account ? (
                <Button variant="ghost" size="sm" onClick={() => choose(null)}>
                  <ArrowLeft size={16} aria-hidden />
                  All accounts
                </Button>
              ) : undefined
            }
          >
            {account && (
              <div className="mb-6 rounded-2xl bg-brand-950 p-5">
                <p className="text-xs text-brand-200">
                  {account.type === "brokerage"
                    ? "Cash balance"
                    : "Available balance"}
                </p>
                <p className="my-2 text-3xl tracking-tight">
                  {formatCents(account.availableCents, account.currency)}
                </p>
                <p className="text-xs text-zinc-400">
                  {account.capabilities.includes("transfer_source")
                    ? "Eligible for simulated transfers"
                    : "View only · cannot send transfers"}
                  {account.paper ? " · Excluded from total balance" : ""}
                </p>
                {account.capabilities.includes("transfer_source") && (
                  <Link
                    href={`/transfers?source=${encodeURIComponent(account.id)}`}
                    className="quiet-link mt-3"
                  >
                    Transfer from this account
                    <ArrowUpRight size={16} aria-hidden />
                  </Link>
                )}
              </div>
            )}
            <ErrorBox error={portfolio.error} title="Couldn't load holdings" />
            {holding && (
              <section className="mb-6">
                <h3 className="mb-2 text-base font-semibold">Holdings</h3>
                <p className="mb-3 text-xs text-zinc-400">
                  {holding.label} · Prices are simulated.{" "}
                  {holding.paper ? "Excluded from total balance." : ""}
                </p>
                <ul className="divide-y divide-zinc-800">
                  {holding.positions.map((p) => (
                    <li
                      key={p.symbol}
                      className="flex justify-between gap-3 py-3 text-sm"
                    >
                      <span>
                        {p.symbol}
                        <span className="block text-xs text-zinc-400">
                          {(p.quantityMicros / 1_000_000).toLocaleString(
                            undefined,
                            { maximumFractionDigits: 6 },
                          )}{" "}
                          shares
                        </span>
                      </span>
                      <span>{formatCents(p.marketValueCents)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm">
                  Cash + holdings{" "}
                  <strong className="float-right">
                    {formatCents(holding.totalCents)}
                  </strong>
                </p>
              </section>
            )}
            <ErrorBox
              error={transactions.error}
              onRetry={() => void transactions.reload()}
            />
            {transactions.loading ? (
              <Loading label="Loading activity…" />
            ) : txs.length === 0 ? (
              <EmptyState>No matching transactions.</EmptyState>
            ) : (
              <ul className="divide-y divide-zinc-800">
                {txs.slice(0, visibleCount).map((t) => (
                  <li key={t.id} className="py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-medium break-words">
                          {t.merchant ?? t.description}
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          {new Date(t.postedAt).toLocaleDateString()} ·{" "}
                          {t.category} · {t.status}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums">
                        {formatCents(t.amountCents, t.currency)}
                      </span>
                    </div>
                    <details className="mt-2 text-xs text-zinc-400">
                      <summary className="min-h-8 py-2">
                        Transaction details
                      </summary>
                      <p className="py-2">
                        {t.description}
                        {t.transferGroupId
                          ? " · Transfer between your accounts"
                          : ""}
                      </p>
                      {t.actionId && (
                        <Link
                          className="text-brand-200 underline"
                          href={`/transfers?id=${encodeURIComponent(t.actionId)}`}
                        >
                          View transfer receipt
                        </Link>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            )}
            {txs.length > visibleCount && (
              <Button
                className="mt-4 w-full"
                onClick={() => setVisibleCount((c) => c + 12)}
              >
                Show more activity ({txs.length - visibleCount} remaining)
              </Button>
            )}
          </Card>
        </div>
      </div>
      <div className="mt-8">
        <Card
          title="Bank connections"
          subtitle="Sync, reconnect or disconnect your simulated institutions."
        >
          {connections.loading && !connections.data ? (
            <Loading />
          ) : connections.data?.connections.length === 0 ? (
            <EmptyState>
              No banks linked yet. Use “Link demo bank” to explore.
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {connections.data?.connections.map((c) => (
                <article
                  key={c.id}
                  className="rounded-2xl border border-zinc-800 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h3 className="text-base font-semibold">
                        {c.institutionName}
                      </h3>
                      <p className="mt-1 text-sm text-brand-200">
                        {c.status.replace("_", " ")} · {c.accountIds.length}{" "}
                        accounts
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {c.lastSyncedAt
                          ? `Last synced ${new Date(c.lastSyncedAt).toLocaleString()}`
                          : "Not synced yet"}
                      </p>
                      {c.lastError && (
                        <p className="mt-2 max-w-lg text-sm text-amber-200">
                          {c.lastError}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {c.status === "disconnected" ? (
                        <Button
                          disabled={!!busy}
                          onClick={() =>
                            run(`link-${c.institutionId}`, "/api/connections", {
                              institutionId: c.institutionId,
                            })
                          }
                        >
                          Relink
                        </Button>
                      ) : (
                        <>
                          <Button
                            disabled={!!busy}
                            busy={busy === `sync-${c.id}`}
                            onClick={() =>
                              run(
                                `sync-${c.id}`,
                                `/api/connections/${encodeURIComponent(c.id)}/${c.status === "login_required" ? "reconnect" : "sync"}`,
                              )
                            }
                          >
                            <ArrowsClockwise size={17} aria-hidden />
                            {c.status === "login_required"
                              ? "Reconnect"
                              : "Sync now"}
                          </Button>
                          <Button
                            disabled={!!busy}
                            onClick={() => {
                              if (
                                confirm(
                                  "Disconnect this simulated bank? Existing activity stays visible; transfers from these accounts will be unavailable.",
                                )
                              )
                                void run(
                                  `disconnect-${c.id}`,
                                  `/api/connections/${encodeURIComponent(c.id)}/disconnect`,
                                );
                            }}
                          >
                            Disconnect
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {c.status === "healthy" && (
                    <details className="mt-4 text-xs text-zinc-400">
                      <summary className="min-h-8 py-2">Demo scenarios</summary>
                      <p className="my-2">
                        Test how a simulated connection recovers.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            run(
                              `issue-${c.id}`,
                              `/api/connections/${encodeURIComponent(c.id)}/simulate`,
                              { scenario: "login_required" },
                            )
                          }
                        >
                          Simulate expired login
                        </Button>
                        <Button
                          size="sm"
                          disabled={!!busy}
                          onClick={() =>
                            run(
                              `issue-${c.id}`,
                              `/api/connections/${encodeURIComponent(c.id)}/simulate`,
                              { scenario: "error" },
                            )
                          }
                        >
                          Simulate outage
                        </Button>
                      </div>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
