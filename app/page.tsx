"use client";
import type { Portfolio } from "@/lib/markets";
import Link from "next/link";
import {
  CaretRight,
  ArrowRight,
  ArrowUpRight,
  Sparkle,
  Info,
  WarningCircle,
  Receipt,
  Lightbulb,
  ForkKnife,
  Coffee,
  Basket,
  PlayCircle,
  GasPump,
  Lightning,
  Car,
  ShoppingBag,
  ClockCounterClockwise,
  TrendUp,
} from "@phosphor-icons/react";
import { useRef, useState, type CSSProperties } from "react";
import { useApiData } from "./components/useApiData";
import {
  paths,
  clearfi,
  type AccountsResponse,
  type ActionsResponse,
  type InsightsResponse,
  type TransactionsResponse,
  type RecipientsResponse,
} from "./components/api";
import { ErrorBox } from "./components/ErrorBox";
import { PaperLabel } from "./components/Badge";
import { AssistantPanel } from "./components/AssistantPanel";
import { MonitoringPanel } from "./components/MonitoringPanel";
import { useSession } from "./components/SessionContext";
import { EmptyState, Loading } from "./components/Card";
import { formatCents } from "@/lib/finance/money";
import { useRouter } from "next/navigation";
import { useT } from "./components/I18nContext";
import { formatDate } from "./components/format";
import { msg } from "@/lib/i18n/msg";
import type { Translate } from "@/lib/i18n/translate";
import "./overview-screen.css";

const KIND_LABEL = {
  checking: msg("Checking"),
  savings: msg("Savings"),
  brokerage: msg("Brokerage"),
  credit: msg("Credit card"),
} as const;

function categoryIcon(category: string, merchant: string | null) {
  if (/coffee|cafe|bean/i.test(merchant ?? "")) return Coffee;
  switch (category) {
    case "dining":
      return ForkKnife;
    case "groceries":
      return Basket;
    case "subscriptions":
      return PlayCircle;
    case "gas":
      return GasPump;
    case "utilities":
      return Lightning;
    case "transportation":
      return Car;
    default:
      return ShoppingBag;
  }
}

function greeting(t: Translate) {
  const h = new Date().getHours();
  return h < 12 ? t("Good morning") : h < 18 ? t("Good afternoon") : t("Good evening");
}

/** "$42,780.87" → dollars and a quieter ".87". */
function SplitAmount({ cents }: { cents: number }) {
  const text = formatCents(cents);
  const dot = text.lastIndexOf(".");
  if (dot < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, dot)}
      <span className="cents">{text.slice(dot)}</span>
    </>
  );
}

const i = (n: number) => ({ "--i": n }) as CSSProperties;

export default function OverviewPage() {
  const t = useT();
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const insights = useApiData<InsightsResponse>(paths.insights);
  const actions = useApiData<ActionsResponse>(paths.actions);
  const txns = useApiData<TransactionsResponse>(
    paths.transactions({ limit: 4 }),
  );
  const session = useSession();
  const recipients = useApiData<RecipientsResponse>(paths.recipients);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const router = useRouter();
  const heroRef = useRef<HTMLElement>(null);
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
  const wallet = accts.slice(0, 3);
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
  // Specular highlight follows the pointer across the glass.
  function onHeroPointer(e: React.PointerEvent<HTMLElement>) {
    const el = heroRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty("--my", `${((e.clientY - r.top) / r.height) * 100}%`);
  }
  const paperAccounts = (accounts.data?.accounts ?? []).filter((a) => a.paper);
  const date = accounts.data ? new Date(accounts.data.asOf) : null;
  const evidence = sub
    ? sub.evidenceTransactionIds
        .map((id) => insights.data?.evidence[id])
        .filter((t) => t !== undefined)
        .sort(
          (a, b) =>
            new Date(a.postedAt).getTime() - new Date(b.postedAt).getTime(),
        )
    : [];
  const maxCharge = Math.max(
    1,
    ...evidence.map((t) => Math.abs(t.amountCents)),
  );
  return (
    <div className="overview screen">
      <div className="overview-heading screen-title rise" style={i(0)}>
        <p className="eyebrow">
          {date
            ? formatDate(date, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : t("Your money, in one place.")}
        </p>
        <h1 suppressHydrationWarning>
          {session.data ? (
            t("{greeting}, {name}.", {
              greeting: greeting(t),
              name: session.data.user.name.split(" ")[0],
            })
          ) : session.error ? (
            t("Your overview.")
          ) : (
            <>
              <span className="greeting-placeholder" aria-hidden />
              <span className="sr-only">{t("Loading your overview")}</span>
            </>
          )}
        </h1>
      </div>
      <ErrorBox error={error} />
      <ErrorBox
        error={accounts.error}
        title={t("Couldn't load accounts")}
        onRetry={() => void accounts.reload()}
      />
      <ErrorBox error={actions.error} title={t("Couldn't load transfers")} />
      <ErrorBox error={recipients.error} title={t("Couldn't load recipients")} />
      <div className="overview-grid screen-body">
        {/* Desktop columns: each scrolls on its own. Below 901px they are
            display: contents, so the phone/tablet layout is unchanged. */}
        <div className="ov-col ov-money screen-pane screen-stack">
          <div className="hero-shell rise" style={i(1)}>
            <section
              className="balance-hero"
              aria-label={t("Total balance")}
              ref={heroRef}
              onPointerMove={onHeroPointer}
            >
              <div className="balance-label">
                {t("Total balance")}
                <span title={t("USD equivalent of cash, debt and simulated investments. Paper accounts excluded.")}>
                  <Info
                    size={17}
                    aria-label={t("Balance includes currency conversion and simulated investments")}
                  />
                </span>
              </div>
              {accounts.data ? (
                <p className="balance-amount">
                  <SplitAmount cents={accounts.data.netWorthCents} />
                </p>
              ) : (
                <div className="balance-amount">
                  <Loading label={t("Loading balance…")} />
                </div>
              )}
              <p className="balance-note">
                {t("Across your demo accounts · USD equivalent · paper trading excluded")}
              </p>
              <div className="hero-actions">
                <Link href="/transfers" className="pill">
                  {t("New transfer")}
                  <span className="knob" aria-hidden>
                    <ArrowRight size={18} weight="bold" />
                  </span>
                </Link>
                <Link href="/chat" className="pill secondary">
                  <span className="knob" aria-hidden>
                    <Sparkle size={18} weight="fill" />
                  </span>
                  {t("Ask Onera")}
                </Link>
              </div>
            </section>
          </div>

          <section className="wallet-panel rise" style={i(2)}>
            <header className="panel-head">
              <h2>{t("Your accounts")}</h2>
              <Link href="/accounts" className="quiet-link">
                {t("View all")}
                <CaretRight size={14} weight="bold" aria-hidden />
              </Link>
            </header>
            <ErrorBox
              error={portfolio.error}
              title={t("Couldn't load holdings")}
              onRetry={() => void portfolio.reload()}
            />
            {accounts.loading && !accounts.data ? (
              <Loading />
            ) : wallet.length === 0 ? (
              accounts.data && (
                <EmptyState>
                  {t("No accounts yet.")}{" "}
                  <Link href="/accounts" className="quiet-link">
                    {t("Link a demo bank")}
                  </Link>
                </EmptyState>
              )
            ) : (
              <div
                className="wallet"
                style={{ "--n": wallet.length } as CSSProperties}
              >
                {wallet.map((a, n) => (
                  <Link
                    href={`/accounts?id=${encodeURIComponent(a.id)}`}
                    key={a.id}
                    className="wallet-card"
                    style={i(n)}
                  >
                    <div className={`wallet-face ${a.type}`}>
                      <div className="wallet-top">
                        <div>
                          <p className="wallet-name">{a.name}</p>
                          <p className="wallet-kind">{t(KIND_LABEL[a.type])}</p>
                        </div>
                        <span className="wallet-balance">
                          {a.type === "brokerage" && !portfolio.data
                            ? portfolio.error
                              ? t("Unavailable")
                              : "—"
                            : formatCents(
                                portfolio.data?.portfolio.accounts.find(
                                  (p) => p.accountId === a.id,
                                )?.totalCents ?? a.balanceCents,
                                a.currency,
                              )}
                        </span>
                      </div>
                      <div className="wallet-bottom">
                        <span className="wallet-mask">•• {a.mask}</span>
                        {a.capabilities.length === 1 ? (
                          <span className="wallet-note">
                            {t("View-only demo import")}
                          </span>
                        ) : (
                          <span className="wallet-chip" aria-hidden />
                        )}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
            {paperAccounts.length > 0 && (
              <div className="ios-list paper-list">
                {paperAccounts.map((a) => (
                  <Link
                    href={`/accounts?id=${encodeURIComponent(a.id)}`}
                    key={a.id}
                    className="ios-row paper-row"
                  >
                    <span className="squircle">
                      <TrendUp size={19} aria-hidden />
                    </span>
                    <span className="ios-row-body">
                      <span className="row-title block">{a.name}</span>
                      <span className="row-meta block">
                        <PaperLabel />
                      </span>
                    </span>
                    <CaretRight size={14} weight="bold" aria-hidden />
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="ov-col ov-today screen-pane screen-stack">
          {(pending || changed) && (
            <section
              className="attention glass rise"
              style={i(3)}
              aria-label={t("Needs your review")}
            >
              <span className="attention-icon">
                <WarningCircle size={24} weight="fill" aria-hidden />
              </span>
              <div className="attention-content">
                <strong>
                  {pending
                    ? t("{amount} transfer needs review", {
                        amount: formatCents(pending.amountCents),
                      })
                    : t("Bank details need your review")}
                </strong>
                <p>
                  {pending
                    ? pending.state === "HELD"
                      ? t("{name} · On hold", {
                          name: pending.destination.displayName,
                        })
                      : t("{name} · Awaiting your approval", {
                          name: pending.destination.displayName,
                        })
                    : t("{name} changed its bank details.", {
                        name: changed!.displayName,
                      })}
                </p>
              </div>
              {changed?.previousDetails && (
                <div className="route">
                  <span className="was">
                    {changed.previousDetails.institution} ••
                    {changed.previousDetails.accountMask}
                  </span>
                  <ArrowRight size={14} aria-label={t("changed to")} />
                  <span className="now">
                    {changed.details.institution} ••
                    {changed.details.accountMask}
                  </span>
                  <small>{t("Previously verified → requested")}</small>
                </div>
              )}
              <button
                className="pill small"
                onClick={reviewChanged}
                disabled={busy}
              >
                {busy
                  ? t("Opening…")
                  : pending
                    ? t("Review transfer")
                    : t("Try rent review")}
                <span className="knob" aria-hidden>
                  <ArrowRight size={16} weight="bold" />
                </span>
              </button>
            </section>
          )}

          <div className="overview-bottom">
            <section className="tile glass rise" style={i(4)}>
              <header className="tile-head">
                <span className="squircle light">
                  <Lightbulb size={17} weight="fill" aria-hidden />
                </span>
                <h2>{sub ? t("One thing changed") : t("All caught up")}</h2>
                {sub && (
                  <span className="quiet-link muted">
                    {t("Latest {date}", {
                      date: formatDate(sub.latestChargeAt, {
                        month: "short",
                        day: "numeric",
                      }),
                    })}
                  </span>
                )}
              </header>
              <ErrorBox
                error={insights.error}
                onRetry={() => void insights.reload()}
              />
              {insights.loading && !insights.data ? (
                <Loading />
              ) : sub ? (
                <>
                  <div className="insight">
                    <div>
                      <p className="insight-figure">
                        +{formatCents(sub.increaseCents)}
                        <ArrowUpRight size={26} weight="bold" aria-hidden />
                      </p>
                      <p className="insight-copy">
                        {t("{merchant} went up this month", {
                          merchant: sub.merchant,
                        })}{" "}
                        <span>
                          —{" "}
                          {t("from {from} to {to}.", {
                            from: formatCents(sub.previousAmountCents),
                            to: formatCents(sub.currentAmountCents),
                          })}
                        </span>
                      </p>
                    </div>
                    {evidence.length > 1 && (
                      <div className="bars" aria-hidden>
                        {evidence.map((t, n) => (
                          <div
                            key={t.id}
                            className={`bar ${n === evidence.length - 1 ? "latest" : ""}`}
                            style={
                              {
                                "--i": n,
                                "--h": `${Math.max(12, (Math.abs(t.amountCents) / maxCharge) * 110)}px`,
                              } as CSSProperties
                            }
                          >
                            <i />
                            {formatDate(t.postedAt, {
                              month: "short",
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <details className="evidence">
                    <summary>
                      <Receipt size={18} aria-hidden />
                      {t("View details")}
                      <CaretRight size={14} weight="bold" aria-hidden />
                    </summary>
                    <p className="row-meta">
                      {t("Based on your synthetic transaction history.")}
                    </p>
                    <ul>
                      {evidence.map((t) => (
                        <li key={t.id}>
                          <span>
                            {formatDate(t.postedAt)} ·{" "}
                            {t.description}
                          </span>
                          <span>{formatCents(t.amountCents, t.currency)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="row-meta">
                  {t("No subscription increases found in your current activity.")}
                </p>
              )}
            </section>

            <section className="tile glass rise" style={i(5)}>
              <header className="tile-head">
                <span className="squircle">
                  <ClockCounterClockwise size={17} aria-hidden />
                </span>
                <h2>{t("Recent activity")}</h2>
                <Link href="/accounts?view=activity" className="quiet-link">
                  {t("View all")}
                  <CaretRight size={14} weight="bold" aria-hidden />
                </Link>
              </header>
              <ErrorBox error={txns.error} onRetry={() => void txns.reload()} />
              {txns.loading && !txns.data ? (
                <Loading />
              ) : (
                <div className="ios-list">
                  {txns.data?.transactions.map((t) => {
                    const Icon = categoryIcon(t.category, t.merchant);
                    return (
                      <Link
                        className="ios-row"
                        href={`/accounts?id=${encodeURIComponent(t.accountId)}&view=activity`}
                        key={t.id}
                      >
                        <span className="squircle">
                          <Icon size={19} aria-hidden />
                        </span>
                        <span className="ios-row-body">
                          <span className="row-title block">
                            {t.merchant ?? t.description}
                          </span>
                          <time
                            className="row-meta block"
                            dateTime={t.postedAt}
                          >
                            {formatDate(t.postedAt, {
                              weekday: "short",
                              month: "short",
                              day: "numeric",
                            })}
                          </time>
                        </span>
                        <span className="row-value">
                          {formatCents(t.amountCents, t.currency)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              )}
              {txns.data?.transactions.length === 0 && (
                <p className="row-meta">
                  {t("No activity yet.")}{" "}
                  <Link href="/accounts">{t("Explore accounts")}</Link>
                </p>
              )}
            </section>
          </div>
        </div>

        <div className="ov-col ov-agents screen-pane screen-stack">
          <AssistantPanel />
          <MonitoringPanel
            accounts={accounts.data?.accounts}
            actions={actions.data?.actions}
          />
        </div>
      </div>
    </div>
  );
}
