// Governance evidence: runs every scenario in fixtures/scenarios.ts through the
// REAL services on a fresh seeded database. This file only drives the services
// and compares results; it never decides policy itself.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { changeRecipientDetails, verifyRecipient } from "@/lib/actions/recipients";
import { approveAction, createTransfer, editTransfer, evaluateAction, getAction } from "@/lib/actions/service";
import { executeTransfer, type ExecuteResult } from "@/lib/actions/simulator";
import { runTool } from "@/lib/ai/tools";
import { updateControls } from "@/lib/controls";
import type { DB } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { detectSubscriptionIncreases } from "@/lib/finance/subscriptions";
import { HOLD_MESSAGES } from "@/lib/policy/messages";
import { HOLD_REASONS, type HoldReason, type UserId } from "@/lib/types";
import { SCENARIOS, type Scenario, type ScenarioStep, type SetupStep, type StepExpectation } from "@/fixtures/scenarios";
import { freshDb } from "./helpers";

function balances(db: DB): Record<string, number> {
  const rows = db.prepare("SELECT id, balance_cents AS b FROM accounts").all() as { id: string; b: number }[];
  return Object.fromEntries(rows.map((r) => [r.id, r.b]));
}

function applySetup(db: DB, userId: UserId, change: SetupStep): void {
  if ("verifyRecipient" in change) verifyRecipient(db, userId, change.verifyRecipient);
  else if ("updateControls" in change) updateControls(db, userId, change.updateControls);
  else if ("pause" in change) updateControls(db, userId, { paused: true });
  else if ("resume" in change) updateControls(db, userId, { paused: false });
  else {
    const c = change.changeRecipientDetails;
    changeRecipientDetails(db, userId, c.recipientId, c.details, c.note);
  }
}

/** Collected across the scenario so later steps can refer to earlier results. */
interface RunState {
  db: DB;
  actionId: string | null;
  firstExecution: ExecuteResult | null;
  startBalances: Record<string, number>;
}

interface StepResult {
  execution?: ExecuteResult;
  toolError?: boolean;
  findings?: ReturnType<typeof detectSubscriptionIncreases>;
}

function needAction(run: RunState): string {
  if (!run.actionId) throw new Error("Scenario step needs a proposal; add a successful propose step first");
  return run.actionId;
}

function perform(scenario: Scenario, step: ScenarioStep, run: RunState): StepResult {
  const { db } = run;
  const userId = step.as ?? scenario.persona;
  switch (step.do) {
    case "propose": {
      const transfer = step.transfer ?? scenario.transfer;
      if (!transfer) throw new Error(`${scenario.id}: propose step without a transfer`);
      if (step.by === "assistant") {
        const ctx = { db, userId, proposedActionIds: [] as string[] };
        const out = runTool(ctx, "propose_transfer", {
          source_account_id: transfer.sourceAccountId,
          recipient_id: transfer.recipientId,
          amount_cents: transfer.amountCents,
          ...(transfer.memo !== undefined ? { memo: transfer.memo } : {}),
        });
        if (out.isError) throw new Error(`propose_transfer tool failed: ${out.content}`);
        run.actionId = ctx.proposedActionIds[0];
      } else {
        run.actionId = createTransfer(db, userId, transfer, "user").id;
      }
      return {};
    }
    case "view":
      getAction(db, userId, needAction(run));
      return {};
    case "approve": {
      const id = needAction(run);
      // Default: approve the version the owner currently sees (as the UI would).
      const version = step.version ?? getAction(db, scenario.persona, id).version;
      approveAction(db, userId, id, { version });
      return {};
    }
    case "edit":
      editTransfer(db, userId, needAction(run), step.patch);
      return {};
    case "evaluate":
      evaluateAction(db, userId, needAction(run));
      return {};
    case "execute":
    case "executeAgain": {
      const execution = executeTransfer(db, userId, needAction(run));
      if (!run.firstExecution) run.firstExecution = execution;
      return { execution };
    }
    case "assistantTool": {
      const out = runTool({ db, userId, proposedActionIds: [] }, step.tool, step.input ?? {});
      return { toolError: out.isError };
    }
    case "detectSubscriptionIncreases":
      return { findings: detectSubscriptionIncreases(db, userId) };
    case "setup":
      applySetup(db, userId, step.change);
      return {};
  }
}

function sorted(reasons: readonly HoldReason[]) {
  return [...reasons].sort();
}

function check(scenario: Scenario, step: ScenarioStep, run: RunState, label: string): void {
  const exp: StepExpectation = step.expect ?? {};
  let result: StepResult = {};
  let thrown: unknown = null;
  try {
    result = perform(scenario, step, run);
  } catch (err) {
    thrown = err;
  }

  if (exp.error) {
    expect(thrown, `${label}: expected ${exp.error}`).toBeInstanceOf(ServiceError);
    expect((thrown as ServiceError).code, label).toBe(exp.error);
  } else if (thrown) {
    throw thrown;
  }

  const needsAction = exp.state !== undefined || exp.holdReasons !== undefined || exp.version !== undefined
    || exp.hasApproval !== undefined || exp.createdBy !== undefined;
  if (needsAction) {
    // Read back as the owner: the stored record is the evidence, not the step's return value.
    const action = getAction(run.db, scenario.persona, needAction(run));
    if (exp.state !== undefined) expect(action.state, `${label}: state`).toBe(exp.state);
    if (exp.holdReasons !== undefined) expect(sorted(action.holdReasons), `${label}: holdReasons`).toEqual(sorted(exp.holdReasons));
    if (exp.version !== undefined) expect(action.version, `${label}: version`).toBe(exp.version);
    if (exp.hasApproval !== undefined) expect(action.hasApproval, `${label}: hasApproval`).toBe(exp.hasApproval);
    if (exp.createdBy !== undefined) expect(action.createdBy, `${label}: createdBy`).toBe(exp.createdBy);
  }

  if (exp.duplicate !== undefined) expect(result.execution?.duplicate, `${label}: duplicate`).toBe(exp.duplicate);
  if (exp.sameReceipt) {
    expect(result.execution?.receipt.receiptId, `${label}: receipt`).toBeDefined();
    expect(result.execution?.receipt.receiptId, `${label}: same receipt`).toBe(run.firstExecution?.receipt.receiptId);
  }
  if (exp.toolError !== undefined) expect(result.toolError, `${label}: toolError`).toBe(exp.toolError);
  if (exp.findings !== undefined) {
    const actual = (result.findings ?? []).map((f) => ({
      merchant: f.merchant,
      previousAmountCents: f.previousAmountCents,
      currentAmountCents: f.currentAmountCents,
      increaseCents: f.increaseCents,
      evidenceTransactionIds: f.evidenceTransactionIds,
    }));
    expect(actual, `${label}: findings`).toEqual(exp.findings);
  }

  const now = balances(run.db);
  if (exp.balancesUnchanged) expect(now, `${label}: balances unchanged`).toEqual(run.startBalances);
  if (exp.balanceDeltas) {
    for (const [accountId, delta] of Object.entries(exp.balanceDeltas)) {
      expect(now[accountId] - run.startBalances[accountId], `${label}: ${accountId} delta`).toBe(delta);
    }
    // Every account not listed must be untouched.
    for (const [accountId, value] of Object.entries(now)) {
      if (!(accountId in exp.balanceDeltas)) expect(value, `${label}: ${accountId} untouched`).toBe(run.startBalances[accountId]);
    }
  }
}

function expectedHoldReasons(s: Scenario): HoldReason[] {
  return [...new Set(s.steps.flatMap((st) => st.expect?.holdReasons ?? []))];
}

describe("governance scenarios (fixtures/scenarios.ts)", () => {
  it("has unique kebab-case ids and covers the required evaluation cases", () => {
    const ids = SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    for (const required of [
      "valid-own-account", "changed-recipient-landlord", "over-limit", "insufficient-funds",
      "paused-after-approval", "amount-edited-after-approval", "recipient-changed-after-approval",
      "cross-user-access", "assistant-proposes-changed-landlord", "subscription-increase",
    ]) expect(ids).toContain(required);
  });

  it("explanations reuse the lib/policy/messages.ts wording for every expected hold reason", () => {
    for (const s of SCENARIOS) {
      for (const reason of expectedHoldReasons(s)) {
        expect(HOLD_REASONS).toContain(reason);
        expect(s.explanation, `${s.id} must explain ${reason}`).toContain(HOLD_MESSAGES[reason].explanation);
      }
    }
  });

  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: ${scenario.title}`, () => {
      const db = freshDb();
      for (const change of scenario.setup ?? []) applySetup(db, scenario.persona, change);
      const run: RunState = { db, actionId: null, firstExecution: null, startBalances: balances(db) };
      scenario.steps.forEach((step, i) => {
        check(scenario, step, run, `${scenario.id} step ${i + 1} (${step.as ? `${step.as} ` : ""}${step.do})`);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// docs/SCENARIOS.md evaluation table stays in sync with the fixtures.
// Regenerate: UPDATE_SCENARIOS_DOC=1 npx vitest run tests/scenarios.test.ts
// ---------------------------------------------------------------------------

const DOC = path.resolve(import.meta.dirname, "../docs/SCENARIOS.md");
const BEGIN = "<!-- scenarios:begin (generated from fixtures/scenarios.ts) -->";
const END = "<!-- scenarios:end -->";

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

function renderScenarioTable(): string {
  const rows = SCENARIOS.map((s) =>
    `| \`${s.id}\` | ${cell(s.trigger)} | ${cell(s.outcome)} | ${cell(s.explanation)} | ${cell(s.recovery)} |`);
  return [
    "| ID | Trigger | Expected outcome | User explanation | Recovery |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

describe("docs/SCENARIOS.md", () => {
  it("contains the evaluation table generated from the fixtures", () => {
    const doc = fs.readFileSync(DOC, "utf8");
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start, "missing begin marker").toBeGreaterThanOrEqual(0);
    expect(end, "missing end marker").toBeGreaterThan(start);
    const table = renderScenarioTable();
    const current = doc.slice(start + BEGIN.length, end).trim();
    if (process.env.UPDATE_SCENARIOS_DOC === "1" && current !== table) {
      fs.writeFileSync(DOC, `${doc.slice(0, start + BEGIN.length)}\n${table}\n${doc.slice(end)}`);
      return;
    }
    expect(current, "docs/SCENARIOS.md is stale; run UPDATE_SCENARIOS_DOC=1 npx vitest run tests/scenarios.test.ts").toBe(table);
  });
});
