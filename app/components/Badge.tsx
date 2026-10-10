import type { ReactNode } from "react";
import type { AccountCapability, ActionCreator, ActionState, HoldReason, RecipientStatus } from "@/lib/types";

export type BadgeTone = "gray" | "red" | "amber" | "blue" | "indigo" | "green" | "brand" | "violet";

const TONES: Record<BadgeTone, string> = {
  gray: "bg-zinc-100 text-zinc-700 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700",
  red: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-950/60 dark:text-red-300 dark:ring-red-900",
  amber: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-900",
  blue: "bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-900",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:ring-indigo-900",
  green: "bg-green-50 text-green-700 ring-green-200 dark:bg-green-950/60 dark:text-green-300 dark:ring-green-900",
  brand: "bg-brand-50 text-brand-800 ring-brand-200 dark:bg-brand-950/60 dark:text-brand-300 dark:ring-brand-900",
  violet: "bg-violet-50 text-violet-700 ring-violet-200 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-900",
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
      className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]} ${className}`}
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
