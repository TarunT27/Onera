"use client";

/**
 * Overview card for the personal assistant: the latest background briefing's
 * headline, top tips and to-dos, linking to the full briefing. Read-only.
 */
import Link from "next/link";
import { ArrowRight, Sparkle } from "@phosphor-icons/react";
import { paths, type BriefingResponse } from "./api";
import { Badge } from "./Badge";
import { Loading } from "./Card";
import { ErrorBox } from "./ErrorBox";
import { formatCents, formatDateTime } from "./format";
import { SEVERITY } from "./MonitoringPanel";
import { useApiData } from "./useApiData";

export function AssistantPanel() {
  const { data, error, loading, reload } = useApiData<BriefingResponse>(paths.briefing);
  const b = data?.briefing ?? null;
  const top = (b?.tips ?? []).slice(0, 3);

  return (
    <section className="surface monitoring-panel" aria-labelledby="assistant-heading">
      <header className="surface-head monitoring-head">
        <div className="min-w-0">
          <h2 id="assistant-heading">Your personal assistant</h2>
          <p className="monitoring-advisory">
            <Sparkle size={17} weight="fill" aria-hidden />
            {b ? `Briefing prepared ${formatDateTime(b.generatedAt)} · works in the background` : "Works in the background"}
          </p>
        </div>
        <Link href="/briefing" className="pill small">
          Open briefing
          <span className="knob" aria-hidden>
            <ArrowRight size={16} weight="bold" />
          </span>
        </Link>
      </header>
      <div className="insight-body">
        <ErrorBox error={error} title="Couldn't load your briefing" onRetry={() => void reload()} />
        {loading && !data ? (
          <Loading label="Loading your briefing…" />
        ) : !b ? (
          <p className="monitoring-empty">
            Your assistant hasn&apos;t prepared a briefing yet. <Link href="/briefing">Prepare one now</Link>.
          </p>
        ) : (
          <>
            <p className="mb-4 text-[17px] font-medium leading-snug tracking-[-0.015em] text-zinc-50">{b.headline}</p>
            {top.length > 0 && (
              <ul className="monitoring-list" aria-label="Top tips">
                {top.map((t) => {
                  const sev = SEVERITY[t.severity] ?? SEVERITY.info;
                  return (
                    <li key={t.id} className={`monitoring-item sev-${t.severity}`}>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={sev.tone}>{sev.label}</Badge>
                        {t.annualSavingsCents !== null && t.annualSavingsCents > 0 && (
                          <Badge tone="green">Save ~{formatCents(t.annualSavingsCents, { whole: true })}/yr</Badge>
                        )}
                      </div>
                      <h3 className="monitoring-title">{t.title}</h3>
                    </li>
                  );
                })}
              </ul>
            )}
            {b.attention.length > 0 && (
              <p className="row-meta mt-4">
                {b.attention.length} item{b.attention.length === 1 ? "" : "s"} need your attention:{" "}
                {b.attention.slice(0, 2).map((a) => a.title).join("; ")}
                {b.attention.length > 2 ? "…" : ""}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
