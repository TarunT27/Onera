/**
 * Order approval binding: a hash of the exact order version, including the
 * account, instrument, side, size and price bound. Any material change gives a
 * different hash, so a stale approval can never authorize a fill.
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
}

export function orderApprovalPayload(o: ApprovableOrder): string {
  return canonicalJson({
    schema: 1,
    kind: "paper_order",
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
