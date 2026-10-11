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
import { useI18n, useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import { identityT, type Translate } from "@/lib/i18n/translate";
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
  confirmed_policy_violation: { label: msg("Confirmed by server check"), tone: "red" },
  suspected: { label: msg("Suspected"), tone: "amber" },
  needs_review: { label: msg("Needs review"), tone: "blue" },
};

const ENFORCEMENT: Record<ChatSecurityFinding["enforcement"], string> = {
  blocked_before_release: msg("Blocked before release"),
  blocked_before_tool: msg("Blocked before the tool ran"),
  observed_after_event: msg("Observed after the event"),
  not_observed: msg("No enforcement observed"),
};

/** The status line in plain words, with times in the viewer's zone. Never "all clear" while events are pending. */
export function monitorLabel(s: MonitorStatus, t: Translate = identityT): string {
  const last = s.lastCompletedAt ? formatTime(s.lastCompletedAt) : t("never");
  switch (s.health) {
    case "active":
      return s.pendingEvents === 1
        ? t("Background monitoring active — checked at {time}, {count} event pending", { time: last, count: s.pendingEvents })
        : t("Background monitoring active — checked at {time}, {count} events pending", { time: last, count: s.pendingEvents });
    case "lagging":
      return t("Background monitoring lagging — {count} events pending, oldest {seconds}s ago", {
        count: s.pendingEvents,
        seconds: s.lagSeconds ?? "?",
      });
    case "degraded":
      return s.reviewer.lastError && s.heartbeatAt && Date.now() - Date.parse(s.heartbeatAt) < s.staleAfterSeconds * 1000
        ? t("Monitoring degraded — AI reviewer unavailable; fixed rules last checked at {time}", { time: last })
        : t("Monitoring degraded — last completed check {time}", { time: last });
    case "not_running":
      return t("Monitoring not running — start the app server or npm run worker");
  }
}

export function AssistantMonitor({ chat, className, bodyClassName }: {
  chat: ApiData<ChatSecurityResponse>;
  className?: string;
  bodyClassName?: string;
}) {
  const { t, tp } = useI18n();
  const s = chat.data?.status;
  const findings = chat.data?.findings ?? [];
  const events = chat.data?.events ?? [];

  return (
    <Card
      title={t("Assistant security monitor")}
      subtitle={t("A background worker reviews every chat turn for unsafe instructions, blocked tool use and unsupported claims")}
      className={className}
      bodyClassName={bodyClassName}
    >
      <ErrorBox error={chat.error} title={t("Couldn't load the assistant monitor")} className="mb-3" onRetry={() => void chat.reload()} />
      {!chat.data ? (
        <Loading label={t("Loading monitor status…")} />
      ) : (
        <div className="space-y-4">
          {s && (
            <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl bg-white/[0.04] px-4 py-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.07)]">
              <span className={`inline-block size-2 rounded-full ${HEALTH[s.health].dot}`} aria-hidden />
              <span className="text-sm font-medium text-zinc-50">{monitorLabel(s, t)}</span>
              <span className="text-xs text-white/45">
                {s.failedEvents > 0 &&
                  `${tp(s.failedEvents, "{n} event couldn't be processed (kept for review)", "{n} events couldn't be processed (kept for review)")} · `}
                {s.reviewer.enabled ? tp(s.reviewer.calls, "AI reviewer on ({n} call)", "AI reviewer on ({n} calls)") : t("AI reviewer off")} ·{" "}
                {t("polls every {seconds}s", { seconds: s.pollSeconds })}
              </span>
            </div>
          )}

          {findings.length === 0 ? (
            <EmptyState>
              {s && s.pendingEvents > 0
                ? t("No assistant security findings yet — some events are still pending review.")
                : t("No assistant security findings.")}{" "}
              {t("Findings show coverage, not a guarantee the chatbot is secure.")}
            </EmptyState>
          ) : (
            <ul className="grid gap-3" aria-label={t("Assistant security findings")}>
              {findings.map((f) => (
                <FindingCard key={f.id} finding={f} />
              ))}
            </ul>
          )}

          {events.length > 0 && (
            <details className="monitoring-evidence">
              <summary>{t("Recent assistant security events ({count})", { count: events.length })}</summary>
              <ul>
                {events.map((e) => (
                  <EventRow key={e.id} event={e} />
                ))}
              </ul>
            </details>
          )}

          {s && (
            <details className="monitoring-evidence">
              <summary>{t("Limitations")}</summary>
              <ul>
                {s.limitations.map((l) => (
                  <li key={l}>{t(l)}</li>
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
  const t = useT();
  const sev = SEVERITY[f.severity] ?? SEVERITY.info;
  const status = STATUS_LABEL[f.status];
  const actionIds = f.evidenceIds.filter((id) => id.startsWith("act_"));
  return (
    <li className={`monitoring-item sev-${f.severity}`}>
      <article aria-labelledby={`finding-${f.id}`}>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={sev.tone}>
            <sev.Icon size={13} weight="fill" aria-hidden />
            {t(sev.label)}
          </Badge>
          <Badge tone={status.tone}>{t(status.label)}</Badge>
          <Badge tone="gray">{t(ENFORCEMENT[f.enforcement])}</Badge>
          <Badge tone={f.method === "ai_review" ? "violet" : "gray"}>{f.method === "ai_review" ? t("AI review") : t("Fixed rule")}</Badge>
          {f.occurrences > 1 && <Badge tone="gray">×{f.occurrences}</Badge>}
          <span className="text-xs text-white/40">
            {f.firstSeenAt === f.lastSeenAt ? formatDateTime(f.lastSeenAt) : `${formatDateTime(f.firstSeenAt)} – ${formatDateTime(f.lastSeenAt)}`}
          </span>
        </div>
        <h3 id={`finding-${f.id}`} className="monitoring-title">{t(f.title)}</h3>
        <p className="monitoring-body">{t(f.signal)}</p>
        <p className="monitoring-body">{t(f.explanation)}</p>
        {(actionIds.length > 0 || f.evidenceIds.length > 0) && (
          <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/50">
            {t("Evidence:")}
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
  const t = useT();
  const tone = e.outcome === "deny" ? "text-red-200" : e.outcome === "observe" ? "text-amber-200" : "text-white/60";
  return (
    <li>
      <span className="min-w-0">
        <span className="font-mono text-[11px] text-white/40">{formatTime(e.createdAt)}</span>{" "}
        <span className="text-zinc-100">{e.stage.replace("_", " ")}</span>
        {e.tool && <code className="ml-1 font-mono text-[11px]">{e.tool}</code>}
        {e.reasons.length > 0 && <span className="ml-1 text-white/45">{e.reasons.map((r) => t(r)).join(", ")}</span>}
      </span>
      <span className={`shrink-0 text-xs font-medium ${tone}`}>{e.outcome}</span>
    </li>
  );
}
