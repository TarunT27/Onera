"use client";

/**
 * Personal assistant briefing. The assistant runs in the background (every 30
 * minutes, or on "Refresh") and prepares this snapshot from deterministic
 * rules: ways to save, spending that looks off, holdings research and things
 * that need the user. It is observation only — every action here is a link to
 * the page where the user acts themselves.
 */
import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, ChartLineUp, Lightbulb, MagnifyingGlass, Receipt, Sparkle, WarningCircle } from "@phosphor-icons/react";
import {
  clearfi,
  paths,
  type BriefingAttentionItem,
  type BriefingResearchNote,
  type BriefingResponse,
  type BriefingTip,
} from "../components/api";
import { AssistantTabs } from "../components/AssistantTabs";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents, formatDateTime, formatPct } from "../components/format";
import { SEVERITY } from "../components/InsightCard";
import { useApiData } from "../components/useApiData";

const POLL_MS = 30_000;

const KIND: Record<BriefingTip["kind"], { title: string; subtitle: string; Icon: typeof Lightbulb }> = {
  spending: { title: "Spending check", subtitle: "Where spending looks too high or doesn't add up", Icon: WarningCircle },
  save: { title: "Ways to save", subtitle: "Estimates from your own transactions", Icon: Lightbulb },
  invest: { title: "Investments", subtitle: "How your holdings are spread (simulated prices)", Icon: ChartLineUp },
};

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function BriefingClient() {
  const data = useApiData<BriefingResponse>(paths.briefing);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const autoStarted = useRef(false);

  async function refresh() {
    setRefreshing(true);
    setError(null);
    try {
      data.setData(await clearfi.refreshBriefing());
    } catch (e) {
      setError(e);
    } finally {
      setRefreshing(false);
    }
  }

  // First visit before the background run: prepare one now rather than show an empty page.
  useEffect(() => {
    if (data.data && data.data.briefing === null && !autoStarted.current) {
      autoStarted.current = true;
      void refresh();
    }
  });

  // The assistant refreshes in the background; pick up new briefings while the tab is visible.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void data.reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [data.reload]);

  const b = data.data?.briefing ?? null;
  const tipsBy = (kind: BriefingTip["kind"]) => (b?.tips ?? []).filter((t) => t.kind === kind);

  return (
    <div className="space-y-6">
      <AssistantTabs className="" />
      <PageHeader
        title="Personal assistant"
        description="Works in the background: watches your spending, subscriptions and investments, looks for ways to save, researches your holdings and lists what needs you. It can't move money, propose, approve or change anything."
        action={
          <Button onClick={() => void refresh()} busy={refreshing}>
            Refresh briefing
          </Button>
        }
      />

      <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <Sparkle size={16} weight="fill" aria-hidden />
        {b ? `Prepared ${formatDateTime(b.generatedAt)}` : "Not prepared yet"} · refreshes every 30 minutes in the background ·
        deterministic rules, not financial advice
      </p>

      <ErrorBox error={error} title="Couldn't refresh the briefing" onDismiss={() => setError(null)} />
      <ErrorBox error={data.error} title="Couldn't load the briefing" onRetry={() => void data.reload()} />

      {!b ? (
        data.loading || refreshing || !data.data ? (
          <Loading label="Preparing your briefing…" />
        ) : (
          <EmptyState>Your assistant hasn&apos;t prepared a briefing yet. Use Refresh briefing to run it now.</EmptyState>
        )
      ) : (
        <>
          <section className="glass flex flex-wrap items-end justify-between gap-6 !rounded-[28px] px-6 py-6 sm:px-8 sm:py-7" aria-label="Briefing headline">
            <div className="min-w-0 max-w-2xl">
              <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">Today&apos;s briefing</p>
              <h2 className="mt-2 text-[22px] font-semibold leading-snug tracking-[-0.02em] text-zinc-50 sm:text-[26px]">
                {b.headline}
              </h2>
            </div>
            <div className="sm:text-right">
              <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">Potential savings</p>
              <p className="mt-1 text-[38px] font-light leading-none tracking-[-0.04em] tabular-nums text-emerald-200">
                {formatCents(b.potentialAnnualSavingsCents, { whole: true })}
                <span className="text-base text-white/45"> /yr</span>
              </p>
            </div>
          </section>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
            <Stat label="Monthly income" value={formatCents(b.snapshot.monthlyIncomeCents, { whole: true })} detail={`Average of ${b.snapshot.windowDays} days`} />
            <Stat label="Monthly spending" value={formatCents(b.snapshot.monthlySpendingCents, { whole: true })} detail="Own-account moves excluded" />
            <Stat
              label="Savings rate"
              value={b.snapshot.savingsRatePct === null ? "—" : `${b.snapshot.savingsRatePct}%`}
              tone={b.snapshot.savingsRatePct !== null && b.snapshot.savingsRatePct < 0 ? "text-red-300" : "text-zinc-50"}
            />
            <Stat
              label="Emergency fund"
              value={b.snapshot.emergencyFundMonths === null ? "—" : `${b.snapshot.emergencyFundMonths} mo`}
              detail={`${formatCents(b.snapshot.savingsCents, { whole: true })} in savings`}
            />
            <Stat label="Invested" value={formatCents(b.snapshot.investedCents, { whole: true })} detail="Simulated prices · paper excluded" />
          </div>

          {b.attention.length > 0 && (
            <Card title="Needs your attention" subtitle="Your assistant can't act on these. Each link opens the page where you can.">
              <ul className="grid gap-2">
                {b.attention.map((a) => (
                  <AttentionRow key={a.id} item={a} />
                ))}
              </ul>
            </Card>
          )}

          <div className="grid gap-6 lg:grid-cols-12">
            <div className="min-w-0 space-y-6 lg:col-span-7">
              {(["spending", "save", "invest"] as const).map((kind) =>
                tipsBy(kind).length === 0 ? null : (
                  <Card key={kind} title={KIND[kind].title} subtitle={KIND[kind].subtitle}>
                    <ul className="grid gap-3">
                      {tipsBy(kind).map((t) => (
                        <TipCard key={t.id} tip={t} />
                      ))}
                    </ul>
                  </Card>
                ),
              )}
              {b.tips.length === 0 && (
                <Card title="Tips">
                  <EmptyState>Nothing stands out right now. Your assistant keeps checking in the background.</EmptyState>
                </Card>
              )}
            </div>

            <div className="min-w-0 space-y-6 lg:col-span-5">
              <Card title="Where your money went" subtitle="Last 30 days, by category">
                {b.snapshot.topCategories.length === 0 ? (
                  <EmptyState>No spending in the last 30 days.</EmptyState>
                ) : (
                  <ul className="space-y-3" aria-label="Spending by category">
                    {b.snapshot.topCategories.map((c) => (
                      <li key={c.category}>
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="text-zinc-100">{titleCase(c.category)}</span>
                          <span className="tabular-nums text-white/60">
                            {formatCents(c.cents)} · {c.pct}%
                          </span>
                        </div>
                        <div className="mt-1.5 h-1.5 rounded-full bg-white/[0.06]" aria-hidden>
                          <div className="h-1.5 rounded-full bg-brand-400" style={{ width: `${Math.max(2, Math.min(100, c.pct))}%` }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card title="Market movers today" subtitle="Simulated prices — not real market data">
                <ul className="divide-y divide-white/[0.06]">
                  {b.movers.map((m) => (
                    <li key={m.symbol} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate">
                        <span className="font-semibold text-zinc-50">{m.symbol}</span>{" "}
                        <span className="text-white/50">{m.name}</span>
                      </span>
                      <span className={`shrink-0 tabular-nums ${m.changePct >= 0 ? "text-emerald-300" : "text-red-300"}`}>
                        {formatPct(m.changePct)}
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            </div>
          </div>

          <Card
            title="Research desk"
            subtitle="Each of your holdings over the last 90 days of simulated prices. Describes the past; not a forecast or advice."
          >
            {b.research.length === 0 ? (
              <EmptyState>You don&apos;t hold any investments yet.</EmptyState>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {b.research.map((r) => (
                  <ResearchCard key={r.symbol} note={r} />
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-white/40">
            {b.disclaimer} See what each background agent may read on the{" "}
            <Link href="/security" className="underline underline-offset-2">
              Security
            </Link>{" "}
            page.
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone = "text-zinc-50", detail }: { label: string; value: string; tone?: string; detail?: ReactNode }) {
  return (
    <section className="glass min-w-0 !rounded-[24px] px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-white/45">{detail}</p>}
    </section>
  );
}

function AttentionRow({ item }: { item: BriefingAttentionItem }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-white/[0.04] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
      <div className="min-w-0">
        <p className="text-sm font-medium text-zinc-50">{item.title}</p>
        <p className="mt-0.5 text-xs text-white/50">{item.detail}</p>
      </div>
      <Link href={item.href} className="inline-flex items-center gap-1 text-xs font-medium text-brand-300 hover:underline">
        Open <ArrowRight size={12} weight="bold" aria-hidden />
      </Link>
    </li>
  );
}

function TipCard({ tip: t }: { tip: BriefingTip }) {
  const sev = SEVERITY[t.severity] ?? SEVERITY.info;
  const txns = t.evidence.transactionIds ?? [];
  const symbols = t.evidence.symbols ?? [];
  const ask = `/chat?q=${encodeURIComponent(`My personal assistant says: "${t.title}". Can you explain this using my data?`)}`;
  return (
    <li className={`monitoring-item sev-${t.severity}`}>
      <article aria-labelledby={`tip-${t.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone}>
            <sev.Icon size={13} weight="fill" aria-hidden />
            {sev.label}
          </Badge>
          {t.annualSavingsCents !== null && t.annualSavingsCents > 0 && (
            <Badge tone="green">Save ~{formatCents(t.annualSavingsCents, { whole: true })}/yr</Badge>
          )}
          {t.oneTimeCents !== null && <Badge tone="amber">{formatCents(t.oneTimeCents)} at stake</Badge>}
          {t.insightId && <Badge tone="gray" title="Also raised as a monitoring finding">In your alerts</Badge>}
        </div>
        <h3 id={`tip-${t.id}`} className="monitoring-title">{t.title}</h3>
        <p className="monitoring-body">{t.body}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {txns.length > 0 && (
            <details className="monitoring-evidence !mt-0">
              <summary>
                <Receipt size={14} aria-hidden className="mr-1" />
                Evidence ({txns.length} transaction{txns.length === 1 ? "" : "s"})
              </summary>
              <ul>
                {txns.map((id) => (
                  <li key={id}>
                    <code className="font-mono text-[11px]">{id}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          {symbols.length > 0 && <span className="text-white/50">Holdings: {symbols.join(", ")}</span>}
          <Link href={ask} className="inline-flex items-center gap-1 font-medium text-brand-300 hover:underline">
            <MagnifyingGlass size={12} aria-hidden /> Ask Onera about this
          </Link>
        </div>
      </article>
    </li>
  );
}

function ResearchCard({ note: r }: { note: BriefingResearchNote }) {
  const metric = (label: string, value: number | null, suffix = "%") => (
    <div>
      <dt className="text-[11px] text-white/40">{label}</dt>
      <dd className={`tabular-nums ${value === null ? "text-white/40" : value < 0 ? "text-red-300" : "text-zinc-100"}`}>
        {value === null ? "—" : suffix === "%" ? formatPct(value) : `${value}${suffix}`}
      </dd>
    </div>
  );
  return (
    <li className="rounded-2xl bg-white/[0.04] p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-base font-semibold text-zinc-50">{r.symbol}</span>
        <span className="min-w-0 truncate text-sm text-white/55">{r.name}</span>
        {r.notable && <Badge tone="amber">Notable move</Badge>}
        {r.paper && <Badge tone="violet">Paper</Badge>}
        {r.sector && <Badge tone="gray">{r.sector}</Badge>}
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm sm:grid-cols-5">
        {metric("30 days", r.change30dPct)}
        {metric("90 days", r.change90dPct)}
        <div>
          <dt className="text-[11px] text-white/40">Swings</dt>
          <dd className="tabular-nums text-zinc-100">{r.volatilityPct === null ? "—" : `${r.volatilityPct}%`}</dd>
        </div>
        {metric("Deepest dip", r.maxDrawdownPct)}
        <div>
          <dt className="text-[11px] text-white/40">Your P&amp;L</dt>
          <dd className={`tabular-nums ${r.unrealizedPnlCents < 0 ? "text-red-300" : "text-emerald-300"}`}>
            {formatCents(r.unrealizedPnlCents, { signed: true })}
          </dd>
        </div>
      </dl>
      <p className="mt-3 text-[13px] leading-relaxed text-white/60">{r.note}</p>
      {r.weightPct !== null && <p className="mt-1 text-xs text-white/40">{r.weightPct}% of your invested holdings</p>}
    </li>
  );
}
