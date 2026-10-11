/**
 * Fallback when the model is unavailable. Clearly labeled, read-only, and
 * built from the same deterministic calculations. It never creates proposals,
 * approvals or executions.
 */
import { listInsights } from "@/lib/agents";
import type { DB } from "@/lib/db";
import { formatCents } from "@/lib/finance/money";
import { spendingSummary } from "@/lib/finance/spending";
import { detectSubscriptionIncreases } from "@/lib/finance/subscriptions";
import type { ChatRequest, ChatResponse, ToolTraceEntry, UserId } from "@/lib/types";
import { msg } from "@/lib/i18n/msg";

export function fallbackReply(
  db: DB,
  userId: UserId,
  request: ChatRequest,
  reason: string,
  existingProposalIds: string[] = [],
): ChatResponse {
  const question = (request.messages[request.messages.length - 1]?.content ?? "").toLowerCase();
  const trace: ToolTraceEntry[] = [];
  const lines: string[] = [];

  const wantsTransfer =
    /^(?:please\s+)?(?:pay|send|transfer|move)\b/.test(question.trim()) ||
    /\b(?:please|can|could|would|will)\s+(?:you\s+)?(?:pay|send|transfer|move)\b/.test(question) ||
    /\b(?:i want|i'd like|i would like|help me)\s+(?:to\s+)?(?:pay|send|transfer|move)\b/.test(question);

  const wantsTrade =
    /^(?:please\s+)?(?:buy|sell)\b/.test(question.trim()) ||
    /\b(?:please|can|could|would|will)\s+(?:you\s+)?(?:buy|sell)\b/.test(question) ||
    /\b(?:i want|i'd like|i would like|help me)\s+(?:to\s+)?(?:buy|sell)\b/.test(question);

  if (existingProposalIds.length > 0) {
    lines.push(
      `${existingProposalIds.length === 1 ? "A transfer proposal was" : `${existingProposalIds.length} transfer proposals were`} created before the model became unavailable. Review ${existingProposalIds.length === 1 ? "it" : "them"} on the Transfers page before trying again.`,
    );
  }

  if (wantsTrade) {
    lines.push(
      msg("The assistant model is unavailable, so I can't draft that paper order. You can place it yourself with the order ticket on the Trade page; the same policy checks and approval apply."),
    );
  } else if (wantsTransfer) {
    if (existingProposalIds.length === 0) {
      lines.push(
        msg("The assistant model is unavailable, so I can't draft that transfer for you. You can create it yourself on the Transfers page; the same policy checks and approval apply."),
      );
    }
  } else {
    const spending = spendingSummary(db, userId);
    trace.push({ tool: "get_spending_summary", input: {}, ok: true, summary: `Spending ${spending.month}` });
    const subs = detectSubscriptionIncreases(db, userId);
    trace.push({ tool: "get_subscription_insights", input: {}, ok: true, summary: `${subs.length} price increase(s)` });

    lines.push(
      `Spending in ${spending.month} so far: ${formatCents(spending.totalCents)} across ${spending.transactionCount} transactions (previous month: ${formatCents(spending.previousTotalCents)}).`,
    );
    const top = spending.byCategory.slice(0, 3).map((c) => `${c.category} ${formatCents(c.totalCents)}`);
    if (top.length) lines.push(`Top categories: ${top.join(", ")}.`);
    if (spending.excludedInternalTransferCents > 0) {
      lines.push(`${formatCents(spending.excludedInternalTransferCents)} moved between your own accounts is excluded.`);
    }
    for (const s of subs) {
      lines.push(
        `${s.merchant} went from ${formatCents(s.previousAmountCents)} to ${formatCents(s.currentAmountCents)} (+${s.increasePct}%). Evidence: ${s.evidenceTransactionIds.join(", ")}.`,
      );
    }
    const newInsights = listInsights(db, userId, { status: "new" });
    trace.push({ tool: "get_agent_insights", input: { status: "new" }, ok: true, summary: `${newInsights.length} insight(s) (new)` });
    if (newInsights.length > 0) {
      lines.push(`${newInsights.length} new monitoring finding(s) from background monitors to review in the app (advisory).`);
    }
  }

  return {
    mode: "fallback",
    model: null,
    reply: lines.join("\n"),
    trace,
    proposedActionIds: existingProposalIds,
    proposedOrderIds: [],
    agent: request.agent ?? "general",
    notice: `${reason} Showing a deterministic summary instead of a model answer.`,
  };
}
