"use client";

/**
 * Live agents: a map of what each background agent reads and writes, animated
 * while it works, plus per-agent status and a live activity feed. Read-only
 * apart from "Run all agents now" (the same advisory run as the Overview
 * button). Agents can never approve, execute or change controls.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bank,
  ChartLineUp,
  ChartPieSlice,
  Detective,
  Lightbulb,
  ListChecks,
  Lock,
  Plugs,
  Receipt,
  Repeat,
  Sparkle,
  ArrowsLeftRight,
  ShieldCheck,
  UserList,
  Briefcase,
  ClockCounterClockwise,
  type Icon,
} from "@phosphor-icons/react";
import type { AgentLive, AgentRun } from "@/lib/agents";
import { msg } from "@/lib/i18n/msg";
import type { Translate } from "@/lib/i18n/translate";
import { clearfi, paths, type AgentsLiveResponse } from "../components/api";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { useI18n, useT } from "../components/I18nContext";
import { useApiData } from "../components/useApiData";

const POLL_MS = 2_500;
/** An agent that finished this recently still shows as active on the map. */
const ACTIVE_MS = 12_000;

const AGENT_UI: Record<AgentLive["id"], { icon: Icon; does: string; verb: string; when: string }> = {
  threat_monitor: {
    icon: Detective,
    does: msg("Sweeps your audit log for attack patterns over time: probes for other people's records, executions without approval, injection attempts, recipient swaps."),
    verb: msg("Sweeping the audit log…"),
    when: msg("Seconds after any new activity"),
  },
  security_sentinel: {
    icon: ShieldCheck,
    does: msg("Reviews every new or edited transfer: changed or unverified recipient, first-time payee, unusual amount, drafted by the assistant."),
    verb: msg("Reviewing a transfer…"),
    when: msg("Every new or edited transfer"),
  },
  spending_monitor: {
    icon: ChartPieSlice,
    does: msg("Compares the last 30 days of spending per category with your usual pattern and flags spikes and unusually large purchases."),
    verb: msg("Reviewing spending…"),
    when: msg("Daily, and after new bank data"),
  },
  subscription_monitor: {
    icon: Repeat,
    does: msg("Watches recurring charges and flags price increases, citing the charges that prove them."),
    verb: msg("Checking subscriptions…"),
    when: msg("Daily, and after new bank data"),
  },
  portfolio_monitor: {
    icon: ChartLineUp,
    does: msg("Flags concentrated positions and large daily moves in your simulated portfolio."),
    verb: msg("Checking the portfolio…"),
    when: msg("Daily"),
  },
  connection_monitor: {
    icon: Plugs,
    does: msg("Refreshes healthy simulated bank connections every 15 minutes and queues reviews when new data arrives."),
    verb: msg("Syncing bank data…"),
    when: msg("Every 15 minutes"),
  },
  personal_assistant: {
    icon: Sparkle,
    does: msg("Prepares your briefing: where you could save, spending that looks too high or doesn't add up, notes on your holdings, and transfers or connections that need you. Observation only, not financial advice."),
    verb: msg("Preparing your briefing…"),
    when: msg("Every 30 minutes, and on demand"),
  },
};

const SOURCES: Record<string, { label: string; icon: Icon }> = {
  audit: { label: msg("Audit log"), icon: ClockCounterClockwise },
  actions: { label: msg("Transfers"), icon: ArrowsLeftRight },
  recipients: { label: msg("Recipients"), icon: UserList },
  transactions: { label: msg("Transactions"), icon: Receipt },
  accounts: { label: msg("Accounts"), icon: Bank },
  portfolio: { label: msg("Portfolio"), icon: Briefcase },
  connections: { label: msg("Bank connections"), icon: Plugs },
};
const OUTPUTS: Record<string, { label: string; icon: Icon }> = {
  insights: { label: msg("Findings & alerts"), icon: Lightbulb },
  jobs: { label: msg("Follow-up reviews"), icon: ListChecks },
  connection_sync: { label: msg("Bank data refresh"), icon: Bank },
};

/** Ticks every second so "3 s ago" stays live between polls. */
function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}

function ago(iso: string | null | undefined, now: number, t: Translate): string {
  if (!iso) return t("never");
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return t("just now");
  if (s < 60) return t("{n} s ago", { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t("{n} min ago", { n: m });
  const h = Math.round(m / 60);
  return h < 24 ? t("{n} h ago", { n: h }) : t("{n} d ago", { n: Math.round(h / 24) });
}

function isActive(a: AgentLive, now: number): boolean {
  if (a.state === "running" || a.state === "queued") return true;
  const t = a.lastRun?.finishedAt ?? a.lastRun?.startedAt;
  return !!t && now - Date.parse(t) < ACTIVE_MS;
}

export function AgentsClient() {
  const t = useT();
  const live = useApiData<AgentsLiveResponse>(paths.agentsLive);
  const clientNow = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Desktop side column: 0 = agent cards, 1 = live activity. */
  const [sideTab, setSideTab] = useState(0);

  // Server clock offset, so "ago" and activity windows use the server's timeline.
  const offset = useRef(0);
  useEffect(() => {
    if (live.data) offset.current = Date.parse(live.data.now) - Date.now();
  }, [live.data]);
  const now = clientNow + offset.current;

  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void live.reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [live.reload]);

  async function runAll() {
    setRunning(true);
    setError(null);
    try {
      await clearfi.runAgents();
      await live.reload();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  }

  const data = live.data;
  return (
    <div className="agents-screen screen space-y-6">
      <div className="agents-head">
        <PageHeader
          title={t("Agents")}
          description={t("Seven background agents watch your synthetic accounts. Each one reads only what it needs and can only write findings. Watch them work live.")}
          action={
            <Button onClick={() => void runAll()} busy={running}>
              {t("Run all agents now")}
            </Button>
          }
        />
      </div>
      <p className="agents-note flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <Lock size={15} weight="fill" aria-hidden />
        {t("Rule-based, no AI model. No agent can approve, execute, verify recipients or change your controls.")}
      </p>

      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <ErrorBox error={live.error} title={t("Couldn't load agent status")} onRetry={() => void live.reload()} />

      {!data ? (
        live.loading ? <Loading label={t("Loading agents…")} /> : null
      ) : (
        <>
          <WorkerStrip data={data} now={now} />
          <div className="agents-body screen-body space-y-6">
            <Card
              title={t("Live map")}
              subtitle={t("Lines light up and data flows while an agent works. Select an agent to trace what it touches.")}
              className="agents-map"
              bodyClassName="agents-map-body"
            >
              <FlowMap agents={data.agents} now={now} selected={selected} onSelect={setSelected} />
            </Card>
            <div className="agents-side grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]" data-tab={sideTab === 0 ? "agents" : "activity"}>
              {/* Desktop only (hidden below 901px): the side column shows the agent cards or the live feed. */}
              <div className="agents-seg-wrap hidden">
                <div
                  className="seg agents-seg"
                  role="radiogroup"
                  aria-label={t("Show agents or live activity")}
                  style={{ ["--n" as string]: 2, ["--idx" as string]: sideTab }}
                >
                  <span className="seg-lens" aria-hidden />
                  {[t("Agents ({count})", { count: data.agents.length }), t("Live activity")].map((label, i) => (
                    <button key={i} type="button" role="radio" aria-checked={sideTab === i} onClick={() => setSideTab(i)}>
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="agents-list screen-pane grid gap-4 md:grid-cols-2">
                {data.agents.map((a) => (
                  <AgentCard
                    key={a.id}
                    agent={a}
                    now={now}
                    selected={selected === a.id}
                    onSelect={() => setSelected(selected === a.id ? null : a.id)}
                  />
                ))}
              </div>
              <ActivityFeed feed={data.feed} agents={data.agents} now={now} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function WorkerStrip({ data, now }: { data: AgentsLiveResponse; now: number }) {
  const t = useT();
  const w = data.worker;
  const b = data.backlog;
  const beatAge = w.latest ? now - Date.parse(w.latest.lastBeatAt) : null;
  const status =
    w.status === "live"
      ? { cls: "is-live", title: t("Background monitoring active"), text: t("Checked {ago}", { ago: ago(w.latest?.lastBeatAt, now, t) }) }
      : w.status === "stale"
        ? { cls: "is-stale", title: t("Monitoring degraded"), text: t("Last completed check {ago}", { ago: ago(w.latest?.lastBeatAt, now, t) }) }
        : { cls: "is-off", title: t("Background worker not running"), text: t("Agents run only when you click Run all agents now") };
  const pending = b.due + b.waiting + b.running;
  return (
    <div className="worker-strip grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
      <section className={`glass worker-status ${status.cls} !rounded-[24px]`} aria-live="polite">
        <span className="worker-dot" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-zinc-50">{status.title}</p>
          <p className="truncate text-xs text-white/50">
            {status.text}
            {w.latest && w.status === "live" && beatAge !== null && (
              <> · {w.latest.mode === "in-process" ? t("inside the app server") : t("standalone worker")} · {t("every {seconds} s", { seconds: Math.round(w.latest.intervalMs / 1000) })}</>
            )}
          </p>
        </div>
      </section>
      <Metric label={t("Pending jobs")} value={pending} hint={pending === 0 ? t("All caught up") : t("{due} due · {waiting} retrying · {running} running", { due: b.due, waiting: b.waiting, running: b.running })} />
      <Metric label={t("Worker ticks")} value={w.latest?.ticks ?? 0} hint={w.latest ? t("{count} failed ticks", { count: w.latest.tickErrors }) : t("No heartbeat yet")} />
      <Metric
        label={t("Dead-lettered")}
        value={b.dead}
        hint={b.dead ? t("Jobs that gave up; kept for review") : t("None")}
        tone={b.dead ? "text-red-300" : undefined}
      />
    </div>
  );
}

function Metric({ label, value, hint, tone = "text-zinc-50" }: { label: string; value: number | string; hint: string; tone?: string }) {
  return (
    <section className="agents-metric glass min-w-0 !rounded-[24px] px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
      <p className="mt-0.5 truncate text-xs text-white/45">{hint}</p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Live map (SVG)
// ---------------------------------------------------------------------------

const W = 1000;
const ROW = 74;
const COL = { src: 30, srcW: 200, agent: 380, agentW: 240, out: 770, outW: 200 };

function curve(x1: number, y1: number, x2: number, y2: number): string {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
}

function FlowMap({ agents, now, selected, onSelect }: {
  agents: AgentLive[];
  now: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  const { t, tp } = useI18n();
  const reduced = usePrefersReducedMotion();
  const sources = useMemo(
    () => Object.keys(SOURCES).filter((s) => agents.some((a) => (a.reads as string[]).includes(s))),
    [agents],
  );
  const outputs = useMemo(
    () => Object.keys(OUTPUTS).filter((o) => agents.some((a) => (a.writes as string[]).includes(o))),
    [agents],
  );
  const rows = Math.max(sources.length, agents.length);
  const H = rows * ROW + 40;
  const yOf = (i: number, n: number) => 20 + ((rows - n) * ROW) / 2 + i * ROW + ROW / 2;
  const srcY = (s: string) => yOf(sources.indexOf(s), sources.length);
  const agentY = (i: number) => yOf(i, agents.length);
  // Outputs sit in the upper part; the "never" lane sits below them.
  const outY = (o: string) => 20 + ROW / 2 + outputs.indexOf(o) * ROW + ROW * 0.5;
  const lockY = 20 + ROW / 2 + outputs.length * ROW + ROW * 0.9;

  const edges = agents.flatMap((a, i) => {
    const active = isActive(a, now);
    const sel = selected === a.id;
    const y = agentY(i);
    return [
      ...a.reads.filter((s) => sources.includes(s)).map((s) => ({
        key: `${s}-${a.id}`, d: curve(COL.src + COL.srcW, srcY(s), COL.agent, y), active, sel, dir: "in" as const,
      })),
      ...a.writes.filter((o) => outputs.includes(o)).map((o) => ({
        key: `${a.id}-${o}`, d: curve(COL.agent + COL.agentW, y, COL.out, outY(o)), active, sel, dir: "out" as const,
      })),
    ];
  });
  const dimOthers = selected !== null;

  return (
    <div className="flow-map-wrap -mx-1 overflow-x-auto px-1 pb-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="flow-map min-w-[760px]"
        role="img"
        aria-label={t("Map of which data each agent reads and what it writes")}
      >
        <text x={COL.src} y={14} className="flow-col">{t("Reads (your data only)")}</text>
        <text x={COL.agent} y={14} className="flow-col">{t("Agents")}</text>
        <text x={COL.out} y={14} className="flow-col">{t("Can write")}</text>

        {edges.map((e) => (
          <path
            key={e.key}
            d={e.d}
            className={`flow-edge ${e.active ? "is-active" : ""} ${e.sel ? "is-selected" : dimOthers ? "is-dim" : ""}`}
          />
        ))}
        {!reduced &&
          edges
            .filter((e) => e.active && (!dimOthers || e.sel))
            .map((e, i) => (
              <circle key={`p-${e.key}`} r={3.5} className="flow-packet">
                <animateMotion dur="1.6s" begin={`${(i % 5) * 0.25}s`} repeatCount="indefinite" path={e.d} />
              </circle>
            ))}

        {sources.map((s) => {
          const S = SOURCES[s];
          const y = srcY(s);
          const lit = selected ? agents.find((a) => a.id === selected)?.reads.includes(s as never) : false;
          return (
            <g key={s} className={`flow-node ${lit ? "is-lit" : ""}`}>
              <rect x={COL.src} y={y - 20} width={COL.srcW} height={40} rx={20} />
              <S.icon x={COL.src + 14} y={y - 9} size={18} />
              <text x={COL.src + 42} y={y + 5}>{t(S.label)}</text>
            </g>
          );
        })}

        {agents.map((a, i) => {
          const ui = AGENT_UI[a.id];
          const y = agentY(i);
          const active = isActive(a, now);
          return (
            <g
              key={a.id}
              className={`flow-agent state-${a.state} ${active ? "is-active" : ""} ${selected === a.id ? "is-selected" : dimOthers ? "is-dim" : ""}`}
              onClick={() => onSelect(selected === a.id ? null : a.id)}
              role="button"
              tabIndex={0}
              aria-label={t("{name}: {state}", { name: t(a.name), state: t(STATE_LABEL[a.state]) })}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  onSelect(selected === a.id ? null : a.id);
                }
              }}
            >
              {active && !reduced && <circle cx={COL.agent + 30} cy={y} r={18} className="flow-ring" />}
              <rect x={COL.agent} y={y - 27} width={COL.agentW} height={54} rx={18} />
              <circle cx={COL.agent + 30} cy={y} r={17} className="flow-agent-icon-bg" />
              <ui.icon x={COL.agent + 20} y={y - 10} size={20} weight="fill" />
              <text x={COL.agent + 58} y={y - 3} className="flow-agent-name">{t(a.name)}</text>
              <text x={COL.agent + 58} y={y + 14} className="flow-agent-state">
                {a.state === "running" ? t(ui.verb) : a.state === "queued" ? tp(a.queued, "{n} job queued", "{n} jobs queued") : a.state === "failing" ? t("Last run failed") : a.lastRun ? t("Idle · ran {ago}", { ago: ago(a.lastRun.finishedAt ?? a.lastRun.startedAt, now, t) }) : t("Idle · {when}", { when: t(ui.when).toLowerCase() })}
              </text>
            </g>
          );
        })}

        {outputs.map((o) => {
          const O = OUTPUTS[o];
          const y = outY(o);
          const lit = selected ? agents.find((a) => a.id === selected)?.writes.includes(o as never) : false;
          return (
            <g key={o} className={`flow-node is-output ${lit ? "is-lit" : ""}`}>
              <rect x={COL.out} y={y - 20} width={COL.outW} height={40} rx={20} />
              <O.icon x={COL.out + 14} y={y - 9} size={18} />
              <text x={COL.out + 42} y={y + 5}>{t(O.label)}</text>
            </g>
          );
        })}

        <g className="flow-never">
          <rect x={COL.out} y={lockY - 10} width={COL.outW} height={128} rx={18} />
          <Lock x={COL.out + 14} y={lockY + 2} size={16} weight="fill" />
          <text x={COL.out + 38} y={lockY + 15} className="flow-never-title">{t("Never connected")}</text>
          {[msg("Approve transfers"), msg("Execute transfers"), msg("Change controls"), msg("Verify recipients")].map((label, i) => (
            <text key={label} x={COL.out + 16} y={lockY + 40 + i * 19}>{t(label)}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATE_BADGE: Record<AgentLive["state"], { tone: "green" | "amber" | "gray" | "red"; label: string }> = {
  running: { tone: "green", label: msg("Working") },
  queued: { tone: "amber", label: msg("Queued") },
  idle: { tone: "gray", label: msg("Idle") },
  failing: { tone: "red", label: msg("Last run failed") },
};

const STATE_LABEL: Record<AgentLive["state"], string> = {
  running: msg("running"),
  queued: msg("queued"),
  idle: msg("idle"),
  failing: msg("failing"),
};

function AgentCard({ agent: a, now, selected, onSelect }: {
  agent: AgentLive;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { t, tp } = useI18n();
  const ui = AGENT_UI[a.id];
  const active = isActive(a, now);
  const badge = STATE_BADGE[a.state];
  const findings = a.openFindings.critical + a.openFindings.warning + a.openFindings.info;
  const right =
    a.state === "running" ? t(ui.verb)
    : a.state === "queued" ? tp(a.queued, "{n} job waiting for the worker", "{n} jobs waiting for the worker")
    : a.lastRun ? t("Finished {ago}: {summary}", { ago: ago(a.lastRun.finishedAt ?? a.lastRun.startedAt, now, t), summary: t(a.lastRun.summary ?? a.lastRun.error ?? "") })
    : t("Waiting for its first trigger ({when})", { when: t(ui.when).toLowerCase() });
  const history = [...a.recentRuns].reverse();

  return (
    <article className={`glass agent-card ${active ? "is-active" : ""} ${selected ? "is-selected" : ""} !rounded-[24px]`}>
      <button type="button" className="agent-card-head" onClick={onSelect} aria-pressed={selected}>
        <span className={`agent-avatar ${active ? "is-active" : ""}`} aria-hidden>
          <ui.icon size={22} weight="fill" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-semibold text-zinc-50">{t(a.name)}</span>
          <span className="block text-xs text-white/45">{t(ui.when)} · {tp(a.totalRuns, "{n} run", "{n} runs")}</span>
        </span>
        <Badge tone={badge.tone}>{active && a.state !== "failing" && <span className="badge-pulse" aria-hidden />}{active && a.state === "idle" ? t("Just ran") : t(badge.label)}</Badge>
      </button>

      <p className="mt-3 text-[13px] text-white/65">{t(ui.does)}</p>

      <div className="agent-now">
        <span className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">{t("Right now")}</span>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-100">{right}</p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">{t("Recent runs")}</span>
          <div className="run-strip" aria-label={tp(history.length, "Last {n} run", "Last {n} runs")}>
            {history.length === 0 ? (
              <span className="text-xs text-white/35">{t("No runs yet")}</span>
            ) : (
              history.map((r) => (
                <span key={r.id} className={`run-bar is-${r.status}`} title={`${t(r.status)} · ${ago(r.finishedAt ?? r.startedAt, now, t)} · ${t(r.summary ?? r.error ?? "")}`} />
              ))
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {a.openFindings.critical > 0 && <Badge tone="red">{t("{count} critical", { count: a.openFindings.critical })}</Badge>}
          {a.openFindings.warning > 0 && <Badge tone="amber">{t("{count} warning", { count: a.openFindings.warning })}</Badge>}
          {findings === 0 && <span className="text-xs text-white/35">{t("No open findings")}</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
        {a.reads.map((s) => (
          <span key={s} className="scope-chip">{t("reads {what}", { what: SOURCES[s] ? t(SOURCES[s].label).toLowerCase() : s })}</span>
        ))}
        {a.writes.map((w) => (
          <span key={w} className="scope-chip is-write">{t("writes {what}", { what: OUTPUTS[w] ? t(OUTPUTS[w].label).toLowerCase() : w })}</span>
        ))}
      </div>
    </article>
  );
}

function ActivityFeed({ feed, agents, now }: { feed: AgentRun[]; agents: AgentLive[]; now: number }) {
  const t = useT();
  // Highlight runs that arrived since the previous poll.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const r of feed) if (!seen.current.has(r.id)) fresh.add(r.id);
  useEffect(() => {
    seen.current = new Set(feed.map((r) => r.id));
  }, [feed]);

  return (
    <Card
      title={t("Live activity")}
      subtitle={t("Every agent run, newest first")}
      className="agents-feed xl:sticky xl:top-28 xl:self-start"
      bodyClassName="agents-feed-body"
    >
      {feed.length === 0 ? (
        <EmptyState>{t("No runs yet. Agents start as soon as there is activity to review.")}</EmptyState>
      ) : (
        <ol className="activity-feed" aria-live="polite">
          {feed.map((r) => {
            const ui = AGENT_UI[r.agentId as AgentLive["id"]];
            const name = agents.find((a) => a.id === r.agentId)?.name ?? r.agentId;
            const Icon = ui?.icon ?? ShieldCheck;
            return (
              <li key={r.id} className={`activity-item is-${r.status} ${fresh.has(r.id) ? "is-fresh" : ""}`}>
                <span className="activity-icon" aria-hidden>
                  <Icon size={16} weight="fill" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[13px] font-medium text-zinc-100">{t(name)}</span>
                    <span className="shrink-0 text-[11px] text-white/40 tabular-nums">{ago(r.finishedAt ?? r.startedAt, now, t)}</span>
                  </p>
                  <p className="line-clamp-2 text-xs text-white/55">{t(r.summary ?? r.error ?? r.status)}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
