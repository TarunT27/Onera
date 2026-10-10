import { describe, expect, it } from "vitest";
import { approvalHash, canonicalJson } from "@/lib/policy/approval";
import type { Recipient } from "@/lib/types";

const recipient: Recipient = {
  id: "rcp_x", userId: "alice", displayName: "X", kind: "external", accountId: null,
  details: { institution: "Bank", accountMask: "1234", routingMask: "••0001" },
  version: 1, verifiedVersion: 1, previousDetails: null, changeNote: null, updatedAt: "",
};
const action = {
  id: "act_1", userId: "alice" as const, version: 1, sourceAccountId: "acct_a", amountCents: 1000, currency: "USD" as const,
};

describe("approval hash", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(canonicalJson({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("changes when any material field changes", () => {
    const base = approvalHash(action, recipient);
    expect(approvalHash({ ...action, amountCents: 1001 }, recipient)).not.toBe(base);
    expect(approvalHash({ ...action, version: 2 }, recipient)).not.toBe(base);
    expect(approvalHash({ ...action, sourceAccountId: "acct_b" }, recipient)).not.toBe(base);
    expect(approvalHash(action, { ...recipient, version: 2 })).not.toBe(base);
    expect(approvalHash(action, { ...recipient, details: { ...recipient.details, accountMask: "9999" } })).not.toBe(base);
  });
});
