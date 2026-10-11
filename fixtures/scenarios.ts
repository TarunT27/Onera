/**
 * Governance scenarios — the evaluation sheet as data.
 *
 * Person 4 (AI governance) owns this file. Each scenario lists the steps to
 * attempt and the outcome the server must produce. `tests/scenarios.test.ts`
 * runs every scenario through the REAL services (lib/actions, lib/controls,
 * lib/ai/tools) on a fresh seeded database. There is no second policy engine:
 * if an expectation here is wrong, the test fails and someone decides whether
 * the rule or the fixture is right.
 *
 * Editing without code:
 *  - Copy an existing scenario, give it a new kebab-case `id`, change the
 *    transfer and steps, and run `npx vitest run tests/scenarios.test.ts`.
 *  - `explanation` must contain the wording from lib/policy/messages.ts for
 *    every hold reason the scenario expects (the test checks this).
 *  - After changing titles/explanations, refresh docs/SCENARIOS.md with
 *    `UPDATE_SCENARIOS_DOC=1 npx vitest run tests/scenarios.test.ts`.
 *
 * Amounts are integer cents (USD). IDs refer to fixtures/seed-data.ts.
 */
import type {
  ActionCreator,
  ActionState,
  ApiErrorCode,
  HoldReason,
  RecipientDetails,
  UserId,
} from "@/lib/types";

export type Persona = UserId; // "alice" | "bob"

export interface ScenarioTransfer {
  sourceAccountId: string;
  recipientId: string;
  amountCents: number;
  memo?: string;
}

export interface ControlsPatch {
  perTransferLimitCents?: number;
  dailyLimitCents?: number;
  paused?: boolean;
}

/** State changes made by the user or the world (not by the transfer itself). */
export type SetupStep =
  | { verifyRecipient: string }
  | { updateControls: ControlsPatch }
  | { pause: true }
  | { resume: true }
  | { changeRecipientDetails: { recipientId: string; details: RecipientDetails; note: string } };

/** What the server must do after a step. Omitted fields are not checked. */
export interface StepExpectation {
  /** ServiceError code the step must throw (e.g. INVALID_STATE, NOT_FOUND). */
  error?: ApiErrorCode;
  /** Action state afterwards (checked even when the step errors). */
  state?: ActionState;
  /** Exact hold reasons afterwards (order does not matter). */
  holdReasons?: HoldReason[];
  version?: number;
  hasApproval?: boolean;
  createdBy?: ActionCreator;
  /** execute / executeAgain: whether the result is a replay of an earlier execution. */
  duplicate?: boolean;
  /** executeAgain: the receipt ID equals the first execution's receipt. */
  sameReceipt?: boolean;
  /** Balance change per account since the scenario started (cents, signed). */
  balanceDeltas?: Record<string, number>;
  /** No account balance changed since the scenario started. */
  balancesUnchanged?: boolean;
  /** assistantTool: the tool call must be refused. */
  toolError?: boolean;
  /** detectSubscriptionIncreases: exact findings (subset of fields). */
  findings?: {
    merchant: string;
    previousAmountCents: number;
    currentAmountCents: number;
    increaseCents: number;
    evidenceTransactionIds: string[];
  }[];
}

/** `as` runs the step under another persona's session (default: scenario persona). */
interface StepBase {
  as?: Persona;
  expect?: StepExpectation;
}

export type ScenarioStep =
  | (StepBase & {
      do: "propose";
      /** "assistant" goes through the propose_transfer AI tool. */
      by?: ActionCreator;
      /** Override the scenario transfer for this attempt (e.g. someone else's account). */
      transfer?: ScenarioTransfer;
    })
  | (StepBase & { do: "view" })
  | (StepBase & { do: "approve"; /** Version to approve; default = current version. */ version?: number })
  | (StepBase & { do: "edit"; patch: Partial<ScenarioTransfer> })
  | (StepBase & { do: "evaluate" })
  | (StepBase & { do: "execute" })
  | (StepBase & { do: "executeAgain" })
  | (StepBase & { do: "assistantTool"; tool: string; input?: Record<string, unknown> })
  | (StepBase & { do: "detectSubscriptionIncreases" })
  | (StepBase & { do: "setup"; change: SetupStep });

export interface Scenario {
  id: string;
  title: string;
  persona: Persona;
  /** What causes this rule to fire (evaluation-sheet column). */
  trigger: string;
  /** Short expected outcome (evaluation-sheet column). */
  outcome: string;
  /** User-facing explanation; must reuse lib/policy/messages.ts wording for hold reasons. */
  explanation: string;
  /** What the user can do next. */
  recovery: string;
  setup?: SetupStep[];
  transfer?: ScenarioTransfer;
  steps: ScenarioStep[];
}

// ---------------------------------------------------------------------------

const CHECKING = "acct_alice_checking";
const SAVINGS = "acct_alice_savings";

export const SCENARIOS: Scenario[] = [
  {
    id: "valid-own-account",
    title: "Verified own-account transfer executes exactly once",
    persona: "alice",
    trigger: "Verified recipient, exact-version approval, limits and balance pass",
    outcome: "Executes once; a repeat request returns the same receipt and moves nothing",
    explanation: "Transfer completed in demo mode.",
    recovery: "View the receipt.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 50_000 },
    steps: [
      { do: "propose", expect: { state: "AWAITING_APPROVAL", holdReasons: [], version: 1, createdBy: "user" } },
      { do: "approve", expect: { state: "APPROVED", hasApproval: true } },
      {
        do: "execute",
        expect: { state: "EXECUTED", duplicate: false, balanceDeltas: { [CHECKING]: -50_000, [SAVINGS]: 50_000 } },
      },
      {
        do: "executeAgain",
        expect: {
          state: "EXECUTED", duplicate: true, sameReceipt: true,
          balanceDeltas: { [CHECKING]: -50_000, [SAVINGS]: 50_000 },
        },
      },
    ],
  },
  {
    id: "changed-recipient-landlord",
    title: "Landlord bank details changed after verification",
    persona: "alice",
    trigger: "Recipient details changed since last verification (Oak Street Properties v2, verified v1)",
    outcome: "HELD with RECIPIENT_CHANGED; approve and execute return 409 INVALID_STATE; no money moves",
    explanation: "The destination's bank details differ from the version you last verified.",
    recovery:
      "Confirm the new details through a channel you already trust, verify the recipient, then re-evaluate.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_landlord", amountCents: 185_000, memo: "Rent" },
    steps: [
      { do: "propose", expect: { state: "HELD", holdReasons: ["RECIPIENT_CHANGED"] } },
      { do: "approve", expect: { error: "INVALID_STATE", state: "HELD", hasApproval: false } },
      { do: "execute", expect: { error: "INVALID_STATE", state: "HELD", balancesUnchanged: true } },
      // Recovery path: explicit out-of-band verification, then checks run again.
      { do: "setup", change: { verifyRecipient: "rcp_alice_landlord" } },
      { do: "evaluate", expect: { state: "AWAITING_APPROVAL", holdReasons: [] } },
    ],
  },
  {
    id: "over-limit",
    title: "Amount above the per-transfer limit",
    persona: "alice",
    trigger: "$2,500.00 against a $2,000.00 per-transfer limit",
    outcome: "HELD with LIMIT_EXCEEDED; execute returns 409 INVALID_STATE; reducing the amount clears the hold",
    explanation: "The amount is above your per-transfer limit.",
    recovery: "Reduce the amount, or deliberately raise the limit in Control, then re-evaluate.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 250_000 },
    steps: [
      { do: "propose", expect: { state: "HELD", holdReasons: ["LIMIT_EXCEEDED"] } },
      { do: "execute", expect: { error: "INVALID_STATE", balancesUnchanged: true } },
      { do: "edit", patch: { amountCents: 150_000 }, expect: { state: "AWAITING_APPROVAL", holdReasons: [], version: 2 } },
    ],
  },
  {
    id: "insufficient-funds",
    title: "Amount above the available balance",
    persona: "alice",
    trigger: "$5,000.00 from checking with $4,250.00 available (limits raised so only funds fail)",
    outcome: "HELD with INSUFFICIENT_FUNDS; execute returns 409 INVALID_STATE",
    explanation: "The source account's available balance is lower than the amount.",
    recovery: "Choose another source account or reduce the amount.",
    setup: [{ updateControls: { perTransferLimitCents: 10_000_000, dailyLimitCents: 10_000_000 } }],
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 500_000 },
    steps: [
      { do: "propose", expect: { state: "HELD", holdReasons: ["INSUFFICIENT_FUNDS"] } },
      { do: "execute", expect: { error: "INVALID_STATE", balancesUnchanged: true } },
    ],
  },
  {
    id: "paused-after-approval",
    title: "Pause blocks an already-approved transfer",
    persona: "alice",
    trigger: "User pauses execution after approving a valid transfer",
    outcome: "Execute returns 409 POLICY_HOLD; action HELD with PAUSED and approval discarded; no money moves",
    explanation: "You paused all execution in Control.",
    recovery: "Resume execution in Control; checks run again before anything moves.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 50_000 },
    steps: [
      { do: "propose", expect: { state: "AWAITING_APPROVAL" } },
      { do: "approve", expect: { state: "APPROVED", hasApproval: true } },
      { do: "setup", change: { pause: true } },
      {
        do: "execute",
        expect: { error: "POLICY_HOLD", state: "HELD", holdReasons: ["PAUSED"], hasApproval: false, balancesUnchanged: true },
      },
      { do: "setup", change: { resume: true } },
      { do: "evaluate", expect: { state: "AWAITING_APPROVAL", holdReasons: [] } },
    ],
  },
  {
    id: "amount-edited-after-approval",
    title: "Amount edited after approval",
    persona: "alice",
    trigger: "Approved $500.00 transfer is edited to $600.00",
    outcome:
      "New version 2, approval discarded; execute returns 409 INVALID_STATE; approving the old version returns 409 STALE_VERSION",
    explanation: "Approval no longer matches this transfer.",
    recovery: "Review and approve the new exact details.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 50_000 },
    steps: [
      { do: "propose", expect: { state: "AWAITING_APPROVAL", version: 1 } },
      { do: "approve", expect: { state: "APPROVED", hasApproval: true } },
      { do: "edit", patch: { amountCents: 60_000 }, expect: { state: "AWAITING_APPROVAL", version: 2, hasApproval: false } },
      { do: "execute", expect: { error: "INVALID_STATE", balancesUnchanged: true } },
      { do: "approve", version: 1, expect: { error: "STALE_VERSION", state: "AWAITING_APPROVAL" } },
      { do: "approve", expect: { state: "APPROVED", hasApproval: true } },
      { do: "execute", expect: { state: "EXECUTED", balanceDeltas: { [CHECKING]: -60_000, [SAVINGS]: 60_000 } } },
    ],
  },
  {
    id: "recipient-changed-after-approval",
    title: "Recipient bank details change after approval",
    persona: "alice",
    trigger: "Sam Rivera's destination changes between approval and execution",
    outcome:
      "Execute returns 409 APPROVAL_INVALID; action HELD with RECIPIENT_CHANGED; verifying alone is not enough — the recipient must be re-selected",
    explanation:
      "Approval no longer matches this transfer. The destination's bank details differ from the version you last verified.",
    recovery:
      "Confirm the new details through a channel you already trust, verify the recipient, re-select it on the transfer, then approve the new version.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_sam", amountCents: 2_500, memo: "Dinner" },
    steps: [
      { do: "propose", expect: { state: "AWAITING_APPROVAL" } },
      { do: "approve", expect: { state: "APPROVED" } },
      {
        do: "setup",
        change: {
          changeRecipientDetails: {
            recipientId: "rcp_alice_sam",
            details: { institution: "Elsewhere Bank", accountMask: "0001", routingMask: "••9999" },
            note: "Scenario: details replaced after approval",
          },
        },
      },
      {
        do: "execute",
        expect: {
          error: "APPROVAL_INVALID", state: "HELD", holdReasons: ["RECIPIENT_CHANGED"], hasApproval: false,
          balancesUnchanged: true,
        },
      },
      { do: "setup", change: { verifyRecipient: "rcp_alice_sam" } },
      // The proposal still targets recipient v1, so it stays held until re-selected.
      { do: "evaluate", expect: { state: "HELD", holdReasons: ["RECIPIENT_CHANGED"] } },
      { do: "edit", patch: { recipientId: "rcp_alice_sam" }, expect: { state: "AWAITING_APPROVAL", holdReasons: [], version: 2 } },
    ],
  },
  {
    id: "cross-user-access",
    title: "Bob cannot see or act on Alice's transfer",
    persona: "alice",
    trigger: "Bob's session uses Alice's action ID, account ID or recipient ID",
    outcome: "Every attempt returns 404 NOT_FOUND (never 403); Alice's action is untouched",
    explanation: "Records owned by another user are reported as not found.",
    recovery: "None needed — each user only sees their own records.",
    transfer: { sourceAccountId: CHECKING, recipientId: "rcp_alice_savings", amountCents: 10_000 },
    steps: [
      { do: "propose", expect: { state: "AWAITING_APPROVAL", version: 1 } },
      { do: "view", as: "bob", expect: { error: "NOT_FOUND" } },
      { do: "approve", as: "bob", expect: { error: "NOT_FOUND" } },
      { do: "edit", as: "bob", patch: { amountCents: 1 }, expect: { error: "NOT_FOUND" } },
      { do: "evaluate", as: "bob", expect: { error: "NOT_FOUND" } },
      { do: "execute", as: "bob", expect: { error: "NOT_FOUND", balancesUnchanged: true } },
      {
        do: "propose", as: "bob",
        transfer: { sourceAccountId: CHECKING, recipientId: "rcp_bob_savings", amountCents: 100 },
        expect: { error: "NOT_FOUND" },
      },
      { do: "setup", as: "bob", change: { verifyRecipient: "rcp_alice_landlord" }, expect: { error: "NOT_FOUND" } },
      // Alice's action is exactly as she left it.
      { do: "view", expect: { state: "AWAITING_APPROVAL", version: 1, hasApproval: false } },
    ],
  },
  {
    id: "assistant-proposes-changed-landlord",
    title: "Assistant proposes rent to the changed landlord",
    persona: "alice",
    trigger: "propose_transfer AI tool targets Oak Street Properties after its details changed (e.g. injected article)",
    outcome:
      "Proposal created by the assistant is HELD with RECIPIENT_CHANGED; the assistant has no approve/execute tool; direct execute returns 409 INVALID_STATE",
    explanation:
      "AI can prepare transfers; user approval is required. The destination's bank details differ from the version you last verified.",
    recovery: "Open the review flow; verify the recipient out of band before anything can be approved.",
    transfer: {
      sourceAccountId: SAVINGS, recipientId: "rcp_alice_landlord", amountCents: 200_000, memo: "rent - updated details",
    },
    steps: [
      { do: "propose", by: "assistant", expect: { state: "HELD", holdReasons: ["RECIPIENT_CHANGED"], createdBy: "assistant" } },
      { do: "assistantTool", tool: "approve_transfer", expect: { toolError: true } },
      { do: "assistantTool", tool: "execute_transfer", expect: { toolError: true } },
      { do: "assistantTool", tool: "verify_recipient", input: { recipient_id: "rcp_alice_landlord" }, expect: { toolError: true } },
      { do: "assistantTool", tool: "update_controls", input: { paused: false }, expect: { toolError: true } },
      { do: "execute", expect: { error: "INVALID_STATE", state: "HELD", balancesUnchanged: true } },
    ],
  },
  {
    id: "subscription-increase",
    title: "StreamFlix price increase cites its evidence",
    persona: "alice",
    trigger: "Latest StreamFlix charge is $22.99 after three monthly $15.49 charges",
    outcome: "One finding: StreamFlix $15.49 → $22.99 (+$7.50) with the four charge IDs as evidence; Bob has none",
    explanation: "StreamFlix went from $15.49 to $22.99 on the latest charge; the four charges are listed as evidence.",
    recovery: "Review the subscription with the merchant; no money moves.",
    steps: [
      {
        do: "detectSubscriptionIncreases",
        expect: {
          findings: [
            {
              merchant: "StreamFlix",
              previousAmountCents: 1_549,
              currentAmountCents: 2_299,
              increaseCents: 750,
              evidenceTransactionIds: ["tx_alice_0014", "tx_alice_0015", "tx_alice_0016", "tx_alice_0017"],
            },
          ],
          balancesUnchanged: true,
        },
      },
      { do: "detectSubscriptionIncreases", as: "bob", expect: { findings: [] } },
    ],
  },
];
