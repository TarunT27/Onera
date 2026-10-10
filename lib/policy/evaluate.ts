/**
 * Deterministic governance checks. Pure function: same inputs, same decision.
 * AI output never feeds into this — only stored records and user controls.
 */
import type {
  Account,
  HoldReason,
  PolicyCheck,
  PolicyResult,
  Recipient,
  UserControls,
} from "@/lib/types";
import { formatCents } from "@/lib/finance/money";

export interface PolicyInput {
  amountCents: number;
  /** Recipient version captured on the proposal. */
  recipientVersion: number;
  source: Account;
  recipient: Recipient;
  controls: UserControls;
  executedTodayCents: number;
  now?: Date;
}

export function evaluatePolicy(input: PolicyInput): PolicyResult {
  const { amountCents, source, recipient, controls } = input;
  const checks: PolicyCheck[] = [];
  const add = (id: string, label: string, passed: boolean, detail: string, reason?: HoldReason) =>
    checks.push({ id, label, passed, detail, ...(passed ? {} : { reason }) });

  add("ownership", "Source and recipient belong to you", true,
    "Both records were loaded through your session; other users' records are not visible.");

  const verified = recipient.verifiedVersion === recipient.version;
  add(
    "recipient_verified",
    "Recipient details verified",
    verified,
    verified
      ? `Destination ${recipient.details.institution} ••${recipient.details.accountMask} was verified (v${recipient.version}).`
      : recipient.verifiedVersion === null
        ? "This recipient has never been verified."
        : `Destination changed to ${recipient.details.institution} ••${recipient.details.accountMask} (v${recipient.version}) since it was last verified at v${recipient.verifiedVersion}.`,
    recipient.verifiedVersion === null ? "RECIPIENT_UNVERIFIED" : "RECIPIENT_CHANGED",
  );

  const sameVersion = input.recipientVersion === recipient.version;
  add(
    "recipient_version_current",
    "Recipient unchanged since proposal",
    sameVersion,
    sameVersion
      ? `Proposal targets recipient v${recipient.version}.`
      : `Proposal was created for recipient v${input.recipientVersion}, but the recipient is now v${recipient.version}. Edit the proposal to re-select the recipient.`,
    "RECIPIENT_CHANGED",
  );

  const withinLimit = amountCents <= controls.perTransferLimitCents;
  add("per_transfer_limit", "Per-transfer limit", withinLimit,
    `${formatCents(amountCents)} vs limit ${formatCents(controls.perTransferLimitCents)}.`, "LIMIT_EXCEEDED");

  const dailyAfter = input.executedTodayCents + amountCents;
  const withinDaily = dailyAfter <= controls.dailyLimitCents;
  add("daily_limit", "Daily limit", withinDaily,
    `${formatCents(input.executedTodayCents)} already sent today + ${formatCents(amountCents)} = ${formatCents(dailyAfter)} vs limit ${formatCents(controls.dailyLimitCents)}.`,
    "DAILY_LIMIT_EXCEEDED");

  const funded = amountCents <= source.availableCents;
  add("available_balance", "Available balance", funded,
    `${formatCents(source.availableCents)} available in ${source.name} ••${source.mask}.`, "INSUFFICIENT_FUNDS");

  add("not_paused", "Execution not paused", !controls.paused,
    controls.paused ? "You paused execution in Control." : "Execution is enabled.", "PAUSED");

  const reasons = [...new Set(checks.filter((c) => !c.passed).map((c) => c.reason!))];
  return {
    decision: reasons.length === 0 ? "ALLOW" : "HOLD",
    reasons,
    checks,
    evaluatedAt: (input.now ?? new Date()).toISOString(),
  };
}
