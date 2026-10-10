/**
 * Request schemas for the markets module (validated on the server). Objects
 * are strict: a client can never supply state, approval, version, creator or
 * mandate fields.
 */
import { z } from "zod";

const symbol = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z.]{0,9}$/, "Symbol must be 1–10 letters")
  .transform((s) => s.toUpperCase());

/** 0.001 to 1,000,000 shares, in micro-shares. */
const quantityMicros = z.number().int().min(1_000).max(1_000_000_000_000);
/** $1 to $1,000,000. */
const notionalCents = z.number().int().min(100).max(100_000_000);
const limitCents = z.number().int().min(0).max(100_000_000);

export const AGENT_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function checkSizing(
  v: { side?: "buy" | "sell"; quantityMicros?: number; notionalCents?: number },
  ctx: z.RefinementCtx,
) {
  const hasQty = v.quantityMicros !== undefined;
  const hasNotional = v.notionalCents !== undefined;
  if (hasQty === hasNotional) {
    ctx.addIssue({ code: "custom", message: "Provide exactly one of quantityMicros or notionalCents" });
  }
  if (v.side === "sell" && hasNotional) {
    ctx.addIssue({ code: "custom", message: "Sell orders are sized by quantityMicros" });
  }
}

export const CreateOrderSchema = z
  .strictObject({
    accountId: z.string().min(1),
    symbol,
    side: z.enum(["buy", "sell"]),
    quantityMicros: quantityMicros.optional(),
    notionalCents: notionalCents.optional(),
  })
  .superRefine(checkSizing);
export type CreateOrderInput = z.input<typeof CreateOrderSchema>;

/** Material edit. Any change bumps the version, drops approval and re-prices. */
export const EditOrderSchema = z
  .strictObject({
    accountId: z.string().min(1).optional(),
    symbol: symbol.optional(),
    side: z.enum(["buy", "sell"]).optional(),
    quantityMicros: quantityMicros.optional(),
    notionalCents: notionalCents.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes supplied")
  .refine((v) => !(v.quantityMicros !== undefined && v.notionalCents !== undefined),
    "Provide at most one of quantityMicros or notionalCents");
export type EditOrderInput = z.input<typeof EditOrderSchema>;

export const UpdateTradingControlsSchema = z
  .strictObject({
    perOrderLimitCents: limitCents.optional(),
    dailyOrderLimitCents: limitCents.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "No changes supplied");

export const CreateMandateSchema = z
  .strictObject({
    agentId: z.string().regex(AGENT_ID_PATTERN, "agentId must be lowercase letters, digits, '-' or '_'"),
    accountId: z.string().min(1),
    symbols: z.array(symbol).min(1).max(12),
    side: z.literal("buy").default("buy"),
    maxOrderCents: notionalCents,
    maxDailyCents: notionalCents,
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .refine((v) => v.maxOrderCents <= v.maxDailyCents, "maxOrderCents cannot exceed maxDailyCents");
export type CreateMandateInput = z.input<typeof CreateMandateSchema>;

/** Input for the agents module's governed mandate helper. */
export const MandateOrderSchema = z.strictObject({ symbol, notionalCents });
export type MandateOrderInput = z.input<typeof MandateOrderSchema>;
