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
  type ControlsResponse,
} from "../components/api";
import { AuditList } from "../components/AuditList";
import { Badge, SyntheticLabel } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatDateTime } from "../components/format";
import { SEVERITY } from "../components/MonitoringPanel";
import { useApiData } from "../components/useApiData";

const SECURITY_AGENTS = new Set(["threat_monitor", "security_sentinel"]);
const POLL_MS = 10_000;
const SEVERITY_RANK: Record<AgentInsight["severity"], number> = { critical: 2, warning: 1, info: 0 };
const AUDIT_LIMIT = 500;

/** Audit events worth showing on the security timeline. */
const SECURITY_EVENT = /^(request\.refused|action\.(execute_refused|execute_duplicate|approval_invalidated|held|failed)|order\.(execute_refused|execute_duplicate|approval_invalidated|failed)|recipient\.(changed|verified)|controls\.|trading_controls\.|mandate\.|assistant\.untrusted_instructions|agent\.(scope_violation|job_dead))/;

const SIGNAL_LABEL: Record<string, string> = {
  CROSS_USER_PROBE: "Cross-user probe",
  UNAPPROVED_EXECUTION: "Unapproved execution",
  STALE_APPROVAL_REPLAY: "Stale approval",
  RECIPIENT_SWAP: "Recipient swap",
  REPLAY_EXECUTION: "Replay",
  LIMIT_PROBING: "Limit probing",
  CONTROLS_LOOSENED_THEN_SPEND: "Controls loosened",
  PROMPT_INJECTION: "Prompt injection",
  ASSISTANT_PRIVILEGE_ATTEMPT: "Privilege attempt",
  EXECUTION_FAILURE: "Failure",
  TRANSFER_VELOCITY: "Velocity",
};

function signalLabel(i: AgentInsight): string {
  if (typeof i.evidence.signal === "string") return SIGNAL_LABEL[i.evidence.signal] ?? i.evidence.signal;
  return i.agentId === "security_sentinel" ? "Transfer review" : i.type;
}

export function SecurityClient() {
  const insights = useApiData<AgentInsightsResponse>(`${paths.agentInsights}?limit=200`);
  const audit = useApiData<AuditResponse>(paths.audit({ limit: AUDIT_LIMIT }));
  const agents = useApiData<AgentsResponse>(paths.agents);
  const controls = useApiData<ControlsResponse>(paths.controls);

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
    }, POLL_MS);
    return () => clearInterval(id);
  }, [insights.reload, audit.reload, agents.reload]);

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
      await Promise.all([insights.reload(), audit.reload(), agents.reload()]);
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
    <div className="space-y-6">
      <PageHeader
        title="Security"
        description="A background threat monitor watches your audit log for attack patterns and flags them here. It can only raise alerts: it can't pause, approve or move money."
        action={
          <Button onClick={() => void runSweep()} busy={running}>
            Run sweep now
          </Button>
        }
      />

      <p className="flex flex-wrap items-center gap-2 text-[13px] text-white/55">
        <SyntheticLabel />
        <ShieldCheck size={16} weight="fill" aria-hidden />
        Rule-based monitoring of synthetic activity. Advisory only; it doesn&apos;t block transfers, and it isn&apos;t a
        guarantee that every attack is detected.
      </p>

      <ErrorBox error={error} onDismiss={() => setError(null)} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat label="Critical" value={count("critical")} tone="text-red-300" />
        <Stat label="Warnings" value={count("warning")} tone="text-amber-200" />
        <Stat
          label="Last sweep"
          value={lastSweep ? formatDateTime(lastSweep.finishedAt ?? lastSweep.startedAt) : "Not yet"}
          detail={lastSweep?.summary ?? "Sweeps run shortly after new activity while the worker is running."}
        />
        <Stat
          label="Transfers"
          value={controls.data ? (paused ? "Paused" : "Active") : "—"}
          tone={paused ? "text-red-300" : "text-green-300"}
          detail={<Link href="/control" className="underline underline-offset-2">Manage controls</Link>}
        />
      </div>

      <Card
        title="Alerts"
        subtitle={`${open.length} open · refreshes every ${POLL_MS / 1000} s`}
      >
        <ErrorBox error={insights.error} title="Couldn't load alerts" className="mb-3" onRetry={() => void insights.reload()} />
        {insights.loading && !insights.data ? (
          <Loading label="Loading alerts…" />
        ) : alerts.length === 0 ? (
          <EmptyState>No security alerts. The monitor flags suspicious activity here as soon as it sees it.</EmptyState>
        ) : (
          <ul className="grid gap-3" aria-label="Security alerts">
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

      <Card
        title="Security events"
        subtitle="Refused requests, holds, recipient and control changes from your audit log, newest first"
      >
        <ErrorBox error={audit.error} title="Couldn't load audit log" className="mb-3" />
        {audit.loading && !audit.data ? (
          <Loading />
        ) : timeline.length > 0 ? (
          <AuditList events={timeline} variant="table" />
        ) : audit.error ? null : (
          <EmptyState>No security events yet.</EmptyState>
        )}
      </Card>
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
    <section className="glass min-w-0 !rounded-[24px] px-5 py-4">
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
  const sev = SEVERITY[i.severity] ?? SEVERITY.info;
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
    <li className={`monitoring-item sev-${i.severity}`}>
      <article aria-labelledby={`alert-${i.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone}>
            <sev.Icon size={13} weight="fill" aria-hidden />
            {sev.label}
          </Badge>
          <Badge tone="violet">{signalLabel(i)}</Badge>
          {i.status === "new" ? <Badge tone="brand">New</Badge> : <Badge tone="gray">Seen</Badge>}
          <span className="text-xs text-white/40">
            {i.agentId === "threat_monitor" ? "Threat monitor" : "Security sentinel"} · {formatDateTime(i.updatedAt)}
          </span>
        </div>
        <h3 id={`alert-${i.id}`} className="monitoring-title">{i.title}</h3>
        <p className="monitoring-body whitespace-pre-line">{i.body}</p>

        {(cited.length > 0 || actionIds.length > 0) && (
          <details className="monitoring-evidence">
            <summary>Evidence ({cited.length + actionIds.length})</summary>
            {actionIds.length > 0 && (
              <ul>
                {actionIds.map((id) => (
                  <li key={id}>
                    <Link href={`/transfers?id=${encodeURIComponent(id)}`}>Transfer {id}</Link>
                  </li>
                ))}
              </ul>
            )}
            {cited.length > 0 && <AuditList events={cited} showActionLink={false} />}
          </details>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {i.severity === "critical" && !paused && (
            confirming ? (
              <>
                <span className="text-xs text-red-200">Pause all transfer execution, including approved ones?</span>
                <Button size="sm" variant="danger" busy={pausing} onClick={() => void confirmPause()}>
                  Yes, pause transfers
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
              </>
            ) : (
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                <ShieldWarning size={14} weight="fill" aria-hidden />
                Pause transfers
              </Button>
            )
          )}
          {i.severity === "critical" && paused && <Badge tone="red">Transfers paused</Badge>}
          {i.status === "new" && (
            <Button size="sm" disabled={disabled} busy={busy} onClick={() => onMark("seen")}>
              Mark seen
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onMark("dismissed")} aria-label={`Dismiss: ${i.title}`}>
            Dismiss
          </Button>
        </div>
      </article>
    </li>
  );
}
