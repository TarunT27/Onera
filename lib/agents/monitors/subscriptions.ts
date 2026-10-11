/**
 * Subscription monitor (job type "subscription_review"). Persists each
 * recurring-charge price increase found by lib/finance/subscriptions, citing
 * the charges that prove the pattern. It never cancels anything.
 */
import type { AgentHandler } from "../context";
import { usd } from "./format";
import { msg, tpl } from "@/lib/i18n/msg";

export const subscriptionReview: AgentHandler = (ctx) => {
  const findings = ctx.read.transactions.subscriptionIncreases();
  for (const f of findings) {
    ctx.insights.upsert({
      type: "subscription_price_increase",
      severity: f.increasePct >= 25 ? "warning" : "info",
      title: tpl("{merchant} went up {pct}%: {previous} → {current}", {
        merchant: f.merchant, pct: f.increasePct, previous: usd(f.previousAmountCents), current: usd(f.currentAmountCents),
      }),
      // f.cadence is always "monthly" (SubscriptionIncrease type), so it is part of the template.
      body: tpl(
        "Your monthly {merchant} charge rose by {increase} on the latest charge after " +
          "{steady} steady charges. Review the subscription with the merchant if this " +
          "wasn't expected; Onera does not cancel subscriptions. Deterministic detection on synthetic data.",
        { merchant: f.merchant, increase: usd(f.increaseCents), steady: f.evidenceTransactionIds.length - 1 },
      ),
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
      ? tpl("{count} subscription price increase(s): {merchants}", {
          count: findings.length, merchants: findings.map((f) => f.merchant).join(", "),
        })
      : msg("No subscription price increases"),
    data: { increases: findings.length },
  };
};
