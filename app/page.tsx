"use client";
import type { Portfolio } from "@/lib/markets";
import Link from "next/link";
import {
  Bank,
  CreditCard,
  ChartBar,
  TrendUp,
  CaretRight,
  Sparkle,
  Info,
  WarningCircle,
  Receipt,
  ArrowRight,
  Coffee,
  ShoppingCart,
  PlayCircle,
} from "@phosphor-icons/react";
import { useState } from "react";
import { useApiData } from "./components/useApiData";
import {
  paths,
  clearfi,
  type AccountsResponse,
  type ActionsResponse,
  type InsightsResponse,
  type TransactionsResponse,
  type SessionResponse,
  type RecipientsResponse,
} from "./components/api";
import { ErrorBox } from "./components/ErrorBox";
import { PaperLabel } from "./components/Badge";
import { MonitoringPanel } from "./components/MonitoringPanel";
import { Loading } from "./components/Card";
import { formatCents } from "@/lib/finance/money";
import { useRouter } from "next/navigation";
export default function OverviewPage() {
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const insights = useApiData<InsightsResponse>(paths.insights);
  const actions = useApiData<ActionsResponse>(paths.actions);
  const txns = useApiData<TransactionsResponse>(
    paths.transactions({ limit: 3 }),
  );
  const session = useApiData<SessionResponse>(paths.session);
  const recipients = useApiData<RecipientsResponse>(paths.recipients);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const router = useRouter();
  const pending = actions.data?.actions.find(
    (a) => a.state === "HELD" || a.state === "AWAITING_APPROVAL",
  );
  const changed = recipients.data?.recipients.find(
    (r) => r.status === "changed" && (!pending || r.id === pending.recipientId),
  );
  const sub =
    insights.data?.subscriptions.find((s) => s.merchant === "StreamFlix") ??
    insights.data?.subscriptions[0];
  const accts = (accounts.data?.accounts ?? [])
    .filter((a) => !a.paper)
    .sort(
      (a, b) =>
        (a.connectionId ? 1 : 0) - (b.connectionId ? 1 : 0) ||
        { checking: 0, savings: 1, brokerage: 2, credit: 3 }[a.type] -
          { checking: 0, savings: 1, brokerage: 2, credit: 3 }[b.type],
    );
  async function reviewChanged() {
    if (pending) {
      router.push(`/transfers?id=${encodeURIComponent(pending.id)}`);
      return;
    }
    const source = accts.find(
      (a) => a.currency === "USD" && a.capabilities.includes("transfer_source"),
    );
    if (!source || !changed) {
      router.push("/transfers");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { action } = await clearfi.createTransfer({
        sourceAccountId: source.id,
        recipientId: changed.id,
        amountCents: 185000,
        currency: "USD",
        memo: "Rent · synthetic demo scenario",
      });
      router.push(`/transfers?id=${encodeURIComponent(action.id)}`);
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  }
  const paperAccounts = (accounts.data?.accounts ?? []).filter((a) => a.paper);
  const date = accounts.data ? new Date(accounts.data.asOf) : null;
  return (
    <div className="overview">
      <div className="overview-heading">
        <h1>Hello, {session.data?.user.name.split(" ")[0] ?? "there"}.</h1>
        <p>
          {date
            ? date.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })
            : "Your money, in one place."}
        </p>
      </div>
      <ErrorBox error={error} />
      <ErrorBox
        error={accounts.error}
        title="Couldn't load accounts"
        onRetry={() => void accounts.reload()}
      />
      <ErrorBox error={actions.error} title="Couldn't load transfers" />
      <ErrorBox error={recipients.error} title="Couldn't load recipients" />
      <div className="overview-grid">
        <section className="balance-hero" aria-label="Total balance">
          <div className="balance-label">
            Total balance{" "}
            <span title="USD equivalent of cash, debt and simulated investments. Paper accounts excluded.">
              <Info
                size={21}
                aria-label="Balance includes currency conversion and simulated investments"
              />
            </span>
          </div>
          {accounts.data ? (
            <p className="balance-amount">
              {formatCents(accounts.data.netWorthCents)}
            </p>
          ) : (
            <Loading label="Loading balance…" />
          )}
          <p className="balance-note">
            Across your demo accounts · USD equivalent · paper trading
            excluded
          </p>
          <div className="hero-actions">
            <Link href="/transfers" className="pill">
              New transfer
              <CaretRight size={21} aria-hidden />
            </Link>
            <Link href="/chat" className="pill secondary">
              <Sparkle size={23} color="#8cb9cc" aria-hidden />
              Ask ClearFi
            </Link>
          </div>
        </section>
        <section className="surface">
          <header className="surface-head">
            <h2>Your accounts</h2>
            <Link href="/accounts" className="quiet-link">
              View all
              <CaretRight size={18} aria-hidden />
            </Link>
          </header>
          <div className="account-list">
            <ErrorBox
              error={portfolio.error}
              title="Couldn't load holdings"
              onRetry={() => void portfolio.reload()}
            />
            {accts.slice(0, 3).map((a) => {
              const Icon =
                a.type === "checking"
                  ? CreditCard
                  : a.type === "savings"
                    ? ChartBar
                    : TrendUp;
              return (
                <Link
                  href={`/accounts?id=${encodeURIComponent(a.id)}`}
                  key={a.id}
                  className="account-row"
                >
                  <span className="round-icon">
                    <Icon size={26} weight="light" aria-hidden />
                  </span>
                  <div className="row-body">
                    <p className="row-title">{a.name}</p>
                    <p className="row-meta">•• {a.mask}</p>
                    {a.capabilities.length === 1 && (
                      <p className="row-meta">View-only demo import</p>
                    )}
                  </div>
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
                  <CaretRight className="row-chevron" size={17} aria-hidden />
                </Link>
              );
            })}
            {accounts.loading && !accounts.data && <Loading />}
            {paperAccounts.map((a) => (
              <Link
                href={`/accounts?id=${encodeURIComponent(a.id)}`}
                key={a.id}
                className="account-row paper-row"
              >
                <span className="round-icon muted">
                  <TrendUp size={22} weight="light" aria-hidden />
                </span>
                <div className="row-body">
                  <p className="row-title">{a.name}</p>
                  <p className="row-meta">
                    <PaperLabel />
                  </p>
                </div>
                <CaretRight className="row-chevron" size={17} aria-hidden />
              </Link>
            ))}
          </div>
        </section>
        {(pending || changed) && (
          <section className="attention-strip">
            <WarningCircle
              className="attention-icon"
              size={34}
              weight="fill"
              aria-hidden
            />
            <div className="attention-content">
              <strong>
                {pending
                  ? `${formatCents(pending.amountCents)} transfer needs review`
                  : "Bank details need your review"}
              </strong>
              <p>
                {pending
                  ? `${pending.destination.displayName} · ${pending.state === "HELD" ? "On hold" : "Awaiting your approval"}`
                  : `${changed!.displayName} changed its bank details.`}
              </p>
            </div>
            {changed?.previousDetails && (
              <div className="attention-details">
                <p>
                  Previously verified · {changed.previousDetails.institution} ••
                  {changed.previousDetails.accountMask}
                </p>
                <p>
                  Requested · {changed.details.institution} ••
                  {changed.details.accountMask}
                </p>
              </div>
            )}
            <button
              className="pill small"
              onClick={reviewChanged}
              disabled={busy}
            >
              {busy
                ? "Opening…"
                : pending
                  ? "Review transfer"
                  : "Try rent review"}
              <CaretRight size={18} aria-hidden />
            </button>
          </section>
        )}
        <div className="overview-bottom">
          <section className="surface">
            <header className="surface-head">
              <h2>{sub ? "One thing changed" : "All caught up"}</h2>
              {sub && (
                <span className="quiet-link">
                  Latest{" "}
                  {new Date(sub.latestChargeAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })}
                </span>
              )}
            </header>
            <div className="insight-body">
              <ErrorBox
                error={insights.error}
                onRetry={() => void insights.reload()}
              />
              {insights.loading && !insights.data ? (
                <Loading />
              ) : sub ? (
                <>
                  <p className="insight-subtitle">
                    A subscription increased in price.
                  </p>
                  <div className="subscription-row">
                    <span className="round-icon muted">
                      <PlayCircle
                        size={32}
                        color="#f36c81"
                        weight="fill"
                        aria-hidden
                      />
                    </span>
                    <strong>{sub.merchant}</strong>
                    <div className="subscription-price">
                      <p>
                        <span style={{ color: "#a5aeb7" }}>
                          {formatCents(sub.previousAmountCents)}
                        </span>
                        <ArrowRight size={20} aria-label="increased to" />
                        {formatCents(sub.currentAmountCents)}
                      </p>
                      <small>
                        Up {formatCents(sub.increaseCents)} this month
                      </small>
                    </div>
                  </div>
                  <details className="evidence">
                    <summary>
                      <Receipt size={21} aria-hidden />
                      View details
                      <CaretRight size={18} aria-hidden />
                    </summary>
                    <p className="row-meta">
                      Based on your synthetic transaction history.
                    </p>
                    <ul>
                      {sub.evidenceTransactionIds.map((id) => {
                        const t = insights.data?.evidence[id];
                        return t ? (
                          <li key={id}>
                            <span>
                              {new Date(t.postedAt).toLocaleDateString()} ·{" "}
                              {t.description}
                            </span>
                            <span>
                              {formatCents(t.amountCents, t.currency)}
                            </span>
                          </li>
                        ) : null;
                      })}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="row-meta">
                  No subscription increases found in your current activity.
                </p>
              )}
            </div>
          </section>
          <section className="surface">
            <header className="surface-head">
              <h2>Recent activity</h2>
              <Link href="/accounts?view=activity" className="quiet-link">
                View all
                <CaretRight size={18} aria-hidden />
              </Link>
            </header>
            <div className="activity-list">
              <ErrorBox error={txns.error} onRetry={() => void txns.reload()} />
              {txns.loading && !txns.data ? (
                <Loading />
              ) : (
                txns.data?.transactions.map((t) => {
                  const Icon =
                    t.category === "food_drink"
                      ? Coffee
                      : t.merchant === "StreamFlix"
                        ? PlayCircle
                        : ShoppingCart;
                  return (
                    <Link
                      className="activity-row"
                      href={`/accounts?id=${encodeURIComponent(t.accountId)}&view=activity`}
                      key={t.id}
                    >
                      <span className="round-icon muted">
                        <Icon size={24} weight="light" aria-hidden />
                      </span>
                      <time dateTime={t.postedAt}>
                        {new Date(t.postedAt).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </time>
                      <span className="activity-name">
                        {t.merchant ?? t.description}
                      </span>
                      <span className="row-value">
                        {formatCents(t.amountCents, t.currency)}
                      </span>
                    </Link>
                  );
                })
              )}
              {txns.data?.transactions.length === 0 && (
                <p className="row-meta">
                  No activity yet.{" "}
                  <Link href="/accounts">Explore accounts</Link>
                </p>
              )}
            </div>
          </section>
        </div>
        <MonitoringPanel
          accounts={accounts.data?.accounts}
          actions={actions.data?.actions}
        />
      </div>
    </div>
  );
}
