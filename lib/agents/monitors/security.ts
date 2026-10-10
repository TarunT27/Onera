/**
 * Security sentinel (job type "security_review", payload { actionId }).
 *
 * Advisory review of a transfer proposal. It reads the proposal, the recipient
 * and the user's transfer history, and writes a warning/critical insight that
 * cites the action. It has no way to change the action: its context offers no
 * write besides insights, so state, hold reasons and approval stay exactly as
 * deterministic policy left them. Supplements policy; never overrides it.
 */
import { recipientStatus, type TransferAction } from "@/lib/types";
import type { AgentHandler } from "../context";
import { PermanentJobError } from "../errors";
import type { InsightSeverity } from "../types";
import { median, usd } from "./format";

const DAY_MS = 86_400_000;

export const SECURITY_RULES = {
  historyDays: 180,
  minHistorySamples: 3,
  amountMultiple: 3,
} as const;

export type SecuritySignalCode =
  | "RECIPIENT_CHANGED"
  | "RECIPIENT_UNVERIFIED"
  | "FIRST_TIME_RECIPIENT"
  | "AMOUNT_ABOVE_TYPICAL"
  | "ASSISTANT_PROPOSED_EXTERNAL";

interface Signal {
  code: SecuritySignalCode;
  severity: Exclude<InsightSeverity, "info">;
  text: string;
}

export const securityReview: AgentHandler = (ctx) => {
  const actionId = ctx.job.payload.actionId;
  if (typeof actionId !== "string" || !actionId) throw new PermanentJobError("payload.actionId is required");

  // User-scoped: another user's action is simply "not found".
  const action = ctx.read.actions.get(actionId);
  if (!action) throw new PermanentJobError(`Action ${actionId} not found`);
  const recipient = ctx.read.recipients.get(action.recipientId);
  if (!recipient) throw new PermanentJobError(`Recipient for action ${actionId} not found`);

  const signals: Signal[] = [];
  const status = recipientStatus(recipient);
  const name = recipient.displayName;

  if (status === "changed") {
    const prev = recipient.previousDetails;
    signals.push({
      code: "RECIPIENT_CHANGED",
      severity: "critical",
      text:
        `${name}'s bank details changed after they were last verified (now v${recipient.version}, verified ` +
        `v${recipient.verifiedVersion})` +
        (prev ? `: ${prev.institution} ••${prev.accountMask} → ${recipient.details.institution} ••${recipient.details.accountMask}` : "") +
        `. Changed payment instructions are a common fraud pattern; confirm on a known phone number before verifying.`,
    });
  } else if (status === "unverified") {
    signals.push({
      code: "RECIPIENT_UNVERIFIED",
      severity: "warning",
      text: `${name}'s bank details have never been verified out of band.`,
    });
  }

  const priorExecuted = ctx.read.actions.list({ recipientId: recipient.id, states: ["EXECUTED"], excludeId: action.id });
  if (recipient.kind === "external" && priorExecuted.length === 0) {
    signals.push({
      code: "FIRST_TIME_RECIPIENT",
      severity: "warning",
      text: `This is the first transfer to ${name} through Onera.`,
    });
  }

  // Typical transfers: earlier executed proposals plus internal-transfer legs from history.
  const sinceIso = new Date(ctx.now.getTime() - SECURITY_RULES.historyDays * DAY_MS).toISOString();
  const pastActions: TransferAction[] = ctx.read.actions
    .list({ states: ["EXECUTED"], excludeId: action.id })
    .filter((a) => a.createdAt >= sinceIso);
  const pastLegs = ctx.read.transactions
    .list({ sinceIso, untilIso: ctx.now.toISOString() })
    .filter((t) => t.status === "posted" && t.amountCents < 0 && t.transferGroupId !== null && t.actionId === null);
  const samples = [
    ...pastActions.map((a) => a.amountCents),
    ...pastLegs.map((t) => -ctx.toUsd(t.amountCents, t.currency)),
  ];
  let typicalCents: number | null = null;
  if (samples.length >= SECURITY_RULES.minHistorySamples) {
    typicalCents = median(samples);
    if (action.amountCents >= typicalCents * SECURITY_RULES.amountMultiple) {
      signals.push({
        code: "AMOUNT_ABOVE_TYPICAL",
        severity: "warning",
        text:
          `${usd(action.amountCents)} is about ${Math.round(action.amountCents / Math.max(typicalCents, 1))}× your ` +
          `typical transfer of ${usd(typicalCents)} (median of ${samples.length} in the last ${SECURITY_RULES.historyDays} days).`,
      });
    }
  }

  if (action.createdBy === "assistant" && recipient.kind === "external") {
    signals.push({
      code: "ASSISTANT_PROPOSED_EXTERNAL",
      severity: "warning",
      text: `The assistant drafted this transfer to an external recipient. Check that you asked for it.`,
    });
  }

  if (signals.length === 0) {
    return { summary: `No risk signals for ${action.id} (${usd(action.amountCents)} to ${name})`, auditActionId: action.id };
  }

  const severity: InsightSeverity = signals.some((s) => s.severity === "critical") ? "critical" : "warning";
  const lead = signals[0];
  const headline: Record<SecuritySignalCode, string> = {
    RECIPIENT_CHANGED: "recipient details changed since verification",
    RECIPIENT_UNVERIFIED: "recipient never verified",
    FIRST_TIME_RECIPIENT: "first transfer to this recipient",
    AMOUNT_ABOVE_TYPICAL: "amount far above your usual transfers",
    ASSISTANT_PROPOSED_EXTERNAL: "drafted by the assistant",
  };

  ctx.insights.upsert({
    type: "transfer_security_review",
    severity,
    title: `Review ${usd(action.amountCents)} transfer to ${name}: ${headline[lead.code]}`,
    body:
      signals.map((s) => `• ${s.text}`).join("\n") +
      `\n\nAdvisory only: the security sentinel cannot hold, release, approve or execute transfers. ` +
      `Policy checks and your exact-version approval still apply (current state: ${action.state}` +
      (action.holdReasons.length ? `, held for ${action.holdReasons.join(", ")}` : "") +
      `). Deterministic rules on synthetic data.`,
    evidence: {
      actionIds: [action.id, ...pastActions.map((a) => a.id)],
      transactionIds: pastLegs.map((t) => t.id),
      recipientId: recipient.id,
      actionVersion: action.version,
      recipientVersion: recipient.version,
      verifiedVersion: recipient.verifiedVersion,
      typicalTransferCents: typicalCents,
      signals: signals.map((s) => s.code),
    },
    dedupeKey: `transfer:${action.id}`,
  });

  return {
    summary: `${severity}: ${signals.map((s) => s.code).join(", ")} for ${action.id}`,
    data: { actionId: action.id, signals: signals.map((s) => s.code), severity },
    auditActionId: action.id,
  };
};
