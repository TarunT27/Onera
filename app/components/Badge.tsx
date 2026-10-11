"use client";

import type { ReactNode } from "react";
import type { AccountCapability, ActionCreator, ActionState, HoldReason, RecipientStatus } from "@/lib/types";
// Pure data module: the single source of governance wording for hold reasons.
import { HOLD_MESSAGES } from "@/lib/policy/messages";
import { msg } from "@/lib/i18n/msg";
import { identityT, type Translate } from "@/lib/i18n/translate";
import { useT } from "./I18nContext";

export type BadgeTone = "gray" | "red" | "amber" | "blue" | "indigo" | "green" | "brand" | "violet";

const TONES: Record<BadgeTone, string> = {
  gray: "bg-white/[0.08] text-white/70",
  red: "bg-red-400/15 text-red-200",
  amber: "bg-amber-300/15 text-amber-200",
  blue: "bg-sky-400/15 text-sky-200",
  indigo: "bg-indigo-400/15 text-indigo-200",
  green: "bg-emerald-400/15 text-emerald-200",
  brand: "bg-brand-400/15 text-brand-200",
  violet: "bg-violet-400/15 text-violet-200",
};

export function Badge({
  tone = "gray",
  children,
  title,
  className = "",
}: {
  tone?: BadgeTone;
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${TONES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

const STATE_META: Record<ActionState, { tone: BadgeTone; label: string }> = {
  PROPOSED: { tone: "gray", label: msg("Proposed") },
  HELD: { tone: "red", label: msg("Held") },
  AWAITING_APPROVAL: { tone: "amber", label: msg("Ready for approval") },
  APPROVED: { tone: "blue", label: msg("Approved") },
  EXECUTED: { tone: "green", label: msg("Executed") },
  FAILED: { tone: "red", label: msg("Failed") },
};

export function ActionStateBadge({ state }: { state: ActionState }) {
  const t = useT();
  const meta = STATE_META[state] ?? { tone: "gray" as const, label: state };
  return (
    <Badge tone={meta.tone} title={state}>
      {state === "HELD" && <span aria-hidden>⏸</span>}
      {t(meta.label)}
    </Badge>
  );
}

const RECIPIENT_META: Record<RecipientStatus, { tone: BadgeTone; label: string }> = {
  verified: { tone: "green", label: msg("Verified") },
  changed: { tone: "red", label: msg("Changed") },
  unverified: { tone: "amber", label: msg("Unverified") },
};

export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  const t = useT();
  const meta = RECIPIENT_META[status] ?? { tone: "gray" as const, label: status };
  return (
    <Badge tone={meta.tone} title={t("Recipient status: {status}", { status: t(meta.label) })}>
      {status === "verified" ? "✓" : "!"} {t(meta.label)}
    </Badge>
  );
}

export function CreatorBadge({ createdBy }: { createdBy: ActionCreator }) {
  const t = useT();
  return createdBy === "assistant" ? (
    <Badge tone="violet" title={t("Proposed by the Onera assistant")}>
      {t("Assistant")}
    </Badge>
  ) : (
    <Badge tone="gray" title={t("Created by you")}>
      {t("You")}
    </Badge>
  );
}

/** Short chip label for a hold reason (wording lives in lib/policy/messages). */
export function holdReasonLabel(reason: HoldReason, t: Translate = identityT): string {
  return t(HOLD_MESSAGES[reason]?.label ?? reason);
}

export function HoldReasonChip({ reason }: { reason: HoldReason }) {
  const t = useT();
  return (
    <Badge tone="amber" title={t(HOLD_MESSAGES[reason]?.explanation ?? reason)}>
      {holdReasonLabel(reason, t)}
    </Badge>
  );
}

/** Paper-trading accounts hold simulated money and never count toward net worth. */
export const PAPER_LABEL = msg("Paper · simulated money, not in net worth");

export function PaperLabel({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <span
      title={t("Paper trading account: simulated money, excluded from net worth")}
      className={`inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-[11.5px] font-medium ${TONES.violet} ${className}`}
    >
      {t(PAPER_LABEL)}
    </span>
  );
}

export function CapabilityChips({ capabilities }: { capabilities: AccountCapability[] }) {
  const t = useT();
  const transfer = capabilities.filter((c) => c !== "view");
  if (transfer.length === 0) return <Badge tone="gray">{t("View only")}</Badge>;
  return (
    <>
      {transfer.includes("transfer_source") && <Badge tone="brand">{t("Transfer source")}</Badge>}
      {transfer.includes("transfer_destination") && <Badge tone="brand">{t("Transfer destination")}</Badge>}
    </>
  );
}

export function SyntheticLabel({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <Badge tone="gray" title={t("Synthetic demo data — not a real account")} className={className}>
      {t("Synthetic")}
    </Badge>
  );
}
