/**
 * Deterministic purchase rules for a kid's card. Pure function: the parent's
 * settings and this month's spend decide; nothing else does.
 */
import type { CardCategory, CardStatus, DeclineReason } from "./types";
import { msg } from "@/lib/i18n/msg";

export interface PurchaseRuleInput {
  status: CardStatus;
  blockedCategories: CardCategory[];
  perPurchaseLimitCents: number;
  monthlyLimitCents: number;
  spentThisMonthCents: number;
  category: CardCategory;
  amountCents: number;
}

/** Returns null when approved, otherwise the first rule that declines it. */
export function decidePurchase(p: PurchaseRuleInput): DeclineReason | null {
  if (p.status === "frozen") return "CARD_FROZEN";
  if (p.blockedCategories.includes(p.category)) return "CATEGORY_BLOCKED";
  if (p.amountCents > p.perPurchaseLimitCents) return "OVER_PURCHASE_LIMIT";
  if (p.spentThisMonthCents + p.amountCents > p.monthlyLimitCents) return "OVER_MONTHLY_LIMIT";
  return null;
}

export const DECLINE_COPY: Record<DeclineReason, string> = {
  CARD_FROZEN: msg("Card is frozen"),
  CATEGORY_BLOCKED: msg("Category blocked"),
  OVER_PURCHASE_LIMIT: msg("Over per-purchase limit"),
  OVER_MONTHLY_LIMIT: msg("Over monthly limit"),
};
