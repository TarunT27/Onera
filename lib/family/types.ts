/** Family cards: secondary cards for kids on a parent's credit card. */
import { z } from "zod";

export const CARD_CATEGORIES = [
  "dining", "groceries", "shopping", "entertainment", "gaming", "subscriptions", "transport", "education",
] as const;
export type CardCategory = (typeof CARD_CATEGORIES)[number];

export const DECLINE_REASONS = ["CARD_FROZEN", "CATEGORY_BLOCKED", "OVER_PURCHASE_LIMIT", "OVER_MONTHLY_LIMIT"] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export type CardStatus = "active" | "frozen";

export interface FamilyMember {
  id: string;
  name: string;
  age: number;
  relationship: "child";
  /** Accent hue for the avatar (one of a fixed palette). */
  color: "teal" | "violet" | "amber" | "rose" | "sky";
}

export interface CardCharge {
  id: string;
  cardId: string;
  postedAt: string;
  merchant: string;
  category: CardCategory;
  /** Positive = amount spent. */
  amountCents: number;
  status: "approved" | "declined";
  declineReason: DeclineReason | null;
  /** Core transaction on the parent card, for approved charges. */
  transactionId: string | null;
}

export interface FamilyAlert {
  level: "info" | "warning" | "critical";
  message: string;
}

export interface FamilyCard {
  id: string;
  member: FamilyMember;
  /** Last four digits of the secondary card. */
  cardMask: string;
  parentAccount: { id: string; name: string; institution: string; mask: string };
  status: CardStatus;
  monthlyLimitCents: number;
  perPurchaseLimitCents: number;
  blockedCategories: CardCategory[];
  /** Alert when monthly spend reaches this percentage of the limit. */
  alertThresholdPct: number;
  month: string; // YYYY-MM
  spentThisMonthCents: number;
  remainingCents: number;
  /** 0–100+, spend as a share of the monthly limit. */
  pctUsed: number;
  byCategory: { category: CardCategory; totalCents: number }[];
  declinedThisMonth: number;
  recent: CardCharge[];
  alerts: FamilyAlert[];
  simulated: true;
}

export interface FamilyOverview {
  cards: FamilyCard[];
  categories: readonly CardCategory[];
  asOf: string;
}

export const UpdateCardSchema = z
  .object({
    monthlyLimitCents: z.number().int().min(0).max(5_000_000).optional(),
    perPurchaseLimitCents: z.number().int().min(0).max(5_000_000).optional(),
    blockedCategories: z.array(z.enum(CARD_CATEGORIES)).max(CARD_CATEGORIES.length).optional(),
    status: z.enum(["active", "frozen"]).optional(),
    alertThresholdPct: z.number().int().min(10).max(100).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");
export type UpdateCardInput = z.infer<typeof UpdateCardSchema>;

export const SimulatePurchaseSchema = z
  .object({
    merchant: z.string().trim().min(1).max(60),
    category: z.enum(CARD_CATEGORIES),
    amountCents: z.number().int().positive().max(5_000_000),
  })
  .strict();
export type SimulatePurchaseInput = z.infer<typeof SimulatePurchaseSchema>;
