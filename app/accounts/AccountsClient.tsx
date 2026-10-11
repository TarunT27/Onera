"use client";
import type { Portfolio } from "@/lib/markets";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
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
import { PaperLabel } from "../components/Badge";
import { BankLogo, BankMark } from "../components/BankLogo";
import "./account-explorer.css";
import "./accounts-screen.css";
import { AccountPanel } from "./AccountPanel";
import { CurrencyValue } from "./CurrencyValue";
import { directoryActivityScope, CONNECTION_STATUS_LABEL } from "./presentation";
import { useI18n } from "../components/I18nContext";
import { formatDateTime } from "../components/format";

export function AccountsClient() {
  const { t, tp } = useI18n();
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
  const [activityRevision, setActivityRevision] = useState(0);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState("all");
  const [showBanks, setShowBanks] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState("");
  const activeId = selected;
  const preview = false;
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
        .includes(query.trim().toLowerCase()),
  );
  const activityScope = directoryActivityScope(accounts.data?.accounts ?? [], kind, query);
  async function run(key: string, path: string, body?: unknown) {
    setBusy(key);
    setError(null);
    setNotice("");
    try {
      const result = await api.post<{ sync?: SyncSummary }>(path, body);
      setNotice(
        result.sync
          ? t("Sync complete. {added} added, {modified} updated.", { added: result.sync.added, modified: result.sync.modified })
          : key.startsWith("link")
            ? t("Demo bank linked. Accounts are ready.")
            : t("Connection updated."),
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
    router.push(
      id
        ? `/accounts?id=${encodeURIComponent(id)}&view=activity`
        : "/accounts?view=activity",
      { scroll: false },
    );
  }
  if (selected) {
    const openedAccount = accounts.data?.accounts.find((a) => a.id === selected);
    return (
      <div className="account-detail-page screen">
        <div className="account-detail-head">
          <Button variant="ghost" className="account-back" onClick={() => choose(null)}><ArrowLeft size={18} aria-hidden />{t("All accounts")}</Button>
          <div className="page-intro account-detail-intro">
            <h1 id="account-heading" tabIndex={-1}>{openedAccount?.name ?? t("Account details")}</h1>
            <p>{openedAccount ? `${openedAccount.institution} · ••${openedAccount.mask} · ${openedAccount.currency}` : t("Your account information")}</p>
          </div>
        </div>
        <p className="account-disclaimer">{openedAccount?.paper ? `${t("Paper account · Excluded from total balance.")} ` : ""}{t("Synthetic account and transaction data. No real funds or bank credentials are used.")}</p>
        <ErrorBox error={accounts.error} onRetry={() => void accounts.reload()} />
        <ErrorBox error={connections.error} onRetry={() => void connections.reload()} />
        {!accounts.data ? <Loading label={t("Loading account…")} /> : !openedAccount ? (
          <ErrorBox error={new Error(t("This account is not available. Return to All accounts to choose another."))} />
        ) : (
          <>
            <label className="sr-only" htmlFor="account-activity-search">{t("Search this account's transactions")}</label>
            <input id="account-activity-search" className={`${inputClass} account-activity-search`} placeholder={t("Search this account’s transactions")} value={query} onChange={(event) => setQuery(event.target.value)} />
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
    <div className="account-directory screen">
      <div className="page-intro screen-title flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1>{t("Your accounts")}</h1>
          <p>{t("One clear view. Every balance, every bank.")}</p>
        </div>
        <Button
          variant="primary"
          onClick={() => setShowBanks(!showBanks)}
          aria-expanded={showBanks}
          aria-label={showBanks ? t("Close bank picker") : t("Link demo bank")}
        >
          <Plus size={18} aria-hidden />
          {showBanks ? t("Close bank picker") : t("Link demo bank")}
        </Button>
      </div>
      <p className="account-disclaimer">
        {t("Simulated connections only. No bank credentials or real funds are used. International accounts are view-only; totals use dated demo exchange rates.")}
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
      {/* Desktop (901px+): one screen. The toolbar, account list, activity and
          bank connections sit side by side and each scrolls inside itself. */}
      <div className="screen-body account-screen-body">
      {showBanks && (
        <Card
          title={t("Choose a demo bank")}
          subtitle={t("Explore realistic synthetic accounts and 90 days of activity.")}
          className="account-bank-picker mb-6"
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
                    <BankLogo institution={i.brand} size={52} className="mb-3" />
                    <h3>{i.name}</h3>
                    <p>
                      {i.country} · {i.currency} · {i.products.join(", ")}
                      <br />
                      {i.supportsTransfers
                        ? t("Simulated transfers supported")
                        : t("View-only accounts")}
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
                      {linked ? t("Already linked") : t("Link {brand}", { brand: i.brand })}
                    </Button>
                    <p className="!mb-0 text-xs">{t(i.disclaimer)}</p>
                  </article>
                );
              })}
            </div>
          )}
        </Card>
      )}
      <div className="account-toolbar">
        <label className="sr-only" htmlFor="account-search">
          {t("Search accounts or activity")}
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
            placeholder={t("Search accounts or activity")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="sr-only" htmlFor="account-type">
          {t("Account type")}
        </label>
        <select
          id="account-type"
          className={`${inputClass} !w-auto`}
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="all">{t("All account types")}</option>
          <option value="checking">{t("Checking")}</option>
          <option value="savings">{t("Savings")}</option>
          <option value="credit">{t("Credit")}</option>
          <option value="brokerage">{t("Brokerage")}</option>
        </select>
      </div>
      <div className="account-workspace">
        <Card
          title={t("Accounts")}
          subtitle={accounts.data ? tp(accounts.data.accounts.length, "{n} synthetic account", "{n} synthetic accounts") : t("{n} synthetic accounts", { n: "…" })}
          className="account-list-card"
          bodyClassName="account-list-body"
        >
          <p className="account-list-hint">
            <span className="account-hint-desktop">{t("Click an account to view its details and transactions.")}</span>
            <span className="account-hint-mobile">{t("Tap an account to view its details and transactions.")}</span>
          </p>
          {accounts.loading && !accounts.data ? (
            <Loading />
          ) : rows.length === 0 ? (
            <EmptyState>
              {t("No matching accounts. Try another search or link a demo bank.")}
            </EmptyState>
          ) : (
            rows.map((a) => (
              <button
                key={a.id}
                onClick={() => choose(a.id)}
                aria-pressed={selected === a.id}
                className="account-row w-full text-left"
              >
                <span className="round-icon">
                  <CreditCard size={23} aria-hidden />
                </span>
                <span className="row-body">
                  <span className="row-title block">{a.name}</span>
                  <span className="row-meta block">
                    <BankMark institution={a.institution} />
                    {a.institution} · ••{a.mask}
                  </span>
                  {a.paper && <span className="mt-1.5 block"><PaperLabel /></span>}
                </span>
                <span className="row-value">
                  {a.type === "brokerage" && !portfolio.data
                    ? portfolio.error
                      ? t("Unavailable")
                      : t("Loading…")
                    : <CurrencyValue cents={portfolio.data?.portfolio.accounts.find(
                          (p) => p.accountId === a.id,
                        )?.totalCents ?? a.balanceCents} currency={a.currency} rates={rates} />}
                </span>
                <CaretRight size={16} aria-hidden />
              </button>
            ))
          )}
        </Card>
        <div id="account-detail" className="account-panel-column" tabIndex={-1} role="region" aria-label={preview ? t("Account activity preview") : t("Account details and activity")}>
          {activeId && !account ? (
            accounts.data ? <ErrorBox error={new Error(t("This account is not available. Choose another account."))} /> : <Loading label={t("Loading account…")} />
          ) : <AccountPanel
            key={`${activeId ?? "all"}:${kind}:${activityRevision}`}
            account={account}
            preview={preview}
            holding={holding}
            rates={rates}
            connection={connections.data?.connections.find((c) => c.id === account?.connectionId)}
            query={activityScope.query}
            allowedAccountIds={accounts.data ? activityScope.accountIds : undefined}
            holdingsError={portfolio.error}
            onOpen={choose}
          />}
        </div>
      </div>
      <div className="account-connections mt-8">
        <Card
          title={t("Bank connections")}
          subtitle={t("Sync, reconnect or disconnect your simulated institutions.")}
        >
          {connections.loading && !connections.data ? (
            <Loading />
          ) : connections.data?.connections.length === 0 ? (
            <EmptyState>
              {t("No banks linked yet. Use “Link demo bank” to explore.")}
            </EmptyState>
          ) : (
            <div className="space-y-4">
              {connections.data?.connections.map((c) => (
                <article
                  key={c.id}
                  className="rounded-2xl border border-zinc-800 p-5"
                >
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <BankLogo institution={c.institutionName} size={44} />
                      <div>
                      <h3 className="text-base font-semibold">
                        {c.institutionName}
                      </h3>
                      <p className="mt-1 text-sm text-brand-200">
                        {t(CONNECTION_STATUS_LABEL[c.status])} ·{" "}
                        {tp(c.accountIds.length, "{n} account", "{n} accounts")}
                      </p>
                      <p className="mt-1 text-xs text-zinc-400">
                        {c.lastSyncedAt
                          ? t("Last synced {date}", { date: formatDateTime(c.lastSyncedAt, { full: true }) })
                          : t("Not synced yet")}
                      </p>
                      {c.lastError && (
                        <p className="mt-2 max-w-lg text-sm text-amber-200">
                          {t(c.lastError)}
                        </p>
                      )}
                      </div>
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
                          {t("Relink")}
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
                              ? t("Reconnect")
                              : t("Sync now")}
                          </Button>
                          <Button
                            disabled={!!busy}
                            onClick={() => {
                              if (
                                confirm(
                                  t("Disconnect this simulated bank? Existing activity stays visible; transfers from these accounts will be unavailable."),
                                )
                              )
                                void run(
                                  `disconnect-${c.id}`,
                                  `/api/connections/${encodeURIComponent(c.id)}/disconnect`,
                                );
                            }}
                          >
                            {t("Disconnect")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  {c.status === "healthy" && (
                    <details className="mt-4 text-xs text-zinc-400">
                      <summary className="min-h-8 py-2">{t("Demo scenarios")}</summary>
                      <p className="my-2">
                        {t("Test how a simulated connection recovers.")}
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
                          {t("Simulate expired login")}
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
                          {t("Simulate outage")}
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
    </div>
  );
}
