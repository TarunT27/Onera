"use client";

/**
 * One monitoring finding, shown short: who raised it, the headline and a
 * one-to-two sentence summary. The rest of the body (advice, method and
 * advisory fine print) and the cited records sit behind "Details", so the
 * full text is always one click away. Advisory only — callers pass the
 * seen/dismiss buttons; the card itself has no actions.
 */
import { useId, useState, type ReactNode } from "react";
import { CaretDown, Info, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { AgentInsight } from "./api";
import { AgentAvatar } from "./AgentAvatar";
import { Badge, type BadgeTone } from "./Badge";
import { splitInsightBody } from "./insightText";

export const SEVERITY: Record<AgentInsight["severity"], { tone: BadgeTone; label: string; Icon: typeof Info }> = {
  critical: { tone: "red", label: "Critical", Icon: WarningOctagon },
  warning: { tone: "amber", label: "Warning", Icon: Warning },
  info: { tone: "blue", label: "Info", Icon: Info },
};

export function InsightCard({
  insight: i,
  agentName,
  meta,
  tags,
  evidence,
  evidenceCount = 0,
  actions,
}: {
  insight: AgentInsight;
  agentName: string;
  /** Extra text after the agent name, e.g. a timestamp. */
  meta?: ReactNode;
  /** Extra badges shown next to severity and status. */
  tags?: ReactNode;
  /** Cited records, shown inside Details. */
  evidence?: ReactNode;
  evidenceCount?: number;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const { lede, more } = splitInsightBody(i.body);
  const sev = SEVERITY[i.severity] ?? SEVERITY.info;
  const hasDetails = Boolean(more) || evidenceCount > 0;
  const isNew = i.status === "new";

  return (
    <li className={`insight-card sev-${i.severity}${isNew ? " is-new" : ""}`} data-open={open || undefined}>
      <article aria-labelledby={`insight-${i.id}`}>
        <div className="insight-card-top">
          <span className="insight-avatar">
            <AgentAvatar agentId={i.agentId} size={36} />
            {isNew && <span className="insight-new-dot" aria-hidden />}
          </span>
          <p className="insight-source">
            <span className="insight-agent">{agentName}</span>
            {meta && <span className="insight-when">{meta}</span>}
          </p>
          <div className="insight-tags">
            {i.severity !== "info" && (
              <Badge tone={sev.tone}>
                <sev.Icon size={12} weight="fill" aria-hidden />
                {sev.label}
              </Badge>
            )}
            {tags}
            <span className={isNew ? "insight-status is-new" : "insight-status"}>{isNew ? "New" : "Seen"}</span>
          </div>
        </div>

        <h3 id={`insight-${i.id}`} className="insight-title">
          {i.title}
        </h3>
        {lede && <p className="insight-lede">{lede}</p>}

        {open && (
          <div id={detailsId} className="insight-more">
            {more && <p className="insight-fine">{more}</p>}
            {evidenceCount > 0 && (
              <div className="insight-evidence">
                <p className="insight-evidence-head">Evidence · {evidenceCount}</p>
                {evidence}
              </div>
            )}
          </div>
        )}

        <div className="insight-foot">
          {hasDetails && (
            <button
              type="button"
              className="insight-toggle"
              aria-expanded={open}
              aria-controls={open ? detailsId : undefined}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? "Hide details" : "Details"}
              <CaretDown size={12} weight="bold" aria-hidden />
            </button>
          )}
          <div className="insight-actions">{actions}</div>
        </div>
      </article>
    </li>
  );
}
