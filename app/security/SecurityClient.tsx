"use client";

/**
 * Security centre: live findings from the threat monitor and the security
 * sentinel, plus the security-relevant slice of the audit log. Advisory only —
 * the monitors cannot pause, hold, approve or execute. The one protective
 * action here, "Pause transfers", is the user's own click through the same
 * PATCH /api/controls the Control page uses.
 *
 * Layout, top to bottom: a status ring that answers "am I OK?", a 7-day
 * signal chart, the four layers that stop a bad transfer (with live counts),
 * then the alerts and the "what happened" timeline side by side.
 */
import Link from "next/link";
import { useEffect, useId, useState, type ComponentType } from "react";
import {
  ArrowCounterClockwise,
  ArrowsClockwise,
  CaretRight,
  CheckCircle,
  Detective,
  Gauge,
  Handshake,
  Pause,
  Prohibit,
  Robot,
  Scales,
  SealCheck,
  ShieldCheck,
  ShieldWarning,
  Sliders,
  UserSwitch,
  XCircle,
  type IconProps,
} from "@phosphor-icons/react";
import type { AuditEvent } from "@/lib/types";
import {
  clearfi,
  paths,
  type AgentInsight,
  type AgentInsightsResponse,
  type AgentsResponse,
  type AuditResponse,
  type ChatSecurityResponse,
  type ControlsResponse,
} from "../components/api";
import { AssistantMonitor, monitorLabel } from "./AssistantMonitor";
import { AuditList, actorMeta, eventLabel } from "../components/AuditList";
import { SyntheticLabel } from "../components/Badge";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatDate, formatDateTime } from "../components/format";
import { useI18n, useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import type { Translate } from "@/lib/i18n/translate";
import { SEVERITY } from "../components/InsightCard";
import { splitInsightBody } from "../components/insightText";
import { useApiData } from "../components/useApiData";
import "./security-screen.css";

type Icon = ComponentType<IconProps>;
type Tone = "red" | "amber" | "blue" | "green" | "violet" | "gray";

const SECURITY_AGENTS = new Set(["threat_monitor", "security_sentinel"]);
const POLL_MS = 10_000;
const SEVERITY_RANK: Record<AgentInsight["severity"], number> = { critical: 2, warning: 1, info: 0 };
const SEVERITY_TONE: Record<AgentInsight["severity"], Tone> = { critical: "red", warning: "amber", info: "blue" };
const AUDIT_LIMIT = 500;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RING_C = 2 * Math.PI * 48;

/** Audit events worth showing on the security timeline. */
const SECURITY_EVENT = /^(request\.refused|action\.(execute_refused|execute_duplicate|approval_invalidated|held|failed)|order\.(execute_refused|execute_duplicate|approval_invalidated|failed)|recipient\.(changed|verified)|controls\.|trading_controls\.|mandate\.|assistant\.untrusted_instructions|agent\.(scope_violation|job_dead))/;
/** Layer 1: proposals the deterministic policy held. */
const POLICY_HOLD = /^(action|order)\.held$/;
/** Layer 3: execution attempts refused at the moment money would move. */
const EXEC_REFUSED = /^(action|order)\.(execute_refused|execute_duplicate|approval_invalidated)$/;

const SIGNAL_LABEL: Record<string, string> = {
  CROSS_USER_PROBE: msg("Cross-user probe"),
  UNAPPROVED_EXECUTION: msg("Unapproved execution"),
  STALE_APPROVAL_REPLAY: msg("Stale approval"),
  RECIPIENT_SWAP: msg("Recipient swap"),
  REPLAY_EXECUTION: msg("Replay"),
  LIMIT_PROBING: msg("Limit probing"),
  CONTROLS_LOOSENED_THEN_SPEND: msg("Controls loosened"),
  PROMPT_INJECTION: msg("Prompt injection"),
  ASSISTANT_PRIVILEGE_ATTEMPT: msg("Privilege attempt"),
  EXECUTION_FAILURE: msg("Failure"),
  TRANSFER_VELOCITY: msg("Velocity"),
};

const SIGNAL_ICON: Record<string, Icon> = {
  CROSS_USER_PROBE: Detective,
  UNAPPROVED_EXECUTION: Prohibit,
  STALE_APPROVAL_REPLAY: ArrowCounterClockwise,
  RECIPIENT_SWAP: UserSwitch,
  REPLAY_EXECUTION: ArrowsClockwise,
  LIMIT_PROBING: Scales,
  CONTROLS_LOOSENED_THEN_SPEND: Sliders,
  PROMPT_INJECTION: Robot,
  ASSISTANT_PRIVILEGE_ATTEMPT: Robot,
  EXECUTION_FAILURE: XCircle,
  TRANSFER_VELOCITY: Gauge,
};

const FILTERS = [
  { label: msg("All"), test: () => true },
  { label: msg("Critical"), test: (i: AgentInsight) => i.severity === "critical" },
  { label: msg("Warnings"), test: (i: AgentInsight) => i.severity === "warning" },
  { label: msg("Seen"), test: (i: AgentInsight) => i.status !== "new" },
] as const;

const LAYERS: { title: string; body: string; Icon: Icon; tone: Tone }[] = [
  { title: msg("Policy checks"), body: msg("Every proposal is checked against your limits and verified recipients"), Icon: Scales, tone: "blue" },
  { title: msg("Your approval"), body: msg("Nothing runs until you approve the exact version"), Icon: Handshake, tone: "green" },
  { title: msg("Execution re-check"), body: msg("Rules are checked again at the moment money moves"), Icon: Prohibit, tone: "violet" },
  { title: msg("Monitors"), body: msg("Watch the audit log and every chat for attack patterns"), Icon: ShieldCheck, tone: "amber" },
];

function signalLabel(i: AgentInsight, t: Translate): string {
  if (typeof i.evidence.signal === "string") return t(SIGNAL_LABEL[i.evidence.signal] ?? i.evidence.signal);
  return i.agentId === "security_sentinel" ? t("Transfer review") : i.type;
}

function signalIcon(i: AgentInsight): Icon {
  return (typeof i.evidence.signal === "string" && SIGNAL_ICON[i.evidence.signal]) || ShieldWarning;
}

/** Icon and colour for a timeline row, from the event type alone. */
function eventLook(type: string): { Icon: Icon; tone: Tone } {
  if (type === "controls.paused") return { Icon: Pause, tone: "red" };
  if (type.startsWith("controls.") || type.startsWith("trading_controls.")) return { Icon: Sliders, tone: "green" };
  if (type === "recipient.changed") return { Icon: UserSwitch, tone: "amber" };
  if (type === "recipient.verified") return { Icon: SealCheck, tone: "green" };
  if (type.startsWith("mandate.")) return { Icon: Handshake, tone: "violet" };
  if (type.startsWith("assistant.") || type.startsWith("agent.")) return { Icon: Robot, tone: "violet" };
  if (type.endsWith("approval_invalidated")) return { Icon: ArrowCounterClockwise, tone: "blue" };
  if (type.endsWith(".held")) return { Icon: ShieldWarning, tone: "amber" };
  if (type.endsWith(".failed")) return { Icon: XCircle, tone: "red" };
  return { Icon: Prohibit, tone: "red" };
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function SecurityClient() {
  const { t, tp } = useI18n();
  const insights = useApiData<AgentInsightsResponse>(`${paths.agentInsights}?limit=200`);
  const audit = useApiData<AuditResponse>(paths.audit({ limit: AUDIT_LIMIT }));
  const agents = useApiData<AgentsResponse>(paths.agents);
  const controls = useApiData<ControlsResponse>(paths.controls);
  const chat = useApiData<ChatSecurityResponse>(paths.chatSecurity);

  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState(0);
  const [sideTab, setSideTab] = useState(0);

  // Live feed: refresh while the tab is visible. The background worker raises findings on its own.
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void insights.reload();
      void audit.reload();
      void agents.reload();
      void chat.reload();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [insights.reload, audit.reload, agents.reload, chat.reload]);

  // Open before seen, then most severe; the API already orders by most recent.
  const alerts = (insights.data?.insights ?? [])
    .filter((i) => SECURITY_AGENTS.has(i.agentId) && i.status !== "dismissed")
    .sort((a, b) => Number(b.status === "new") - Number(a.status === "new") || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const open = alerts.filter((i) => i.status === "new");
  const count = (sev: AgentInsight["severity"]) => open.filter((i) => i.severity === sev).length;
  const shown = alerts.filter(FILTERS[filter].test);
  const events = audit.data?.events ?? [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const timeline = events.filter((e) => SECURITY_EVENT.test(e.eventType)).slice(0, 40);
  const lastSweep = agents.data?.agents.find((a) => a.id === "threat_monitor")?.lastRun ?? null;
  const paused = controls.data?.controls.paused ?? false;
  const monitor = chat.data?.status;

  // Counts for the "how Onera stops a bad transfer" layers, over the last 7 days of the audit log.
  const weekAgo = Date.now() - WEEK_MS;
  const recent = events.filter((e) => Date.parse(e.createdAt) >= weekAgo);
  const held = recent.filter((e) => POLICY_HOLD.test(e.eventType)).length;
  const refused = recent.filter((e) => EXEC_REFUSED.test(e.eventType)).length;
  const layerStat = [
    tp(held, "{n} held this week", "{n} held this week"),
    t("Required · always on"),
    tp(refused, "{n} refused this week", "{n} refused this week"),
    tp(open.length, "{n} open alert", "{n} open alerts"),
  ];

  const tone: Tone = count("critical") > 0 ? "red" : open.length > 0 ? "amber" : "green";
  const reviewed = alerts.length - open.length;
  const ringShare = alerts.length ? reviewed / alerts.length : 1;
  const sweptAt = lastSweep ? formatDateTime(lastSweep.finishedAt ?? lastSweep.startedAt) : t("Not yet");

  async function runSweep() {
    setRunning(true);
    setError(null);
    try {
      await clearfi.runAgents();
      await Promise.all([insights.reload(), audit.reload(), agents.reload(), chat.reload()]);
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  }

  async function mark(insight: AgentInsight, status: "seen" | "dismissed") {
    setBusyId(insight.id);
    setError(null);
    try {
      const { insight: next } = await clearfi.setInsightStatus(insight.id, status);
      const all = insights.data?.insights ?? [];
      insights.setData({
        insights: all.flatMap((i) => (i.id !== insight.id ? [i] : status === "dismissed" ? [] : [next])),
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  async function pauseTransfers() {
    setError(null);
    try {
      const { controls: next } = await clearfi.updateControls({ paused: true });
      if (controls.data) controls.setData({ ...controls.data, controls: next });
      void audit.reload();
    } catch (e) {
      setError(e);
    }
  }

  const sideSeg = (
    <div className="seg sec-side-seg" role="radiogroup" aria-label={t("Show timeline or assistant monitor")} style={{ ["--n" as string]: 2, ["--idx" as string]: sideTab }}>
      <span className="seg-lens" aria-hidden />
      {[msg("Timeline"), msg("Assistant")].map((label, i) => (
        <button key={label} type="button" role="radio" aria-checked={sideTab === i} onClick={() => setSideTab(i)}>
          {t(label)}
        </button>
      ))}
    </div>
  );

  return (
    <div className="security-screen screen" data-tone={tone}>
      <div className="security-head">
        <PageHeader
          title={t("Security")}
          description={t("Onera watches every transfer and every chat for attack patterns. You stay in control of what happens next.")}
          action={
            <button type="button" className="sec-sweep" onClick={() => void runSweep()} disabled={running} aria-busy={running || undefined}>
              <ArrowsClockwise size={16} weight="bold" className={running ? "sec-spin" : undefined} aria-hidden />
              {running ? t("Sweeping…") : t("Run sweep now")}
            </button>
          }
        />
      </div>

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <div className="sec-top">
        <section className="sec-status sec-tile" aria-labelledby="sec-status-title">
          <div className="sec-ring" aria-hidden>
            <svg viewBox="0 0 120 120">
              <circle cx="60" cy="60" r="48" className="sec-ring-track" />
              <circle
                cx="60"
                cy="60"
                r="48"
                className="sec-ring-fill"
                strokeDasharray={RING_C}
                strokeDashoffset={RING_C * (1 - ringShare)}
                style={{ ["--ring-c" as string]: RING_C }}
              />
            </svg>
            <span className="sec-ring-icon">{tone === "green" ? <ShieldCheck size={40} weight="fill" /> : <ShieldWarning size={40} weight="fill" />}</span>
          </div>
          <div className="sec-status-copy">
            <p className="sec-kicker">{tone === "green" ? t("Protected") : t("Needs your attention")}</p>
            <h2 id="sec-status-title" className="sec-headline" key={open.length}>
              {insights.data
                ? open.length > 0
                  ? tp(open.length, "{n} thing needs a look", "{n} things need a look")
                  : t("All clear")
                : t("Checking…")}
            </h2>
            <p className="sec-summary">
              {open.length > 0
                ? t("{critical} critical · {warning} warning · last sweep {time}", { critical: count("critical"), warning: count("warning"), time: sweptAt })
                : t("No open alerts · last sweep {time}", { time: sweptAt })}
              {alerts.length > 0 && <> · {t("{reviewed} of {total} reviewed", { reviewed, total: alerts.length })}</>}
            </p>
            <ul className="sec-pills">
              <li>
                <Link href="/control" className="sec-pill" title={t("Manage controls")}>
                  <span className={`sec-dot ${paused ? "is-red" : "is-green"}`} aria-hidden />
                  {controls.data ? (paused ? t("Transfers paused") : t("Transfers active")) : t("Transfers")}
                </Link>
              </li>
              {monitor && (
                <li className="sec-pill" title={monitorLabel(monitor, t)}>
                  <span
                    className={`sec-dot ${monitor.health === "active" ? "is-green is-pulse" : monitor.health === "lagging" ? "is-amber" : monitor.health === "degraded" ? "is-red" : "is-gray"}`}
                    aria-hidden
                  />
                  {monitor.health === "active"
                    ? t("Assistant monitor watching")
                    : monitor.health === "lagging"
                      ? t("Assistant monitor lagging")
                      : monitor.health === "degraded"
                        ? t("Assistant monitor degraded")
                        : t("Assistant monitor off")}
                </li>
              )}
              <li className="sec-pill">
                <CheckCircle size={14} weight="fill" className="sec-pill-check" aria-hidden />
                {t("Your approval always required")}
              </li>
            </ul>
          </div>
        </section>

        <WeekChart alerts={alerts} />
      </div>

      <section className="sec-layers" aria-labelledby="sec-layers-title">
        <h2 id="sec-layers-title" className="sec-h2">{t("How Onera stops a bad transfer")}</h2>
        <ol>
          {LAYERS.map((l, i) => (
            <li key={l.title} className="sec-layer" data-tone={l.tone}>
              <span className="sec-layer-icon" aria-hidden>
                <l.Icon size={20} weight="fill" />
              </span>
              <span className="sec-layer-copy">
                <span className="sec-layer-step">{i + 1}</span>
                <strong>{t(l.title)}</strong>
                <span className="sec-layer-body">{t(l.body)}</span>
                <span className="sec-layer-stat">{layerStat[i]}</span>
              </span>
              {i < LAYERS.length - 1 && <CaretRight size={14} weight="bold" className="sec-layer-arrow" aria-hidden />}
            </li>
          ))}
        </ol>
      </section>

      <div className="security-body screen-body">
        <Card
          title={t("Alerts")}
          subtitle={t("{count} open · refreshes every {seconds} s", { count: open.length, seconds: POLL_MS / 1000 })}
          className="security-card security-alerts"
          bodyClassName="security-card-body"
          action={
            <div className="sec-filters" role="radiogroup" aria-label={t("Filter alerts")}>
              {FILTERS.map((f, i) => (
                <button key={f.label} type="button" role="radio" aria-checked={filter === i} onClick={() => setFilter(i)} className="sec-chip">
                  {t(f.label)} <span className="sec-chip-count">{alerts.filter(f.test).length}</span>
                </button>
              ))}
            </div>
          }
        >
          <ErrorBox error={insights.error} title={t("Couldn't load alerts")} className="mb-3" onRetry={() => void insights.reload()} />
          {insights.loading && !insights.data ? (
            <Loading label={t("Loading alerts…")} />
          ) : shown.length === 0 ? (
            <div className="sec-empty">
              <span aria-hidden>
                <ShieldCheck size={30} weight="fill" />
              </span>
              <strong>{t("Nothing needs your attention")}</strong>
              {t("No security alerts. The monitor flags suspicious activity here as soon as it sees it.")}
            </div>
          ) : (
            <ul className="sec-alerts" aria-label={t("Security alerts")}>
              {shown.map((i) => (
                <Alert
                  key={i.id}
                  insight={i}
                  cited={((i.evidence.auditEventIds as number[] | undefined) ?? []).flatMap((id) => eventById.get(id) ?? [])}
                  busy={busyId === i.id}
                  disabled={busyId !== null}
                  paused={paused}
                  onMark={(s) => void mark(i, s)}
                  onPause={pauseTransfers}
                />
              ))}
            </ul>
          )}
        </Card>

        {sideTab === 0 ? (
          <Card
            title={t("What happened")}
            subtitle={t("From your audit log, newest first")}
            className="security-card security-events"
            bodyClassName="security-card-body"
            action={sideSeg}
          >
            <ErrorBox error={audit.error} title={t("Couldn't load audit log")} className="mb-3" />
            {audit.loading && !audit.data ? (
              <Loading />
            ) : timeline.length > 0 ? (
              <Timeline events={timeline} />
            ) : audit.error ? null : (
              <EmptyState>{t("No security events yet.")}</EmptyState>
            )}
          </Card>
        ) : (
          <AssistantMonitor chat={chat} action={sideSeg} className="security-card security-monitor" bodyClassName="security-card-body" />
        )}
      </div>

      <p className="security-note">
        <SyntheticLabel />
        {t("Rule-based monitoring of synthetic activity. Advisory only; it doesn't block transfers, and it isn't a guarantee that every attack is detected.")}
      </p>
    </div>
  );
}

/** Seven columns of severity dots, one per day, today on the right. */
function WeekChart({ alerts }: { alerts: AgentInsight[] }) {
  const { t, tp } = useI18n();
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, k) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - k));
    return { key: dayKey(d), date: d, items: [] as AgentInsight[] };
  });
  const byKey = new Map(days.map((d) => [d.key, d]));
  for (const a of alerts) byKey.get(dayKey(new Date(a.createdAt)))?.items.push(a);
  const total = days.reduce((n, d) => n + d.items.length, 0);
  const latest = alerts.length ? [...alerts].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] : null;
  const MAX_DOTS = 4;

  return (
    <section className="sec-week sec-tile" aria-labelledby="sec-week-title">
      <header>
        <h2 id="sec-week-title" className="sec-h2">{t("Last 7 days")}</h2>
        <span className="sec-legend" aria-hidden>
          {(["critical", "warning", "info"] as const).map((s) => (
            <span key={s} data-tone={SEVERITY_TONE[s]}>
              <i />
              {t(SEVERITY[s].label)}
            </span>
          ))}
        </span>
      </header>
      <div className="sec-week-cols" role="img" aria-label={tp(total, "{n} security signal in the last 7 days", "{n} security signals in the last 7 days")}>
        {days.map((d, k) => {
          const sorted = [...d.items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
          const extra = sorted.length - MAX_DOTS;
          return (
            <div key={d.key} className={k === 6 ? "is-today" : undefined}>
              <span className="sec-dots">
                {sorted.length === 0 && <i className="is-none" />}
                {sorted.slice(0, extra > 0 ? MAX_DOTS - 1 : MAX_DOTS).map((a) => (
                  <i key={a.id} data-tone={SEVERITY_TONE[a.severity]} />
                ))}
                {extra > 0 && <b>+{extra + 1}</b>}
              </span>
              <span className="sec-day">{k === 6 ? t("Today") : formatDate(d.date, { weekday: "short" })}</span>
            </div>
          );
        })}
      </div>
      <p className="sec-week-foot">
        {tp(total, "{n} signal this week.", "{n} signals this week.")}
        {latest && <> {t("Latest: {title}", { title: latest.title })}</>}
      </p>
    </section>
  );
}

function Timeline({ events }: { events: AuditEvent[] }) {
  const t = useT();
  return (
    <ol className="sec-timeline" aria-label={t("Security events")}>
      {events.map((e) => {
        const { Icon, tone } = eventLook(e.eventType);
        return (
          <li key={e.id} data-tone={tone}>
            <span className="sec-tl-icon" aria-hidden>
              <Icon size={17} weight="fill" />
            </span>
            <span className="sec-tl-copy">
              <span className="sec-tl-row">
                <strong>{t(eventLabel(e.eventType))}</strong>
                <time dateTime={e.createdAt}>{formatDateTime(e.createdAt)}</time>
              </span>
              <span className="sec-tl-meta">
                {t(actorMeta(e.actor).label)}
                {e.actionId && (
                  <>
                    {" · "}
                    <Link href={`/transfers?id=${encodeURIComponent(e.actionId)}`}>{t("View transfer")}</Link>
                  </>
                )}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Alert({ insight: i, cited, busy, disabled, paused, onMark, onPause }: {
  insight: AgentInsight;
  cited: AuditEvent[];
  busy: boolean;
  disabled: boolean;
  paused: boolean;
  onMark: (status: "seen" | "dismissed") => void;
  onPause: () => Promise<void>;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [showEvidence, setShowEvidence] = useState(false);
  const evidenceId = useId();
  const actionIds = i.evidence.actionIds ?? [];
  const evidenceCount = cited.length + actionIds.length;
  const sev = SEVERITY[i.severity] ?? SEVERITY.info;
  const SignalIcon = signalIcon(i);
  const isNew = i.status === "new";
  const { lede, more } = splitInsightBody(i.body, undefined, t);

  async function confirmPause() {
    setPausing(true);
    await onPause();
    setPausing(false);
    setConfirming(false);
  }

  return (
    <li className="sec-alert" data-tone={SEVERITY_TONE[i.severity]} data-seen={!isNew || undefined}>
      <article aria-labelledby={`alert-${i.id}`}>
        <span className="sec-alert-icon" aria-hidden>
          <SignalIcon size={20} weight="fill" />
        </span>
        <div className="sec-alert-main">
          <p className="sec-alert-meta">
            <span className="sec-sev">{t(sev.label)}</span>
            <span>
              {signalLabel(i, t)} · {formatDateTime(i.updatedAt)}
            </span>
            <span className="sec-alert-agent">{i.agentId === "threat_monitor" ? t("Threat monitor") : t("Security sentinel")}</span>
            {!isNew && <span className="sec-alert-seen">{t("Seen")}</span>}
          </p>
          <h3 id={`alert-${i.id}`}>{i.title}</h3>
          {lede && <p className="sec-alert-why">{lede}</p>}

          {showEvidence && (
            <div id={evidenceId} className="sec-evidence">
              {more && <p className="sec-alert-fine">{more}</p>}
              {actionIds.length > 0 && (
                <ul>
                  {actionIds.map((id) => (
                    <li key={id}>
                      <Link href={`/transfers?id=${encodeURIComponent(id)}`}>{t("Transfer {id}", { id })}</Link>
                    </li>
                  ))}
                </ul>
              )}
              {cited.length > 0 && <AuditList events={cited} showActionLink={false} />}
            </div>
          )}

          <div className="sec-alert-actions">
            {i.severity === "critical" && !paused &&
              (confirming ? (
                <span className="sec-confirm" role="group" aria-label={t("Pause transfers")}>
                  <span>{t("Pause all transfer execution, including approved ones?")}</span>
                  <button type="button" className="sec-btn is-danger" disabled={pausing} aria-busy={pausing || undefined} onClick={() => void confirmPause()}>
                    {t("Yes, pause transfers")}
                  </button>
                  <button type="button" className="sec-btn is-quiet" onClick={() => setConfirming(false)}>
                    {t("Cancel")}
                  </button>
                </span>
              ) : (
                <button type="button" className="sec-btn is-danger" onClick={() => setConfirming(true)}>
                  <ShieldWarning size={14} weight="fill" aria-hidden />
                  {t("Pause transfers")}
                </button>
              ))}
            {i.severity === "critical" && paused && (
              <span className="sec-paused">
                <Pause size={13} weight="fill" aria-hidden />
                {t("Transfers paused")}
              </span>
            )}
            {(evidenceCount > 0 || more) && (
              <button
                type="button"
                className="sec-btn is-link"
                aria-expanded={showEvidence}
                aria-controls={showEvidence ? evidenceId : undefined}
                onClick={() => setShowEvidence((v) => !v)}
              >
                {showEvidence ? t("Hide details") : evidenceCount > 0 ? t("See evidence ({count})", { count: evidenceCount }) : t("Details")}
                <CaretRight size={12} weight="bold" className="sec-caret" data-open={showEvidence || undefined} aria-hidden />
              </button>
            )}
            <span className="sec-alert-end">
              {isNew && (
                <button type="button" className="sec-btn" disabled={disabled || busy} aria-busy={busy || undefined} onClick={() => onMark("seen")}>
                  {t("Mark seen")}
                </button>
              )}
              <button
                type="button"
                className="sec-btn is-quiet"
                disabled={disabled}
                onClick={() => onMark("dismissed")}
                aria-label={t("Dismiss: {title}", { title: i.title })}
              >
                {t("Dismiss")}
              </button>
            </span>
          </div>
        </div>
      </article>
    </li>
  );
}
