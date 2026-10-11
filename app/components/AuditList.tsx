"use client";

import Link from "next/link";
import type { AuditEvent } from "@/lib/types";
import { Badge, type BadgeTone } from "./Badge";
import { msg } from "@/lib/i18n/msg";
import { compactJson, formatDateTime } from "./format";
import { useT } from "./I18nContext";

export function actorMeta(actor: string): { label: string; tone: BadgeTone } {
  if (actor.startsWith("user:")) return { label: msg("You"), tone: "brand" };
  if (actor === "assistant") return { label: msg("Assistant"), tone: "violet" };
  if (actor === "system") return { label: msg("System"), tone: "gray" };
  return { label: actor, tone: "gray" };
}

/** Audit event types the server writes. Unknown types fall back to a readable form of the type. */
const EVENT_LABEL: Record<string, string> = {
  "action.approval_invalidated": msg("Action approval invalidated"),
  "action.approved": msg("Action approved"),
  "action.awaiting_approval": msg("Action awaiting approval"),
  "action.edited": msg("Action edited"),
  "action.execute_duplicate": msg("Action execute duplicate"),
  "action.execute_refused": msg("Action execute refused"),
  "action.executed": msg("Action executed"),
  "action.failed": msg("Action failed"),
  "action.held": msg("Action held"),
  "action.proposed": msg("Action proposed"),
  "agent.job_dead": msg("Agent job dead"),
  "agent.run_failed": msg("Agent run failed"),
  "agent.run_succeeded": msg("Agent run succeeded"),
  "agent.scope_violation": msg("Agent scope violation"),
  "assistant.prompt": msg("Assistant prompt"),
  "assistant.reply": msg("Assistant reply"),
  "assistant.tool_call": msg("Assistant tool call"),
  "assistant.untrusted_instructions": msg("Assistant untrusted instructions"),
  "connection.disconnected": msg("Connection disconnected"),
  "connection.linked": msg("Connection linked"),
  "connection.reconnected": msg("Connection reconnected"),
  "connection.relinked": msg("Connection relinked"),
  "connection.status_simulated": msg("Connection status simulated"),
  "connection.sync_blocked": msg("Connection sync blocked"),
  "connection.synced": msg("Connection synced"),
  "controls.paused": msg("Controls paused"),
  "controls.resumed": msg("Controls resumed"),
  "controls.updated": msg("Controls updated"),
  "demo.seeded": msg("Demo seeded"),
  "family.card_frozen": msg("Family card frozen"),
  "family.card_unfrozen": msg("Family card unfrozen"),
  "family.card_updated": msg("Family card updated"),
  "family.charge_approved": msg("Family charge approved"),
  "family.charge_declined": msg("Family charge declined"),
  "mandate.created": msg("Mandate created"),
  "mandate.revoked": msg("Mandate revoked"),
  "order.approval_invalidated": msg("Order approval invalidated"),
  "order.approved": msg("Order approved"),
  "order.awaiting_approval": msg("Order awaiting approval"),
  "order.edited": msg("Order edited"),
  "order.execute_duplicate": msg("Order execute duplicate"),
  "order.execute_refused": msg("Order execute refused"),
  "order.executed": msg("Order executed"),
  "order.failed": msg("Order failed"),
  "order.held": msg("Order held"),
  "order.mandate_authorized": msg("Order mandate authorized"),
  "order.proposed": msg("Order proposed"),
  "order.repriced": msg("Order repriced"),
  "recipient.changed": msg("Recipient changed"),
  "recipient.verified": msg("Recipient verified"),
  "request.refused": msg("Request refused"),
  "trading_controls.updated": msg("Trading controls updated"),
};

function eventTone(eventType: string): string {
  const t = eventType.toLowerCase();
  if (/(refus|reject|denied|fail|block|held|hold|stale|invalid)/.test(t))
    return "text-red-700 dark:text-red-400";
  if (/(execut|receipt)/.test(t)) return "text-green-700 dark:text-green-400";
  if (/approv/.test(t)) return "text-indigo-700 dark:text-indigo-400";
  if (/(verif)/.test(t)) return "text-brand-700 dark:text-brand-400";
  return "text-zinc-800 dark:text-zinc-200";
}

/**
 * Audit events. `table` lays out as columns on md+ (and stacks on phones);
 * `list` always stacks (for narrow side panels).
 */
export function AuditList({
  events,
  variant = "list",
  showActionLink = true,
}: {
  events: AuditEvent[];
  variant?: "list" | "table";
  showActionLink?: boolean;
}) {
  const t = useT();
  const table = variant === "table";
  const cols =
    "xl:grid xl:grid-cols-[9.5rem_6.5rem_minmax(0,13rem)_8.5rem_minmax(0,1fr)] xl:items-baseline xl:gap-x-4";

  return (
    <div className="min-w-0 text-sm">
      {table && (
        <div
          className={`hidden border-b border-zinc-200 pb-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:border-zinc-800 dark:text-zinc-400 ${cols}`}
        >
          <span>{t("Time")}</span>
          <span>{t("Actor")}</span>
          <span>{t("Event")}</span>
          <span>{t("Action")}</span>
          <span>{t("Detail")}</span>
        </div>
      )}
      <ol className="divide-y divide-zinc-100 dark:divide-zinc-800">
        {events.map((e) => {
          const actor = actorMeta(e.actor);
          const detail = compactJson(e.detail, 4000);
          const eventLabel =
            EVENT_LABEL[e.eventType] ??
            e.eventType.replace(/[._]/g, " ").replace(/^./, (c) => c.toUpperCase());
          return (
            <li key={e.id} className={`min-w-0 py-2.5 ${table ? cols : ""}`}>
              {table ? (
                <>
                  <span className="hidden text-xs text-zinc-500 tabular-nums xl:block dark:text-zinc-400">
                    {formatDateTime(e.createdAt, { full: true })}
                  </span>
                  <span className="hidden xl:block">
                    <Badge tone={actor.tone} title={e.actor}>
                      {t(actor.label)}
                    </Badge>
                  </span>
                </>
              ) : null}
              <div
                className={`flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 ${table ? "xl:block" : ""}`}
              >
                <span
                  className={`text-sm font-medium ${eventTone(e.eventType)}`}
                >
                  {t(eventLabel)}
                </span>
                <span className={table ? "xl:hidden" : ""}>
                  <Badge tone={actor.tone} title={e.actor}>
                    {t(actor.label)}
                  </Badge>
                </span>
                <span
                  className={`text-xs text-zinc-500 tabular-nums dark:text-zinc-400 ${table ? "xl:hidden" : ""}`}
                >
                  {formatDateTime(e.createdAt, { full: true })}
                </span>
              </div>
              {(table || (showActionLink && e.actionId)) && (
                <div
                  className={`mt-1 min-w-0 text-xs ${table ? "xl:mt-0" : ""}`}
                >
                  {showActionLink && e.actionId ? (
                    <Link
                      href={`/transfers?id=${encodeURIComponent(e.actionId)}`}
                      className="font-mono break-all text-brand-700 hover:underline dark:text-brand-400"
                    >
                      {t("View transfer")}
                    </Link>
                  ) : (
                    <span className="hidden text-zinc-400 xl:inline">—</span>
                  )}
                </div>
              )}
              {detail ? (
                <details className="mt-1 text-xs text-zinc-400">
                  <summary className="min-h-9 py-2">{t("View event details")}</summary>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all py-2 font-mono text-[11px]">
                    {JSON.stringify(e.detail, null, 2)}
                  </pre>
                </details>
              ) : table ? (
                <span className="hidden text-xs text-zinc-400 xl:block">—</span>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
