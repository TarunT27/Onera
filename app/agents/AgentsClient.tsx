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
  ArrowsLeftRight,
  ShieldCheck,
  UserList,
  Briefcase,
  ClockCounterClockwise,
  type Icon,
} from "@phosphor-icons/react";
import type { AgentLive, AgentRun } from "@/lib/agents";
import { clearfi, paths, type AgentsLiveResponse } from "../components/api";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { useApiData } from "../components/useApiData";

const POLL_MS = 2_500;
/** An agent that finished this recently still shows as active on the map. */
const ACTIVE_MS = 12_000;

const AGENT_UI: Record<AgentLive["id"], { icon: Icon; does: string; verb: string; when: string }> = {
  threat_monitor: {
    icon: Detective,
    does: "Sweeps your audit log for attack patterns over time: probes for other people's records, executions without approval, injection attempts, recipient swaps.",
    verb: "Sweeping the audit log",
    when: "Seconds after any new activity",
  },
  security_sentinel: {
    icon: ShieldCheck,
    does: "Reviews every new or edited transfer: changed or unverified recipient, first-time payee, unusual amount, drafted by the assistant.",
    verb: "Reviewing a transfer",
    when: "Every new or edited transfer",
  },
  spending_monitor: {
    icon: ChartPieSlice,
    does: "Compares the last 30 days of spending per category with your usual pattern and flags spikes and unusually large purchases.",
    verb: "Reviewing spending",
    when: "Daily, and after new bank data",
  },
  subscription_monitor: {
    icon: Repeat,
    does: "Watches recurring charges and flags price increases, citing the charges that prove them.",
    verb: "Checking subscriptions",
    when: "Daily, and after new bank data",
  },
  portfolio_monitor: {
    icon: ChartLineUp,
    does: "Flags concentrated positions and large daily moves in your simulated portfolio.",
    verb: "Checking the portfolio",
    when: "Daily",
  },
  connection_monitor: {
    icon: Plugs,
    does: "Refreshes healthy simulated bank connections every 15 minutes and queues reviews when new data arrives.",
    verb: "Syncing bank data",
    when: "Every 15 minutes",
  },
};

const SOURCES: Record<string, { label: string; icon: Icon }> = {
  audit: { label: "Audit log", icon: ClockCounterClockwise },
  actions: { label: "Transfers", icon: ArrowsLeftRight },
  recipients: { label: "Recipients", icon: UserList },
  transactions: { label: "Transactions", icon: Receipt },
  accounts: { label: "Accounts", icon: Bank },
  portfolio: { label: "Portfolio", icon: Briefcase },
  connections: { label: "Bank connections", icon: Plugs },
};
const OUTPUTS: Record<string, { label: string; icon: Icon }> = {
  insights: { label: "Findings & alerts", icon: Lightbulb },
  jobs: { label: "Follow-up reviews", icon: ListChecks },
  connection_sync: { label: "Bank data refresh", icon: Bank },
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

function ago(iso: string | null | undefined, now: number): string {
  if (!iso) return "never";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
}

function isActive(a: AgentLive, now: number): boolean {
  if (a.state === "running" || a.state === "queued") return true;
  const t = a.lastRun?.finishedAt ?? a.lastRun?.startedAt;
  return !!t && now - Date.parse(t) < ACTIVE_MS;
}

export function AgentsClient() {
  const live = useApiData<AgentsLiveResponse>(paths.agentsLive);
  const clientNow = useNow();
  const [selected, setSelected] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>(null);

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
    <div className="space-y-6">
      <PageHeader
        title="Agents"
        description="Six background agents watch your synthetic accounts. Each one reads only what it needs and can only write findings. Watch them work live."
        action={
          <Button onClick={() => void runAll()} busy={running}>
            Run all agents now
          </Button>
        }
      />
      <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <Lock size={15} weight="fill" aria-hidden />
        Rule-based, no AI model. No agent can approve, execute, verify recipients or change your controls.
      </p>

      <ErrorBox error={error} onDismiss={() => setError(null)} />
      <ErrorBox error={live.error} title="Couldn't load agent status" onRetry={() => void live.reload()} />

      {!data ? (
        live.loading ? <Loading label="Loading agents…" /> : null
      ) : (
        <>
          <WorkerStrip data={data} now={now} />
          <Card
            title="Live map"
            subtitle="Lines light up and data flows while an agent works. Select an agent to trace what it touches."
          >
            <FlowMap agents={data.agents} now={now} selected={selected} onSelect={setSelected} />
          </Card>
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="grid gap-4 md:grid-cols-2">
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function WorkerStrip({ data, now }: { data: AgentsLiveResponse; now: number }) {
  const w = data.worker;
  const b = data.backlog;
  const beatAge = w.latest ? now - Date.parse(w.latest.lastBeatAt) : null;
  const status =
    w.status === "live"
      ? { cls: "is-live", title: "Background monitoring active", text: `Checked ${ago(w.latest?.lastBeatAt, now)}` }
      : w.status === "stale"
        ? { cls: "is-stale", title: "Monitoring degraded", text: `Last completed check ${ago(w.latest?.lastBeatAt, now)}` }
        : { cls: "is-off", title: "Background worker not running", text: "Agents run only when you click Run all agents now" };
  const pending = b.due + b.waiting + b.running;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
      <section className={`glass worker-status ${status.cls} !rounded-[24px]`} aria-live="polite">
        <span className="worker-dot" aria-hidden />
        <div className="min-w-0">
          <p className="font-semibold text-zinc-50">{status.title}</p>
          <p className="truncate text-xs text-white/50">
            {status.text}
            {w.latest && w.status === "live" && beatAge !== null && (
              <> · {w.latest.mode === "in-process" ? "inside the app server" : "standalone worker"} · every {Math.round(w.latest.intervalMs / 1000)} s</>
            )}
          </p>
        </div>
      </section>
      <Metric label="Pending jobs" value={pending} hint={pending === 0 ? "All caught up" : `${b.due} due · ${b.waiting} retrying · ${b.running} running`} />
      <Metric label="Worker ticks" value={w.latest?.ticks ?? 0} hint={w.latest ? `${w.latest.tickErrors} failed ticks` : "No heartbeat yet"} />
      <Metric
        label="Dead-lettered"
        value={b.dead}
        hint={b.dead ? "Jobs that gave up; kept for review" : "None"}
        tone={b.dead ? "text-red-300" : undefined}
      />
    </div>
  );
}

function Metric({ label, value, hint, tone = "text-zinc-50" }: { label: string; value: number | string; hint: string; tone?: string }) {
  return (
    <section className="glass min-w-0 !rounded-[24px] px-5 py-4">
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
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="flow-map min-w-[760px]"
        role="img"
        aria-label="Map of which data each agent reads and what it writes"
      >
        <text x={COL.src} y={14} className="flow-col">Reads (your data only)</text>
        <text x={COL.agent} y={14} className="flow-col">Agents</text>
        <text x={COL.out} y={14} className="flow-col">Can write</text>

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
              <text x={COL.src + 42} y={y + 5}>{S.label}</text>
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
              aria-label={`${a.name}: ${a.state}`}
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
              <text x={COL.agent + 58} y={y - 3} className="flow-agent-name">{a.name}</text>
              <text x={COL.agent + 58} y={y + 14} className="flow-agent-state">
                {a.state === "running" ? `${ui.verb}…` : a.state === "queued" ? `${a.queued} job${a.queued === 1 ? "" : "s"} queued` : a.state === "failing" ? "Last run failed" : a.lastRun ? `Idle · ran ${ago(a.lastRun.finishedAt ?? a.lastRun.startedAt, now)}` : `Idle · ${ui.when.toLowerCase()}`}
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
              <text x={COL.out + 42} y={y + 5}>{O.label}</text>
            </g>
          );
        })}

        <g className="flow-never">
          <rect x={COL.out} y={lockY - 10} width={COL.outW} height={128} rx={18} />
          <Lock x={COL.out + 14} y={lockY + 2} size={16} weight="fill" />
          <text x={COL.out + 38} y={lockY + 15} className="flow-never-title">Never connected</text>
          {["Approve transfers", "Execute transfers", "Change controls", "Verify recipients"].map((t, i) => (
            <text key={t} x={COL.out + 16} y={lockY + 40 + i * 19}>{t}</text>
          ))}
        </g>
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STATE_BADGE: Record<AgentLive["state"], { tone: "green" | "amber" | "gray" | "red"; label: string }> = {
  running: { tone: "green", label: "Working" },
  queued: { tone: "amber", label: "Queued" },
  idle: { tone: "gray", label: "Idle" },
  failing: { tone: "red", label: "Last run failed" },
};

function AgentCard({ agent: a, now, selected, onSelect }: {
  agent: AgentLive;
  now: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const ui = AGENT_UI[a.id];
  const active = isActive(a, now);
  const badge = STATE_BADGE[a.state];
  const findings = a.openFindings.critical + a.openFindings.warning + a.openFindings.info;
  const right =
    a.state === "running" ? `${ui.verb}…`
    : a.state === "queued" ? `${a.queued} job${a.queued === 1 ? "" : "s"} waiting for the worker`
    : a.lastRun ? `Finished ${ago(a.lastRun.finishedAt ?? a.lastRun.startedAt, now)}: ${a.lastRun.summary ?? a.lastRun.error ?? ""}`
    : `Waiting for its first trigger (${ui.when.toLowerCase()})`;
  const history = [...a.recentRuns].reverse();

  return (
    <article className={`glass agent-card ${active ? "is-active" : ""} ${selected ? "is-selected" : ""} !rounded-[24px]`}>
      <button type="button" className="agent-card-head" onClick={onSelect} aria-pressed={selected}>
        <span className={`agent-avatar ${active ? "is-active" : ""}`} aria-hidden>
          <ui.icon size={22} weight="fill" />
        </span>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-semibold text-zinc-50">{a.name}</span>
          <span className="block text-xs text-white/45">{ui.when} · {a.totalRuns} run{a.totalRuns === 1 ? "" : "s"}</span>
        </span>
        <Badge tone={badge.tone}>{active && a.state !== "failing" && <span className="badge-pulse" aria-hidden />}{active && a.state === "idle" ? "Just ran" : badge.label}</Badge>
      </button>

      <p className="mt-3 text-[13px] text-white/65">{ui.does}</p>

      <div className="agent-now">
        <span className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">Right now</span>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-zinc-100">{right}</p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <span className="text-[11px] font-semibold tracking-wide text-white/40 uppercase">Recent runs</span>
          <div className="run-strip" aria-label={`Last ${history.length} runs`}>
            {history.length === 0 ? (
              <span className="text-xs text-white/35">No runs yet</span>
            ) : (
              history.map((r) => (
                <span key={r.id} className={`run-bar is-${r.status}`} title={`${r.status} · ${ago(r.finishedAt ?? r.startedAt, now)} · ${r.summary ?? r.error ?? ""}`} />
              ))
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {a.openFindings.critical > 0 && <Badge tone="red">{a.openFindings.critical} critical</Badge>}
          {a.openFindings.warning > 0 && <Badge tone="amber">{a.openFindings.warning} warning</Badge>}
          {findings === 0 && <span className="text-xs text-white/35">No open findings</span>}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-white/[0.06] pt-3">
        {a.reads.map((s) => (
          <span key={s} className="scope-chip">reads {SOURCES[s]?.label.toLowerCase() ?? s}</span>
        ))}
        {a.writes.map((w) => (
          <span key={w} className="scope-chip is-write">writes {OUTPUTS[w]?.label.toLowerCase() ?? w}</span>
        ))}
      </div>
    </article>
  );
}

function ActivityFeed({ feed, agents, now }: { feed: AgentRun[]; agents: AgentLive[]; now: number }) {
  // Highlight runs that arrived since the previous poll.
  const seen = useRef<Set<string> | null>(null);
  const fresh = new Set<string>();
  if (seen.current) for (const r of feed) if (!seen.current.has(r.id)) fresh.add(r.id);
  useEffect(() => {
    seen.current = new Set(feed.map((r) => r.id));
  }, [feed]);

  return (
    <Card title="Live activity" subtitle="Every agent run, newest first" className="xl:sticky xl:top-28 xl:self-start">
      {feed.length === 0 ? (
        <EmptyState>No runs yet. Agents start as soon as there is activity to review.</EmptyState>
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
                    <span className="truncate text-[13px] font-medium text-zinc-100">{name}</span>
                    <span className="shrink-0 text-[11px] text-white/40 tabular-nums">{ago(r.finishedAt ?? r.startedAt, now)}</span>
                  </p>
                  <p className="line-clamp-2 text-xs text-white/55">{r.summary ?? r.error ?? r.status}</p>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
