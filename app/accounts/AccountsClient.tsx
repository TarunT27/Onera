"use client";
import type { Portfolio } from "@/lib/markets";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Bank,
  MagnifyingGlass,
  Plus,
  ArrowsClockwise,
  CaretRight,
  ArrowLeft,
  CreditCard,
} from "@phosphor-icons/react";
import type { Connection, Institution, SyncSummary } from "@/lib/providers";
import {
  api,
  paths,
  type AccountsResponse,
} from "../components/api";
import { useApiData } from "../components/useApiData";
import { Button, inputClass } from "../components/Button";
import { Card, Loading, EmptyState } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { AccountPanel } from "./AccountPanel";
import { CurrencyValue } from "./CurrencyValue";

export function AccountsClient() {
  const search = useSearchParams();
  const router = useRouter();
  const selected = search.get("id");
  useEffect(() => {
    if (selected) {
      const heading = document.getElementById("account-heading");
      heading?.scrollIntoView({ block: "start" });
      heading?.focus({ preventScroll: true });
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
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [activityRevision, setActivityRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [showBanks, setShowBanks] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const activeId = previewId ?? selected;
  const preview = previewId !== null;
  const account = accounts.data?.accounts.find((a) => a.id === activeId);
  const rates = accounts.data?.netWorth?.fxRates ?? [];
  const holding = portfolio.data?.portfolio.accounts.find(
    (a) => a.accountId === activeId,
  );
  const rows = (accounts.data?.accounts ?? []).filter(
    (a) =>
      (kind === "all" || a.type === kind) &&
      `${a.name} ${a.institution} ${a.mask}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => { setPreviewId(null); }, [selected]);
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
      ]);
      setActivityRevision((value) => value + 1);
      if (key.startsWith("link")) setShowBanks(false);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }
  function choose(id: string | null) {
    setQuery("");
    setPreviewId(null);
    router.push(
      id
        ? `/accounts?id=${encodeURIComponent(id)}&view=activity`
        : "/accounts?view=activity",
      { scroll: false },
    );
  }
  function previewAccount(id: string) {
    if (window.matchMedia("(min-width: 1001px)").matches) {
      setPreviewId(id === selected ? null : id);
    }
  }
  if (selected) {
    const openedAccount = accounts.data?.accounts.find((a) => a.id === selected);
    return (
      <div className="account-detail-page">
        <Button variant="ghost" className="account-back" onClick={() => choose(null)}><ArrowLeft size={18} aria-hidden />All accounts</Button>
        <div className="page-intro account-detail-intro">
          <h1 id="account-heading" tabIndex={-1}>{openedAccount?.name ?? "Account details"}</h1>
          <p>{openedAccount ? `${openedAccount.institution} · ••${openedAccount.mask} · ${openedAccount.currency}` : "Your account information"}</p>
        </div>
        <p className="account-disclaimer">{openedAccount?.paper ? "Paper account · Excluded from total balance. " : ""}Synthetic account and transaction data. No real funds or bank credentials are used.</p>
        <ErrorBox error={accounts.error} onRetry={() => void accounts.reload()} />
        <ErrorBox error={connections.error} onRetry={() => void connections.reload()} />
        {!accounts.data ? <Loading label="Loading account…" /> : !openedAccount ? (
          <ErrorBox error={new Error("This account is not available. Return to All accounts to choose another.")} />
        ) : (
          <>
            <label className="sr-only" htmlFor="account-activity-search">Search this account's transactions</label>
            <input id="account-activity-search" className={`${inputClass} account-activity-search`} placeholder="Search this account’s transactions" value={query} onChange={(event) => setQuery(event.target.value)} />
            <AccountPanel key={`${selected}:${activityRevision}`} account={openedAccount} preview={false}
              holding={portfolio.data?.portfolio.accounts.find((a) => a.accountId === selected)} rates={rates}
              connection={connections.data?.connections.find((c) => c.id === openedAccount.connectionId)}
              query={query} holdingsError={portfolio.error} onOpen={choose} />
          </>
        )}
      </div>
    );
  }
  return (
    <div className="account-directory">
      <div className="page-intro flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>Your accounts</h1>
          <p>Balances and activity, in one place.</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowBanks(!showBanks)}
          aria-expanded={showBanks}
          aria-label={showBanks ? "Close bank picker" : "Link demo bank"}
        >
          <Plus size={18} aria-hidden />
          {showBanks ? "Close bank picker" : "Link bank"}
        </Button>
      </div>
      <p className="account-disclaimer">
        Synthetic data · Simulated connections. No real funds or credentials.
        International accounts are view-only.
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
            onChange={(e) => { setQuery(e.target.value); setPreviewId(null); }}
          />
        </div>
        <label className="sr-only" htmlFor="account-type">
          Account type
        </label>
        <select
          id="account-type"
          className={`${inputClass} !w-auto`}
          value={kind}
          onChange={(e) => { setKind(e.target.value); setPreviewId(null); }}
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
          className="account-list-card"
          bodyClassName="account-list-body"
          action={<Button variant="ghost" size="sm" onClick={() => choose(null)}>All activity</Button>}
        >
          <p className="account-list-hint">
            <span className="account-hint-desktop">Hover or focus to preview activity. Click to open the account.</span>
            <span className="account-hint-mobile">Tap an account to view its details and transactions.</span>
          </p>
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
                onPointerEnter={(event) => { if (event.pointerType === "mouse") previewAccount(a.id); }}
                onFocus={() => previewAccount(a.id)}
                onKeyDown={(event) => { if (event.key === "Escape") setPreviewId(null); }}
                aria-controls="account-detail"
                aria-pressed={selected === a.id}
                className={`account-row w-full text-left ${selected === a.id ? "account-selected" : ""} ${previewId === a.id ? "account-previewed" : ""}`}
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
                    : <CurrencyValue cents={portfolio.data?.portfolio.accounts.find(
                          (p) => p.accountId === a.id,
                        )?.totalCents ?? a.balanceCents} currency={a.currency} rates={rates} />}
                </span>
                <CaretRight size={16} aria-hidden />
              </button>
            ))
          )}
        </Card>
        <div id="account-detail" className="account-panel-column" tabIndex={-1} role="region" aria-label={preview ? "Account activity preview" : "Account details and activity"}>
          {activeId && !account ? (
            accounts.data ? <ErrorBox error={new Error("This account is not available. Choose another account.")} /> : <Loading label="Loading account…" />
          ) : <AccountPanel
            key={`${activeId ?? "all"}:${preview ? "preview" : "details"}:${activityRevision}`}
            account={account}
            preview={preview}
            holding={holding}
            rates={rates}
            connection={connections.data?.connections.find((c) => c.id === account?.connectionId)}
            query={query}
            holdingsError={portfolio.error}
            onOpen={choose}
          />}
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
