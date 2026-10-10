"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ActionState, ExecutionReceipt, PolicyCheck, RecipientDetails, TransferAction } from "@/lib/types";
import {
  clearfi,
  paths,
  type ActionDetailResponse,
  type AuditResponse,
  type ExecuteResponse,
  type RecipientWithStatus,
} from "../components/api";
import { AuditList } from "../components/AuditList";
import {
  ActionStateBadge,
  Badge,
  CreatorBadge,
  HoldReasonChip,
  RecipientStatusBadge,
  SyntheticLabel,
  holdReasonLabel,
} from "../components/Badge";
import { HOLD_MESSAGES } from "@/lib/policy/messages";
import { Button, inputClass } from "../components/Button";
import { Card, EmptyState, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { centsToDollarInput, formatDateTime, mask, parseDollarsToCents } from "../components/format";
import { Money } from "../components/Money";
import { useApiData } from "../components/useApiData";

type Notice = { tone: "success" | "info" | "warning"; text: ReactNode };

const OP_LABELS: Record<string, string> = {
  approve: "approve",
  execute: "execute",
  forceExecute: "execute",
  verify: "verify the recipient",
  evaluate: "re-evaluate",
  edit: "edit the amount",
};

export function ActionDetail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const detail = useApiData<ActionDetailResponse>(paths.action(id));
  const audit = useApiData<AuditResponse>(paths.audit({ actionId: id, limit: 10 }));

  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<{ op: string; error: unknown } | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [lastExecute, setLastExecute] = useState<ExecuteResponse | null>(null);
  const [justVerified, setJustVerified] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const detailReady = detail.data !== null;

  useEffect(() => {
    if (!detailReady) return;
    headingRef.current?.focus({ preventScroll: true });
    // On phones the panel sits above the list; bring it into view when a transfer is selected.
    if (window.matchMedia("(max-width: 1023px)").matches) {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      rootRef.current?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    }
  }, [detailReady]);

  async function run(op: string, fn: () => Promise<Notice | null>) {
    setBusy(op);
    setOpError(null);
    setNotice(null);
    try {
      setNotice(await fn());
    } catch (err) {
      setOpError({ op, error: err });
    } finally {
      // Always re-read: a refused approve can move the action to HELD, etc.
      await Promise.all([detail.reload(), audit.reload()]);
      onChanged();
      setBusy(null);
    }
  }

  if (detail.loading && !detail.data) {
    return (
      <div ref={rootRef} className="scroll-mt-24">
        <Card title="Transfer">
          <Loading label="Loading transfer…" />
        </Card>
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div ref={rootRef} className="scroll-mt-24">
        <Card
          title="Transfer"
          action={
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          }
        >
          <ErrorBox error={detail.error ?? "Transfer not found"} title="Couldn't load this transfer" onRetry={() => void detail.reload()} />
        </Card>
      </div>
    );
  }

  const { action, recipient, sourceAccount } = detail.data;
  const state = action.state;
  const receipt: ExecutionReceipt | null = action.receipt ?? lastExecute?.receipt ?? null;
  const recipientNeedsVerify = recipient.status !== "verified" && state !== "EXECUTED";
  const anyBusy = busy !== null || detail.error !== null;

  const approve = () =>
    run("approve", async () => {
      const { action: a } = await clearfi.approveAction(action.id, action.version);
      if (detail.data) detail.setData({ ...detail.data, action: a });
      return { tone: "success", text: "Transfer approved. Any changes will need your approval again." };
    });

  const execute = (op: "execute" | "forceExecute") =>
    run(op, async () => {
      const res = await clearfi.executeAction(action.id);
      setLastExecute(res);
      if (detail.data) detail.setData({ ...detail.data, action: res.action });
      if (res.duplicate) {
        return {
          tone: "info",
          text: (
            <>
              <strong>No second transfer was made.</strong> This transfer is already complete.
            </>
          ),
        };
      }
      return {
        tone: op === "forceExecute" ? "warning" : "success",
        text: (
          <>
            Transfer complete. This was a simulation; no real money moved.
          </>
        ),
      };
    });

  const verify = () =>
    run("verify", async () => {
      const { recipient: nextRecipient } = await clearfi.verifyRecipient(recipient.id);
      if (detail.data) detail.setData({ ...detail.data, recipient: nextRecipient });
      setJustVerified(true);
      return {
        tone: "info",
        text: "Recipient verified for this demo. Check the transfer again to continue.",
      };
    });

  const evaluate = () =>
    run("evaluate", async () => {
      const { action: a } = await clearfi.evaluateAction(action.id);
      if (detail.data) detail.setData({ ...detail.data, action: a });
      setJustVerified(false);
      return {
        tone: a.state === "HELD" ? "warning" : "success",
        text:
          a.state === "HELD"
            ? `Transfer still on hold: ${a.holdReasons.map(holdReasonLabel).join(", ") || "see the checks below"}.`
            : a.state === "AWAITING_APPROVAL"
              ? "All checks passed. Ready for your approval."
              : `Re-evaluated: ${a.state}.`,
      };
    });

  function startEdit() {
    setEditValue(centsToDollarInput(action.amountCents));
    setEditError(null);
    setEditing(true);
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseDollarsToCents(editValue);
    if (!parsed.ok) {
      setEditError(parsed.error);
      return;
    }
    setEditError(null);
    void run("edit", async () => {
      const { action: a } = await clearfi.editAction(action.id, { amountCents: parsed.cents });
      if (detail.data) detail.setData({ ...detail.data, action: a });
      setEditing(false);
      return {
        tone: "warning",
        text: `Amount updated. Previous approval was cleared and safety checks ran again.${a.state === "HELD" ? " Review the hold reasons below." : ""}`,
      };
    });
  }

  return (
    <div ref={rootRef} className="min-w-0 scroll-mt-24 space-y-4">
      {detail.error !== null && (
        <ErrorBox
          error={detail.error}
          title="Couldn't refresh this transfer. Actions are disabled until its current state reloads."
          onRetry={() => void detail.reload()}
        />
      )}
      <Card>
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-xs font-medium tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
          >
            Transfer proposal
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-lg text-xl leading-none text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 sm:size-8 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            aria-label="Close transfer details"
          >
            ×
          </button>
        </div>

        <div className={`mt-3 flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm ${stateCalloutTone(state)}`}>
          <ActionStateBadge state={state} />
          <p className="min-w-0 text-pretty">{stateSummary(action, recipient)}</p>
        </div>

        <p className="mt-4 text-3xl font-semibold tracking-tight tabular-nums">
          <Money cents={action.amountCents} /> <span className="text-sm font-medium tracking-normal text-zinc-500 dark:text-zinc-400">USD</span>
        </p>
        <p className="mt-0.5 text-sm text-zinc-600 dark:text-zinc-400">
          to <span className="font-medium text-zinc-900 dark:text-zinc-100">{recipient.displayName}</span> from {sourceAccount.name}{" "}
          {mask(sourceAccount.mask)}
        </p>
        <code className="mt-1 block font-mono text-[11px] break-all text-zinc-400 dark:text-zinc-500">{action.id}</code>

        <Stepper state={state} />

        {/* THE key demo moment: destination changed since last verification */}
        {recipient.status === "changed" && (
          <RecipientChangeAlert
            recipient={recipient}
            held={state === "HELD" || action.holdReasons.includes("RECIPIENT_CHANGED")}
            canVerify={recipientNeedsVerify}
            busy={busy === "verify"}
            disabled={anyBusy}
            onVerify={verify}
          />
        )}
        {recipient.status === "unverified" && (
          <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <p className="font-semibold">This recipient has never been verified.</p>
            <p className="mt-1">
              ClearFi won&apos;t let money go to a destination you haven&apos;t confirmed through a trusted channel.
            </p>
            {recipientNeedsVerify && (
              <Button className="mt-3" variant="warning" busy={busy === "verify"} disabled={anyBusy} onClick={verify}>
                Verify recipient (simulated out-of-band check)
              </Button>
            )}
          </div>
        )}

        {/* Summary */}
        <dl className="mt-5 grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2">
          <Field label="From">
            <p className="font-medium">
              {sourceAccount.name} <span className="text-zinc-500 tabular-nums dark:text-zinc-400">{mask(sourceAccount.mask)}</span>
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {sourceAccount.institution} · <Money cents={sourceAccount.availableCents} /> available
            </p>
          </Field>
          <Field label="To">
            <p className="flex flex-wrap items-center gap-2 font-medium">
              {recipient.displayName} <RecipientStatusBadge status={recipient.status} />
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {recipient.details.institution} {mask(recipient.details.accountMask)}
              {recipient.details.routingMask ? ` · routing ${mask(recipient.details.routingMask)}` : ""}
              {recipient.kind === "own_account" ? " · your account" : ""}
            </p>
            {action.recipientVersion !== recipient.version && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Proposal captured recipient v{action.recipientVersion} ({action.destination.institution}{" "}
                {mask(action.destination.accountMask)}); the recipient is now v{recipient.version}.
              </p>
            )}
          </Field>
          <Field label="Amount">
            {editing ? (
              <form onSubmit={submitEdit} className="space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-36">
                    <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-zinc-500">$</span>
                    <input
                      aria-label="New amount in dollars"
                      name="amount"
                      className={`${inputClass} py-1.5 pl-6 tabular-nums`}
                      inputMode="decimal"
                      autoComplete="off"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                  </div>
                  <Button size="sm" type="submit" variant="primary" busy={busy === "edit"} disabled={anyBusy}>
                    Save new amount
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={anyBusy}>
                    Cancel
                  </Button>
                </div>
                {editError && <p className="text-xs text-red-700 dark:text-red-400">{editError}</p>}
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Changing the amount clears your approval and runs the safety checks again.
                </p>
              </form>
            ) : (
              <p className="flex flex-wrap items-center gap-2">
                <Money cents={action.amountCents} className="font-medium" />
                {state !== "EXECUTED" && (
                  <button
                    type="button"
                    onClick={startEdit}
                    disabled={anyBusy}
                    className="text-xs font-medium text-brand-700 hover:underline disabled:opacity-50 dark:text-brand-400"
                  >
                    Edit amount
                  </button>
                )}
              </p>
            )}
          </Field>
          <Field label="Memo">
            <p className={action.memo ? "" : "text-zinc-400"}>{action.memo || "—"}</p>
          </Field>
          <Field label="Created">
            <p className="flex flex-wrap items-center gap-2">
              <CreatorBadge createdBy={action.createdBy} />
              <span className="text-zinc-600 dark:text-zinc-400">{formatDateTime(action.createdAt)}</span>
            </p>
          </Field>
          <Field label="Approval">
            {action.hasApproval ? (
              <p>
                Approved{" "}
                <span className="text-zinc-500 dark:text-zinc-400">· {formatDateTime(action.approvedAt)}</span>
              </p>
            ) : (
              <p className="text-zinc-500 dark:text-zinc-400">Not approved</p>
            )}
          </Field>
        </dl>

        {action.holdReasons.length > 0 && (
          <section className="mt-5" aria-labelledby="hold-reasons-heading">
            <p
              id="hold-reasons-heading"
              className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400"
            >
              {state === "HELD" ? "Why ClearFi held this transfer" : "Hold reasons"}
            </p>
            <ul className="space-y-2">
              {action.holdReasons.map((r) => {
                const m = HOLD_MESSAGES[r];
                return (
                  <li
                    key={r}
                    className="rounded-xl border border-amber-300/70 bg-amber-50/60 px-3 py-2.5 text-sm dark:border-amber-900 dark:bg-amber-950/30"
                  >
                    <HoldReasonChip reason={r} />
                    {m && (
                      <>
                        <p className="mt-1.5 text-zinc-800 dark:text-zinc-200">{m.explanation}</p>
                        <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                          <span className="font-semibold text-amber-800 dark:text-amber-300">What you can do: </span>
                          {m.recovery}
                        </p>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {state === "FAILED" && action.failureReason && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950/50 dark:text-red-200">
            Simulation failed: {action.failureReason}
          </p>
        )}

        {/* Decision bar */}
        <div className="mt-6 border-t border-zinc-100 pt-5 dark:border-zinc-800">
          <div className="flex flex-wrap gap-2">
            {state === "AWAITING_APPROVAL" && (
              <Button variant="primary" busy={busy === "approve"} disabled={anyBusy} onClick={() => void approve()}>
                Approve transfer
              </Button>
            )}
            {state === "APPROVED" && (
              <Button variant="primary" busy={busy === "execute"} disabled={anyBusy} onClick={() => void execute("execute")}>
                Send demo transfer
              </Button>
            )}
            {state === "EXECUTED" && (
              <Button variant="secondary" busy={busy === "execute"} disabled={anyBusy} onClick={() => void execute("execute")}>
                Check receipt
              </Button>
            )}
            {(state === "HELD" || state === "PROPOSED" || justVerified) && state !== "EXECUTED" && (
              <Button
                variant={justVerified || (state === "HELD" && recipient.status === "verified") ? "primary" : "secondary"}
                busy={busy === "evaluate"}
                disabled={anyBusy}
                onClick={() => void evaluate()}
              >
                Check again
              </Button>
            )}
            {(state === "HELD" || state === "AWAITING_APPROVAL") && (
              <Button
                variant="warning"
                busy={busy === "forceExecute"}
                disabled={anyBusy}
                onClick={() => void execute("forceExecute")}
                title="Calls the execute endpoint directly. The server should refuse."
              >
                Try to execute anyway
              </Button>
            )}
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">{decisionHint(action, recipient)}</p>

          {opError && (
            <ErrorBox
              className="mt-3"
              error={opError.error}
              title={`Server refused to ${OP_LABELS[opError.op] ?? opError.op}`}
              onDismiss={() => setOpError(null)}
            />
          )}
          {notice && <NoticeBox notice={notice} onDismiss={() => setNotice(null)} />}
        </div>

        {receipt && <ReceiptView receipt={receipt} />}
        <details className="mt-4 text-xs text-zinc-400">
          <summary className="cursor-pointer py-2">Transfer reference details</summary>
          <dl className="mt-2 grid gap-3 sm:grid-cols-2">
            <Field label="Transfer reference"><code className="break-all">{action.id}</code></Field>
            <Field label="Version">{action.version}</Field>
            <Field label="Approved version">{action.approvedVersion ?? "Not approved"}</Field>
          </dl>
        </details>
      </Card>

      <PolicyCard action={action} />

      <Card
        title="Audit trail"
        subtitle="Latest 10 events for this transfer"
        action={
          <Button size="sm" variant="ghost" onClick={() => void audit.reload()}>
            ↻ Refresh
          </Button>
        }
      >
        <ErrorBox error={audit.error} title="Couldn't load audit events" className="mb-3" />
        {audit.loading && !audit.data ? (
          <Loading />
        ) : audit.data && audit.data.events.length > 0 ? (
          <AuditList events={audit.data.events.slice(0, 10)} showActionLink={false} />
        ) : audit.error ? null : (
          <EmptyState>No audit events yet.</EmptyState>
        )}
        <p className="mt-3 text-xs">
          <Link href="/control#audit" className="text-brand-700 hover:underline dark:text-brand-400">
            Full audit log →
          </Link>
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function stateCalloutTone(state: ActionState): string {
  if (state === "HELD" || state === "FAILED") {
    return "border-red-200 bg-red-50 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100";
  }
  if (state === "AWAITING_APPROVAL") {
    return "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100";
  }
  if (state === "EXECUTED") {
    return "border-green-200 bg-green-50 text-green-950 dark:border-green-900 dark:bg-green-950/40 dark:text-green-100";
  }
  return "border-blue-200 bg-blue-50 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-100";
}

function stateSummary(action: TransferAction, recipient: RecipientWithStatus): string {
  switch (action.state) {
    case "HELD":
      return recipient.status !== "verified"
        ? "Transfer held. Verify the recipient through a trusted channel, then re-evaluate the policy."
        : "Transfer held. Resolve the policy reasons below, then re-evaluate the transfer.";
    case "AWAITING_APPROVAL":
      return `Policy checks passed. Review this exact version before approving v${action.version}.`;
    case "APPROVED":
      return `Version ${action.approvedVersion ?? action.version} is approved. Execution still re-checks your controls.`;
    case "EXECUTED":
      return "The transfer executed as a simulation. The receipt and audit trail are recorded below.";
    case "FAILED":
      return "The simulated execution failed. No real funds moved; review the failure and audit details below.";
    case "PROPOSED":
    default:
      return "This proposal is not yet evaluated. Run the policy checks before it can move to approval.";
  }
}

function decisionHint(action: TransferAction, recipient: RecipientWithStatus): string {
  switch (action.state) {
    case "AWAITING_APPROVAL":
      return "Your approval covers this amount and these accounts. Any changes need your approval again.";
    case "APPROVED":
      return "We’ll check your limits and balance again before sending. No real money moves in this demo.";
    case "HELD":
      return recipient.status !== "verified"
        ? "Verify the recipient, then check again. Transfers on hold can’t be sent."
        : "Resolve the hold reasons above, then check again. This transfer can’t be sent yet.";
    case "EXECUTED":
      return "Checking again won’t send another transfer.";
    case "PROPOSED":
      return "Check this transfer against your limits before approving it.";
    case "FAILED":
      return "The simulated transfer failed. No money moved.";
    default:
      return "";
  }
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-zinc-500 uppercase dark:text-zinc-400">{label}</dt>
      <dd className="mt-1 min-w-0 break-words">{children}</dd>
    </div>
  );
}

function NoticeBox({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const tone =
    notice.tone === "success"
      ? "border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/50 dark:text-green-200"
      : notice.tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200"
        : "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/50 dark:text-blue-200";
  return (
    <div role="status" className={`mt-3 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <div className="min-w-0 break-words">{notice.text}</div>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs underline underline-offset-2" aria-label="Dismiss">
        Dismiss
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STEPS = ["Proposed", "Policy check", "Your approval", "Executed"] as const;
type StepStatus = "done" | "current" | "blocked" | "todo" | "failed";

function stepStatuses(state: ActionState): StepStatus[] {
  switch (state) {
    case "PROPOSED":
      return ["current", "todo", "todo", "todo"];
    case "HELD":
      return ["done", "blocked", "todo", "todo"];
    case "AWAITING_APPROVAL":
      return ["done", "done", "current", "todo"];
    case "APPROVED":
      return ["done", "done", "done", "current"];
    case "EXECUTED":
      return ["done", "done", "done", "done"];
    case "FAILED":
      return ["done", "done", "done", "failed"];
    default:
      return ["todo", "todo", "todo", "todo"];
  }
}

function Stepper({ state }: { state: ActionState }) {
  const statuses = stepStatuses(state);
  return (
    <ol className="mt-5 grid grid-cols-4 gap-1.5" aria-label="Transfer lifecycle">
      {STEPS.map((label, i) => {
        const s = statuses[i];
        const bar =
          s === "done"
            ? "bg-green-500"
            : s === "current"
              ? "bg-blue-500"
              : s === "blocked" || s === "failed"
                ? "bg-red-500"
                : "bg-zinc-200 dark:bg-zinc-700";
        const text =
          s === "blocked" || s === "failed"
            ? "text-red-700 dark:text-red-400"
            : s === "current"
              ? "text-blue-700 dark:text-blue-400"
              : s === "done"
                ? "text-zinc-700 dark:text-zinc-300"
                : "text-zinc-400 dark:text-zinc-500";
        return (
          <li key={label} className="min-w-0" aria-current={s === "current" || s === "blocked" ? "step" : undefined}>
            <div className={`h-1.5 rounded-full ${bar}`} />
            <p className={`mt-1.5 text-[11px] leading-tight font-medium sm:text-xs ${text}`}>
              {s === "done" ? "✓ " : s === "blocked" ? "⏸ " : s === "failed" ? "✕ " : ""}
              {s === "blocked" ? "Held by policy" : label}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------

const DIFF_FIELDS: { key: keyof RecipientDetails; label: string; fmt: (d: RecipientDetails) => string }[] = [
  { key: "institution", label: "Institution", fmt: (d) => d.institution },
  { key: "accountMask", label: "Account", fmt: (d) => mask(d.accountMask) },
  { key: "routingMask", label: "Routing", fmt: (d) => mask(d.routingMask) },
];

function RecipientChangeAlert({
  recipient,
  held,
  canVerify,
  busy,
  disabled,
  onVerify,
}: {
  recipient: RecipientWithStatus;
  held: boolean;
  canVerify: boolean;
  busy: boolean;
  disabled: boolean;
  onVerify: () => void;
}) {
  const prev = recipient.previousDetails;
  const cur = recipient.details;
  const changed = new Set(DIFF_FIELDS.filter((f) => !prev || prev[f.key] !== cur[f.key]).map((f) => f.key));

  return (
    <div className="mt-5 rounded-2xl border-2 border-red-300 bg-red-50/70 p-4 sm:p-5 dark:border-red-800 dark:bg-red-950/30">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-red-600 text-base font-bold text-white dark:bg-red-500 dark:text-zinc-950"
        >
          !
        </span>
        <div className="min-w-0">
          <p className="text-base font-semibold text-red-900 dark:text-red-100">
            {held
              ? "ClearFi held this transfer because the destination changed since you last verified it."
              : "The destination for this recipient changed since you last verified it."}
          </p>
          <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">
            {recipient.displayName}&apos;s bank details are now version {recipient.version}; you last verified version{" "}
            {recipient.verifiedVersion ?? "—"}.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <DiffColumn
          title="Last verified"
          version={recipient.verifiedVersion}
          details={prev}
          changed={changed}
          side="prev"
        />
        <DiffColumn title="Now on file" version={recipient.version} details={cur} changed={changed} side="cur" />
      </div>

      {recipient.changeNote && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white/70 px-3 py-2 text-sm dark:border-red-900 dark:bg-zinc-900/60">
          <p className="text-xs font-semibold tracking-wide text-red-800 uppercase dark:text-red-300">Change note on record</p>
          <p className="mt-0.5 break-words text-zinc-800 italic dark:text-zinc-200">&ldquo;{recipient.changeNote}&rdquo;</p>
        </div>
      )}

      <p className="mt-3 text-xs text-red-900/80 dark:text-red-200/80">
        &ldquo;We changed banks&rdquo; is a classic payment-redirect scam. Confirm the new details through a channel you already
        trust before verifying.
      </p>

      {canVerify && (
        <Button className="mt-3" variant="danger" busy={busy} disabled={disabled} onClick={onVerify}>
          Verify recipient (simulated out-of-band check)
        </Button>
      )}
    </div>
  );
}

function DiffColumn({
  title,
  version,
  details,
  changed,
  side,
}: {
  title: string;
  version: number | null;
  details: RecipientDetails | null;
  changed: Set<keyof RecipientDetails>;
  side: "prev" | "cur";
}) {
  return (
    <div
      className={`min-w-0 rounded-xl border bg-white p-3 dark:bg-zinc-900 ${
        side === "cur" ? "border-amber-300 dark:border-amber-800" : "border-zinc-200 dark:border-zinc-700"
      }`}
    >
      <p className="flex flex-wrap items-baseline justify-between gap-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
        <span>{title}</span>
        <span className="font-normal text-zinc-500 tabular-nums dark:text-zinc-400">v{version ?? "—"}</span>
      </p>
      {details ? (
        <dl className="mt-2 space-y-2">
          {DIFF_FIELDS.map((f) => {
            const isChanged = changed.has(f.key);
            const valueClass = !isChanged
              ? "text-zinc-600 dark:text-zinc-400"
              : side === "prev"
                ? "bg-red-100 text-red-800 line-through decoration-red-500/70 dark:bg-red-950/60 dark:text-red-300"
                : "bg-amber-100 font-semibold text-amber-950 dark:bg-amber-900/50 dark:text-amber-100";
            return (
              <div key={f.key} className="min-w-0">
                <dt className="flex items-center gap-1 text-[11px] tracking-wide text-zinc-500 uppercase dark:text-zinc-400">
                  {f.label}
                  {isChanged && side === "cur" && (
                    <Badge tone="amber" className="px-1.5 py-0 text-[10px] normal-case">
                      changed
                    </Badge>
                  )}
                </dt>
                <dd className={`mt-0.5 rounded px-1.5 py-0.5 text-sm break-words tabular-nums ${valueClass}`}>{f.fmt(details)}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">No verified details on record.</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PolicyCard({ action }: { action: TransferAction }) {
  const policy = action.policy;
  return (
    <Card
      title="Safety checks"
      subtitle={
        policy ? (
          <>
            <span className={`font-semibold ${policy.decision === "ALLOW" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {policy.decision === "ALLOW" ? "Checks passed" : "Needs attention"}
            </span>{" "}
            · checked {formatDateTime(policy.evaluatedAt)}
          </>
        ) : (
          "Not evaluated yet"
        )
      }
    >
      {!policy || policy.checks.length === 0 ? (
        <EmptyState>This transfer hasn’t been checked yet.</EmptyState>
      ) : (
        <details open={policy.decision !== "ALLOW"}>
          <summary className="cursor-pointer pb-3 text-sm">View safety checks</summary>
        <ul className="space-y-2">
          {policy.checks.map((c) => (
            <PolicyCheckRow key={c.id} check={c} />
          ))}
        </ul>
        </details>
      )}
    </Card>
  );
}

function PolicyCheckRow({ check }: { check: PolicyCheck }) {
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
        check.passed
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
      }`}
    >
      <span
        aria-label={check.passed ? "Passed" : "Failed"}
        className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-xs font-bold ${
          check.passed
            ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400"
            : "bg-red-600 text-white dark:bg-red-500 dark:text-zinc-950"
        }`}
      >
        {check.passed ? "✓" : "✗"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {check.label}
          {!check.passed && check.reason && (
            <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] text-red-800 dark:bg-red-900/60 dark:text-red-200">
              {check.reason}
            </code>
          )}
        </p>
        <p className="mt-0.5 text-xs break-words text-zinc-600 dark:text-zinc-400">{check.detail}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function ReceiptView({ receipt }: { receipt: ExecutionReceipt }) {
  return (
    <div className="mt-5 rounded-2xl border border-green-200 bg-green-50/60 p-4 dark:border-green-900 dark:bg-green-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-green-900 dark:text-green-200">✓ Transfer complete</p>
        <div className="flex gap-1.5">
          <Badge tone="amber">Simulated</Badge>
          <SyntheticLabel />
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label="Sent on">{formatDateTime(receipt.executedAt, { full: true })}</Field>
        <Field label="Amount">
          <Money cents={receipt.amountCents} className="font-medium" /> <span className="text-zinc-500">USD</span>
        </Field>
        <Field label="To">{receipt.destination}</Field>
        <Field label="From account balance after">
          <Money cents={receipt.sourceBalanceAfterCents} />
        </Field>
        {receipt.destinationBalanceAfterCents !== null && (
          <Field label="To account balance after">
            <Money cents={receipt.destinationBalanceAfterCents} />
          </Field>
        )}
      </dl>
      <p className="mt-3 text-xs text-green-900/70 dark:text-green-200/70">
        Demo transfer using synthetic balances. No real money moved.
      </p>
      <details className="mt-3 text-xs text-green-200/70">
        <summary className="cursor-pointer py-2">Receipt reference</summary>
        <code className="block break-all py-2">{receipt.receiptId}</code>
      </details>
    </div>
  );
}
