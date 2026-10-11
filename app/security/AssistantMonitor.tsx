"use client";

/**
 * Assistant security monitor: the background chat monitor's health and this
 * user's findings. The monitor explains what the inline gates did and flags
 * patterns over time; prevention happens inline, before a reply or tool runs.
 */
import Link from "next/link";
import type { ChatSecurityEvent } from "@/lib/chatguard";
import { type ChatSecurityFinding, type ChatSecurityResponse, type MonitorStatus } from "../components/api";
import { Badge, type BadgeTone } from "../components/Badge";
import { Card, EmptyState, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatDateTime, formatTime } from "../components/format";
import { SEVERITY } from "../components/InsightCard";
import type { ApiData } from "../components/useApiData";

const HEALTH: Record<MonitorStatus["health"], { tone: BadgeTone; dot: string }> = {
  active: { tone: "green", dot: "bg-emerald-300" },
  lagging: { tone: "amber", dot: "bg-amber-300" },
  degraded: { tone: "red", dot: "bg-red-300" },
  not_running: { tone: "gray", dot: "bg-white/40" },
};

const STATUS_LABEL: Record<ChatSecurityFinding["status"], { label: string; tone: BadgeTone }> = {
  confirmed_policy_violation: { label: "Confirmed by server check", tone: "red" },
  suspected: { label: "Suspected", tone: "amber" },
  needs_review: { label: "Needs review", tone: "blue" },
};

const ENFORCEMENT: Record<ChatSecurityFinding["enforcement"], string> = {
  blocked_before_release: "Blocked before release",
  blocked_before_tool: "Blocked before the tool ran",
  observed_after_event: "Observed after the event",
  not_observed: "No enforcement observed",
};

/** The status line in plain words, with times in the viewer's zone. Never "all clear" while events are pending. */
export function monitorLabel(s: MonitorStatus): string {
  const last = s.lastCompletedAt ? formatTime(s.lastCompletedAt) : "never";
  switch (s.health) {
    case "active":
      return `Background monitoring active — checked at ${last}, ${s.pendingEvents} event${s.pendingEvents === 1 ? "" : "s"} pending`;
    case "lagging":
      return `Background monitoring lagging — ${s.pendingEvents} events pending, oldest ${s.lagSeconds ?? "?"}s ago`;
    case "degraded":
      return s.reviewer.lastError && s.heartbeatAt && Date.now() - Date.parse(s.heartbeatAt) < s.staleAfterSeconds * 1000
        ? `Monitoring degraded — AI reviewer unavailable; fixed rules last checked at ${last}`
        : `Monitoring degraded — last completed check ${last}`;
    case "not_running":
      return "Monitoring not running — start the app server or npm run worker";
  }
}

export function AssistantMonitor({ chat }: { chat: ApiData<ChatSecurityResponse> }) {
  const s = chat.data?.status;
  const findings = chat.data?.findings ?? [];
  const events = chat.data?.events ?? [];

  return (
    <Card
      title="Assistant security monitor"
      subtitle="A background worker reviews every chat turn for unsafe instructions, blocked tool use and unsupported claims"
    >
      <ErrorBox error={chat.error} title="Couldn't load the assistant monitor" className="mb-3" onRetry={() => void chat.reload()} />
      {!chat.data ? (
        <Loading label="Loading monitor status…" />
      ) : (
        <div className="space-y-4">
          {s && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white/[0.04] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
              <span className={`inline-block size-2 rounded-full ${HEALTH[s.health].dot}`} aria-hidden />
              <span className="text-sm font-medium text-zinc-50">{monitorLabel(s)}</span>
              <span className="text-xs text-white/45">
                {s.failedEvents > 0 && `${s.failedEvents} event${s.failedEvents === 1 ? "" : "s"} couldn't be processed (kept for review) · `}
                AI reviewer {s.reviewer.enabled ? `on (${s.reviewer.calls} call${s.reviewer.calls === 1 ? "" : "s"})` : "off"} ·
                polls every {s.pollSeconds}s
              </span>
            </div>
          )}

          {findings.length === 0 ? (
            <EmptyState>
              No assistant security findings{s && s.pendingEvents > 0 ? " yet — some events are still pending review" : ""}. Findings
              show coverage, not a guarantee the chatbot is secure.
            </EmptyState>
          ) : (
            <ul className="grid gap-3" aria-label="Assistant security findings">
              {findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </ul>
          )}

          {events.length > 0 && (
            <details className="monitoring-evidence">
              <summary>Recent assistant security events ({events.length})</summary>
              <ul>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
            </details>
          )}

          {s && (
            <details className="monitoring-evidence">
              <summary>Limitations</summary>
              <ul>
                {s.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Card>
  );
}

function FindingCard({ finding: f }: { finding: ChatSecurityFinding }) {
  const sev = SEVERITY[f.severity] ?? SEVERITY.info;
  const status = STATUS_LABEL[f.status];
  const actionIds = f.evidenceIds.filter((id) => id.startsWith("act_"));
  return (
    <li className={`monitoring-item sev-${f.severity}`}>
      <article aria-labelledby={`finding-${f.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone}>
            <sev.Icon size={13} weight="fill" aria-hidden />
            {sev.label}
          </Badge>
          <Badge tone={status.tone}>{status.label}</Badge>
          <Badge tone="gray">{ENFORCEMENT[f.enforcement]}</Badge>
          <Badge tone={f.method === "ai_review" ? "violet" : "gray"}>{f.method === "ai_review" ? "AI review" : "Fixed rule"}</Badge>
          {f.occurrences > 1 && <Badge tone="gray">×{f.occurrences}</Badge>}
          <span className="text-xs text-white/40">
            {f.firstSeenAt === f.lastSeenAt ? formatDateTime(f.lastSeenAt) : `${formatDateTime(f.firstSeenAt)} – ${formatDateTime(f.lastSeenAt)}`}
          </span>
        </div>
        <h3 id={`finding-${f.id}`} className="monitoring-title">{f.title}</h3>
        <p className="monitoring-body">{f.signal}</p>
        <p className="monitoring-body">{f.explanation}</p>
        {(actionIds.length > 0 || f.evidenceIds.length > 0) && (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/50">
            Evidence:
            {f.evidenceIds.map((id) =>
              id.startsWith("act_") ? (
                <Link key={id} href={`/transfers?id=${encodeURIComponent(id)}`} className="text-brand-300 underline underline-offset-2">
                  {id}
                </Link>
              ) : (
                <code key={id} className="font-mono">{id}</code>
              ),
            )}
          </p>
        )}
      </article>
    </li>
  );
}

function EventRow({ event: e }: { event: ChatSecurityEvent }) {
  const tone = e.outcome === "deny" ? "text-red-200" : e.outcome === "observe" ? "text-amber-200" : "text-white/60";
  return (
    <li>
      <span className="min-w-0">
        <span className="font-mono text-[11px] text-white/40">{formatTime(e.createdAt)}</span>{" "}
        <span className="text-zinc-100">{e.stage.replace("_", " ")}</span>
        {e.tool && <code className="ml-1 font-mono text-[11px]">{e.tool}</code>}
        {e.reasons.length > 0 && <span className="ml-1 text-white/45">{e.reasons.join(", ")}</span>}
      </span>
      <span className={`shrink-0 text-xs font-medium ${tone}`}>{e.outcome}</span>
    </li>
  );
}
