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
  type SessionResponse,
  type RecipientsResponse,
} from "./components/api";
import { ErrorBox } from "./components/ErrorBox";
import { Loading } from "./components/Card";
import { formatCents } from "@/lib/finance/money";
import { useRouter } from "next/navigation";

const KIND_LABEL = {
  checking: "Checking",
  savings: "Savings",
  brokerage: "Brokerage",
  credit: "Credit card",
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

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
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
  const portfolio = useApiData<{ portfolio: Portfolio }>("/api/portfolio");
  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const insights = useApiData<InsightsResponse>(paths.insights);
  const actions = useApiData<ActionsResponse>(paths.actions);
  const txns = useApiData<TransactionsResponse>(
    paths.transactions({ limit: 4 }),
  );
  const session = useApiData<SessionResponse>(paths.session);
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
    <div className="overview">
      <div className="overview-heading rise" style={i(0)}>
        <p className="eyebrow">
          {date
            ? date.toLocaleDateString("en-US", {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : "Your money, in one place."}
        </p>
        <h1 suppressHydrationWarning>
          {greeting()}, {session.data?.user.name.split(" ")[0] ?? "there"}.
        </h1>
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
        <div className="hero-shell rise" style={i(1)}>
          <section
            className="balance-hero"
            aria-label="Total balance"
            ref={heroRef}
            onPointerMove={onHeroPointer}
          >
            <div className="balance-label">
              Total balance
              <span title="USD equivalent of cash, debt and simulated investments. Paper accounts excluded.">
                <Info
                  size={17}
                  aria-label="Balance includes currency conversion and simulated investments"
                />
              </span>
            </div>
            {accounts.data ? (
              <p className="balance-amount">
                <SplitAmount cents={accounts.data.netWorthCents} />
              </p>
            ) : (
              <div className="balance-amount">
                <Loading label="Loading balance…" />
              </div>
            )}
            <p className="balance-note">
              Across your demo accounts · USD equivalent
            </p>
            <div className="hero-actions">
              <Link href="/transfers" className="pill">
                New transfer
                <span className="knob" aria-hidden>
                  <ArrowRight size={18} weight="bold" />
                </span>
              </Link>
              <Link href="/chat" className="pill secondary">
                <span className="knob" aria-hidden>
                  <Sparkle size={18} weight="fill" />
                </span>
                Ask ClearFi
              </Link>
            </div>
          </section>
        </div>

        <section className="wallet-panel rise" style={i(2)}>
          <header className="panel-head">
            <h2>Your accounts</h2>
            <Link href="/accounts" className="quiet-link">
              View all
              <CaretRight size={14} weight="bold" aria-hidden />
            </Link>
          </header>
          <ErrorBox
            error={portfolio.error}
            title="Couldn't load holdings"
            onRetry={() => void portfolio.reload()}
          />
          {accounts.loading && !accounts.data ? (
            <Loading />
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
                        <p className="wallet-kind">{KIND_LABEL[a.type]}</p>
                      </div>
                      <span className="wallet-balance">
                        {a.type === "brokerage" && !portfolio.data
                          ? portfolio.error
                            ? "Unavailable"
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
                          View-only demo import
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
        </section>

        {(pending || changed) && (
          <section
            className="attention glass rise"
            style={i(3)}
            aria-label="Needs your review"
          >
            <span className="attention-icon">
              <WarningCircle size={24} weight="fill" aria-hidden />
            </span>
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
              <div className="route">
                <span className="was">
                  {changed.previousDetails.institution} ••
                  {changed.previousDetails.accountMask}
                </span>
                <ArrowRight size={14} aria-label="changed to" />
                <span className="now">
                  {changed.details.institution} ••{changed.details.accountMask}
                </span>
                <small>Previously verified → requested</small>
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
              <h2>{sub ? "One thing changed" : "All caught up"}</h2>
              {sub && (
                <span className="quiet-link muted">
                  Latest{" "}
                  {new Date(sub.latestChargeAt).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
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
                      {sub.merchant} went up this month{" "}
                      <span>
                        — from {formatCents(sub.previousAmountCents)} to{" "}
                        {formatCents(sub.currentAmountCents)}.
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
                          {new Date(t.postedAt).toLocaleDateString("en-US", {
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
                    View details
                    <CaretRight size={14} weight="bold" aria-hidden />
                  </summary>
                  <p className="row-meta">
                    Based on your synthetic transaction history.
                  </p>
                  <ul>
                    {evidence.map((t) => (
                      <li key={t.id}>
                        <span>
                          {new Date(t.postedAt).toLocaleDateString()} ·{" "}
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
                No subscription increases found in your current activity.
              </p>
            )}
          </section>

          <section className="tile glass rise" style={i(5)}>
            <header className="tile-head">
              <span className="squircle">
                <ClockCounterClockwise size={17} aria-hidden />
              </span>
              <h2>Recent activity</h2>
              <Link href="/accounts?view=activity" className="quiet-link">
                View all
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
                        <time className="row-meta block" dateTime={t.postedAt}>
                          {new Date(t.postedAt).toLocaleDateString("en-US", {
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
                No activity yet. <Link href="/accounts">Explore accounts</Link>
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
