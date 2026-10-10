/**
 * User-facing copy for every hold reason: one place for governance wording.
 * Pure data — safe to import from UI code. Edit wording here, not in components.
 */
import type { HoldReason } from "@/lib/types";

export interface HoldMessage {
  /** Short chip label. */
  label: string;
  /** Why ClearFi held the transfer. */
  explanation: string;
  /** What the user can do next. */
  recovery: string;
}

export const HOLD_MESSAGES: Record<HoldReason, HoldMessage> = {
  RECIPIENT_CHANGED: {
    label: "Recipient details changed",
    explanation: "The destination's bank details differ from the version you last verified.",
    recovery: "Confirm the new details through a channel you already trust, verify the recipient, then re-evaluate.",
  },
  RECIPIENT_UNVERIFIED: {
    label: "Recipient not verified",
    explanation: "This recipient has never been verified.",
    recovery: "Verify the recipient out of band, then re-evaluate.",
  },
  LIMIT_EXCEEDED: {
    label: "Over per-transfer limit",
    explanation: "The amount is above your per-transfer limit.",
    recovery: "Reduce the amount, or deliberately raise the limit in Control, then re-evaluate.",
  },
  DAILY_LIMIT_EXCEEDED: {
    label: "Over daily limit",
    explanation: "This transfer would take today's total above your daily limit.",
    recovery: "Wait until tomorrow, reduce the amount, or deliberately raise the daily limit, then re-evaluate.",
  },
  INSUFFICIENT_FUNDS: {
    label: "Insufficient funds",
    explanation: "The source account's available balance is lower than the amount.",
    recovery: "Choose another source account or reduce the amount.",
  },
  PAUSED: {
    label: "Execution paused",
    explanation: "You paused all execution in Control.",
    recovery: "Resume execution in Control; checks run again before anything moves.",
  },
};

export function holdMessage(reason: HoldReason): HoldMessage {
  return HOLD_MESSAGES[reason];
}
