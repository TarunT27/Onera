/**
 * Approval binding. An approval is a hash of the exact action version and the
 * recipient record it pays. Any material change produces a different hash, so
 * a stale approval can never authorize execution.
 */
import { createHash } from "node:crypto";
import type { Recipient, TransferAction } from "@/lib/types";

type Canonical = string | number | boolean | null | Canonical[] | { [k: string]: Canonical };

/** JSON with recursively sorted keys — stable across engines and field order. */
export function canonicalJson(value: Canonical): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function approvalPayload(
  action: Pick<TransferAction, "id" | "userId" | "version" | "sourceAccountId" | "amountCents" | "currency">,
  recipient: Recipient,
): string {
  return canonicalJson({
    schema: 1,
    userId: action.userId,
    actionId: action.id,
    actionVersion: action.version,
    sourceAccountId: action.sourceAccountId,
    recipientId: recipient.id,
    recipientVersion: recipient.version,
    destination: {
      accountId: recipient.accountId,
      institution: recipient.details.institution,
      accountMask: recipient.details.accountMask,
      routingMask: recipient.details.routingMask,
    },
    amountCents: action.amountCents,
    currency: action.currency,
  });
}

export function approvalHash(
  action: Parameters<typeof approvalPayload>[0],
  recipient: Recipient,
): string {
  return createHash("sha256").update(approvalPayload(action, recipient)).digest("hex");
}
