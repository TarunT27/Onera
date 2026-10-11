/**
 * User-facing copy for every hold reason: one place for governance wording.
 * Pure data — safe to import from UI code. Edit wording here, not in components.
 */
import type { HoldReason } from "@/lib/types";
import { msg } from "@/lib/i18n/msg";

export interface HoldMessage {
  /** Short chip label. */
  label: string;
  /** Why Onera held the transfer. */
  explanation: string;
  /** What the user can do next. */
  recovery: string;
}

export const HOLD_MESSAGES: Record<HoldReason, HoldMessage> = {
  RECIPIENT_CHANGED: {
    label: msg("Recipient details changed"),
    explanation: msg("The destination's bank details differ from the version you last verified."),
    recovery: msg("Confirm the new details through a channel you already trust and verify the recipient. Then re-evaluate — or, if the details changed after you created this transfer, edit it to re-select the recipient."),
  },
  RECIPIENT_UNVERIFIED: {
    label: msg("Recipient not verified"),
    explanation: msg("This recipient has never been verified."),
    recovery: msg("Verify the recipient out of band, then re-evaluate."),
  },
  LIMIT_EXCEEDED: {
    label: msg("Over per-transfer limit"),
    explanation: msg("The amount is above your per-transfer limit."),
    recovery: msg("Reduce the amount, or deliberately raise the limit in Control, then re-evaluate."),
  },
  DAILY_LIMIT_EXCEEDED: {
    label: msg("Over daily limit"),
    explanation: msg("This transfer would take today's total above your daily limit."),
    recovery: msg("Wait until tomorrow, reduce the amount, or deliberately raise the daily limit, then re-evaluate."),
  },
  INSUFFICIENT_FUNDS: {
    label: msg("Insufficient funds"),
    explanation: msg("The source account's available balance is lower than the amount."),
    recovery: msg("Choose another source account or reduce the amount."),
  },
  PAUSED: {
    label: msg("Execution paused"),
    explanation: msg("You paused all execution in Control."),
    recovery: msg("Resume execution in Control; checks run again before anything moves."),
  },
};

export function holdMessage(reason: HoldReason): HoldMessage {
  return HOLD_MESSAGES[reason];
}
