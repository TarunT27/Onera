/**
 * Order approval binding: a hash of the exact order version, including the
 * account, instrument, side, size and price bound. Any material change gives a
 * different hash, so a stale approval can never authorize a fill.
 *
 * Orders bound for Alpaca also bind the venue (paper or live), so an approval
 * given for Alpaca paper can never authorize a live order. Onera paper orders
 * keep the original schema-1 payload.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "@/lib/policy/approval";

export interface ApprovableOrder {
  id: string;
  userId: string;
  version: number;
  accountId: string;
  symbol: string;
  side: "buy" | "sell";
  quantityMicros: number | null;
  notionalCents: number | null;
  priceBoundCents: number | null;
  mandateId: string | null;
  /** Omitted (or "onera_paper") for Onera's local paper broker. */
  venue?: "onera_paper" | "alpaca_paper" | "alpaca_live";
}

export function orderApprovalPayload(o: ApprovableOrder): string {
  const venue = o.venue ?? "onera_paper";
  return canonicalJson({
    schema: venue === "onera_paper" ? 1 : 2,
    kind: venue === "onera_paper" ? "paper_order" : "broker_order",
    ...(venue === "onera_paper" ? {} : { venue }),
    userId: o.userId,
    orderId: o.id,
    orderVersion: o.version,
    accountId: o.accountId,
    symbol: o.symbol,
    side: o.side,
    quantityMicros: o.quantityMicros,
    notionalCents: o.notionalCents,
    priceBoundCents: o.priceBoundCents,
    mandateId: o.mandateId,
    currency: "USD",
  });
}

export function orderApprovalHash(o: ApprovableOrder): string {
  return createHash("sha256").update(orderApprovalPayload(o)).digest("hex");
}
