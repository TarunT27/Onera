/**
 * Subscription monitor (job type "subscription_review"). Persists each
 * recurring-charge price increase found by lib/finance/subscriptions, citing
 * the charges that prove the pattern. It never cancels anything.
 */
import type { AgentHandler } from "../context";
import { usd } from "./format";

export const subscriptionReview: AgentHandler = (ctx) => {
  const findings = ctx.read.transactions.subscriptionIncreases();
  for (const f of findings) {
    ctx.insights.upsert({
      type: "subscription_price_increase",
      severity: f.increasePct >= 25 ? "warning" : "info",
      title: `${f.merchant} went up ${f.increasePct}%: ${usd(f.previousAmountCents)} → ${usd(f.currentAmountCents)}`,
      body:
        `Your ${f.cadence} ${f.merchant} charge rose by ${usd(f.increaseCents)} on the latest charge after ` +
        `${f.evidenceTransactionIds.length - 1} steady charges. Review the subscription with the merchant if this ` +
        `wasn't expected; ClearFi does not cancel subscriptions. Deterministic detection on synthetic data.`,
      evidence: {
        transactionIds: f.evidenceTransactionIds,
        accountIds: [f.accountId],
        merchant: f.merchant,
        previousAmountCents: f.previousAmountCents,
        currentAmountCents: f.currentAmountCents,
      },
      dedupeKey: `subscription_increase:${f.accountId}:${f.merchant.trim().toLowerCase()}`,
    });
  }
  return {
    summary: findings.length
      ? `${findings.length} subscription price increase(s): ${findings.map((f) => f.merchant).join(", ")}`
      : "No subscription price increases",
    data: { increases: findings.length },
  };
};
