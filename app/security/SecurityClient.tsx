"use client";

/**
 * Security centre: live findings from the threat monitor and the security
 * sentinel, plus the security-relevant slice of the audit log. Advisory only —
 * the monitors cannot pause, hold, approve or execute. The one protective
 * action here, "Pause transfers", is the user's own click through the same
 * PATCH /api/controls the Control page uses.
 */
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
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
import { AssistantMonitor } from "./AssistantMonitor";
import { AuditList } from "../components/AuditList";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatDateTime } from "../components/format";
import { useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import type { Translate } from "@/lib/i18n/translate";
import { InsightCard } from "../components/InsightCard";
import { useApiData } from "../components/useApiData";
import "./security-screen.css";

const SECURITY_AGENTS = new Set(["threat_monitor", "security_sentinel"]);
const POLL_MS = 10_000;
const SEVERITY_RANK: Record<AgentInsight["severity"], number> = { critical: 2, warning: 1, info: 0 };
const AUDIT_LIMIT = 500;

/** Audit events worth showing on the security timeline. */
const SECURITY_EVENT = /^(request\.refused|action\.(execute_refused|execute_duplicate|approval_invalidated|held|failed)|order\.(execute_refused|execute_duplicate|approval_invalidated|failed)|recipient\.(changed|verified)|controls\.|trading_controls\.|mandate\.|assistant\.untrusted_instructions|agent\.(scope_violation|job_dead))/;

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

function signalLabel(i: AgentInsight, t: Translate): string {
  if (typeof i.evidence.signal === "string") return t(SIGNAL_LABEL[i.evidence.signal] ?? i.evidence.signal);
  return i.agentId === "security_sentinel" ? t("Transfer review") : i.type;
}

export function SecurityClient() {
  const t = useT();
  const insights = useApiData<AgentInsightsResponse>(`${paths.agentInsights}?limit=200`);
  const audit = useApiData<AuditResponse>(paths.audit({ limit: AUDIT_LIMIT }));
  const agents = useApiData<AgentsResponse>(paths.agents);
  const controls = useApiData<ControlsResponse>(paths.controls);
  const chat = useApiData<ChatSecurityResponse>(paths.chatSecurity);

  const [running, setRunning] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

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
    .filter((i) => SECURITY_AGENTS.has(i.agentId))
    .sort((a, b) => Number(b.status === "new") - Number(a.status === "new") || SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]);
  const open = alerts.filter((i) => i.status === "new");
  const count = (sev: AgentInsight["severity"]) => open.filter((i) => i.severity === sev).length;
  const events = audit.data?.events ?? [];
  const eventById = new Map(events.map((e) => [e.id, e]));
  const timeline = events.filter((e) => SECURITY_EVENT.test(e.eventType)).slice(0, 40);
  const lastSweep = agents.data?.agents.find((a) => a.id === "threat_monitor")?.lastRun ?? null;
  const paused = controls.data?.controls.paused ?? false;

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

  return (
    <div className="security-screen screen space-y-6">
      <div className="security-head">
        <PageHeader
          title={t("Security")}
          description={t("Background monitors watch your audit log and every assistant conversation for attack patterns and flag them here. They can only raise alerts: they can't pause, approve or move money.")}
          action={
            <Button onClick={() => void runSweep()} busy={running}>
              {t("Run sweep now")}
            </Button>
          }
        />
      </div>

      <p className="security-note flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <ShieldCheck size={16} weight="fill" aria-hidden />
        {t("Rule-based monitoring of synthetic activity. Advisory only; it doesn't block transfers, and it isn't a guarantee that every attack is detected.")}
      </p>

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <div className="security-stats grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label={t("Critical")} value={count("critical")} tone="text-red-300" />
        <Stat label={t("Warnings")} value={count("warning")} tone="text-amber-200" />
        <Stat
          label={t("Last sweep")}
          value={lastSweep ? formatDateTime(lastSweep.finishedAt ?? lastSweep.startedAt) : t("Not yet")}
          detail={lastSweep?.summary ? t(lastSweep.summary) : t("Sweeps run shortly after new activity while the worker is running.")}
        />
        <Stat
          label={t("Transfers")}
          value={controls.data ? (paused ? t("Paused") : t("Active")) : "—"}
          tone={paused ? "text-red-300" : "text-green-300"}
          detail={<Link href="/control" className="underline underline-offset-2">{t("Manage controls")}</Link>}
        />
      </div>

      <div className="security-body screen-body space-y-6">
        <div className="security-findings space-y-6">
          <Card
            title={t("Alerts")}
            subtitle={t("{count} open · refreshes every {seconds} s", { count: open.length, seconds: POLL_MS / 1000 })}
            className="security-card security-alerts"
            bodyClassName="security-card-body"
          >
            <ErrorBox error={insights.error} title={t("Couldn't load alerts")} className="mb-3" onRetry={() => void insights.reload()} />
            {insights.loading && !insights.data ? (
              <Loading label={t("Loading alerts…")} />
            ) : alerts.length === 0 ? (
              <EmptyState>{t("No security alerts. The monitor flags suspicious activity here as soon as it sees it.")}</EmptyState>
            ) : (
              <ul className="monitoring-list is-single" aria-label={t("Security alerts")}>
                {alerts.map((i) => (
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

          <AssistantMonitor chat={chat} className="security-card security-monitor" bodyClassName="security-card-body" />
        </div>

        <Card
          title={t("Security events")}
          subtitle={t("Refused requests, holds, recipient and control changes from your audit log, newest first")}
          className="security-card security-events"
          bodyClassName="security-card-body"
        >
          <ErrorBox error={audit.error} title={t("Couldn't load audit log")} className="mb-3" />
          {audit.loading && !audit.data ? (
            <Loading />
          ) : timeline.length > 0 ? (
            <AuditList events={timeline} variant="table" />
          ) : audit.error ? null : (
            <EmptyState>{t("No security events yet.")}</EmptyState>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value, tone = "text-zinc-50", detail }: {
  label: string;
  value: string | number;
  tone?: string;
  detail?: ReactNode;
}) {
  return (
    <section className="security-stat glass min-w-0 !rounded-[24px] px-5 py-4">
      <p className="text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${tone}`}>{value}</p>
      {detail && <p className="mt-1 truncate text-xs text-white/45">{detail}</p>}
    </section>
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
  const actionIds = i.evidence.actionIds ?? [];

  async function confirmPause() {
    setPausing(true);
    await onPause();
    setPausing(false);
    setConfirming(false);
  }

  return (
    <InsightCard
      insight={i}
      agentName={i.agentId === "threat_monitor" ? t("Threat monitor") : t("Security sentinel")}
      meta={formatDateTime(i.updatedAt)}
      tags={<Badge tone="violet">{signalLabel(i, t)}</Badge>}
      evidenceCount={cited.length + actionIds.length}
      evidence={
        <>
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
        </>
      }
      actions={
        <>
          {i.severity === "critical" && !paused && (
            confirming ? (
              <>
                <span className="text-xs text-red-200">{t("Pause all transfer execution, including approved ones?")}</span>
                <Button size="sm" variant="danger" busy={pausing} onClick={() => void confirmPause()}>
                  {t("Yes, pause transfers")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("Cancel")}</Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                <ShieldWarning size={14} weight="fill" aria-hidden />
                {t("Pause transfers")}
              </Button>
            )
          )}
          {i.severity === "critical" && paused && <Badge tone="red">{t("Transfers paused")}</Badge>}
          {i.status === "new" && (
            <Button size="sm" disabled={disabled} busy={busy} onClick={() => onMark("seen")}>
              {t("Mark seen")}
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onMark("dismissed")} aria-label={t("Dismiss: {title}", { title: i.title })}>
            {t("Dismiss")}
          </Button>
        </>
      }
    />
  );
}
