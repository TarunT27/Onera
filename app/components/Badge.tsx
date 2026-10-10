import type { ReactNode } from "react";
import type { AccountCapability, ActionCreator, ActionState, HoldReason, RecipientStatus } from "@/lib/types";

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
  PROPOSED: { tone: "gray", label: "Proposed" },
  HELD: { tone: "red", label: "Held" },
  AWAITING_APPROVAL: { tone: "blue", label: "Awaiting approval" },
  APPROVED: { tone: "indigo", label: "Approved" },
  EXECUTED: { tone: "green", label: "Executed" },
  FAILED: { tone: "red", label: "Failed" },
};

export function ActionStateBadge({ state }: { state: ActionState }) {
  const meta = STATE_META[state] ?? { tone: "gray" as const, label: state };
  return (
    <Badge tone={meta.tone} title={state}>
      {state === "HELD" && <span aria-hidden>⏸</span>}
      {meta.label}
    </Badge>
  );
}

const RECIPIENT_META: Record<RecipientStatus, { tone: BadgeTone; label: string }> = {
  verified: { tone: "green", label: "Verified" },
  changed: { tone: "red", label: "Changed" },
  unverified: { tone: "amber", label: "Unverified" },
};

export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  const meta = RECIPIENT_META[status] ?? { tone: "gray" as const, label: status };
  return (
    <Badge tone={meta.tone} title={`Recipient status: ${status}`}>
      {status === "verified" ? "✓" : "!"} {meta.label}
    </Badge>
  );
}

export function CreatorBadge({ createdBy }: { createdBy: ActionCreator }) {
  return createdBy === "assistant" ? (
    <Badge tone="violet" title="Proposed by the ClearFi assistant">
      Assistant
    </Badge>
  ) : (
    <Badge tone="gray" title="Created by you">
      You
    </Badge>
  );
}

export const HOLD_REASON_LABELS: Record<HoldReason, string> = {
  RECIPIENT_CHANGED: "Recipient details changed",
  RECIPIENT_UNVERIFIED: "Recipient not verified",
  LIMIT_EXCEEDED: "Over per-transfer limit",
  DAILY_LIMIT_EXCEEDED: "Over daily limit",
  INSUFFICIENT_FUNDS: "Insufficient funds",
  PAUSED: "Execution paused",
};

export function HoldReasonChip({ reason }: { reason: HoldReason }) {
  return (
    <Badge tone="amber" title={reason}>
      {HOLD_REASON_LABELS[reason] ?? reason}
    </Badge>
  );
}

export function CapabilityChips({ capabilities }: { capabilities: AccountCapability[] }) {
  const transfer = capabilities.filter((c) => c !== "view");
  if (transfer.length === 0) return <Badge tone="gray">View only</Badge>;
  return (
    <>
      {transfer.includes("transfer_source") && <Badge tone="brand">Transfer source</Badge>}
      {transfer.includes("transfer_destination") && <Badge tone="brand">Transfer destination</Badge>}
    </>
  );
}

export function SyntheticLabel({ className = "" }: { className?: string }) {
  return (
    <Badge tone="gray" title="Synthetic demo data — not a real account" className={className}>
      Synthetic
    </Badge>
  );
}
