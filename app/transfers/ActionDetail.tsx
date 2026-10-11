"use client";

import { ArrowRight } from "@phosphor-icons/react";
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
import { BankLogo } from "../components/BankLogo";
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
import { msg } from "@/lib/i18n/msg";
import type { Translate } from "@/lib/i18n/translate";
import { Button, inputClass } from "../components/Button";
import { Card, EmptyState, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { centsToDollarInput, formatDateTime, mask, parseDollarsToCents } from "../components/format";
import { useI18n, useT } from "../components/I18nContext";
import { Money } from "../components/Money";
import { useApiData } from "../components/useApiData";
import { shortInstitution, shortRecipientName } from "./accountLabels";

type Notice = { tone: "success" | "info" | "warning"; text: ReactNode };

const OP_REFUSED: Record<string, string> = {
  approve: msg("Server refused to approve"),
  approveAndSend: msg("Server refused to approve and send"),
  execute: msg("Server refused to execute"),
  forceExecute: msg("Server refused to execute"),
  verify: msg("Server refused to verify the recipient"),
  evaluate: msg("Server refused to re-evaluate"),
  edit: msg("Server refused to edit the amount"),
};

export function ActionDetail({ id, onChanged, onClose }: { id: string; onChanged: () => void; onClose: () => void }) {
  const { t, tr } = useI18n();
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
        <Card title={t("Transfer")}>
          <Loading label={t("Loading transfer…")} />
        </Card>
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div ref={rootRef} className="scroll-mt-24">
        <Card
          title={t("Transfer")}
          action={
            <Button size="sm" variant="ghost" onClick={onClose}>
              {t("Close")}
            </Button>
          }
        >
          <ErrorBox error={detail.error ?? t("Transfer not found")} title={t("Couldn't load this transfer")} onRetry={() => void detail.reload()} />
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
      return { tone: "success", text: t("Transfer approved. Any changes will need your approval again.") };
    });

  // One tap for the common case: approve this exact version, then send it.
  // Both steps are separate server calls with their own checks; if sending is
  // refused (paused, limits), the approval stands and the reason is shown.
  const approveAndSend = () =>
    run("approveAndSend", async () => {
      const { action: approved } = await clearfi.approveAction(action.id, action.version);
      if (detail.data) detail.setData({ ...detail.data, action: approved });
      if (approved.state !== "APPROVED") {
        return { tone: "warning", text: t("Onera didn't approve this transfer. Review the checks below.") };
      }
      const res = await clearfi.executeAction(action.id);
      setLastExecute(res);
      if (detail.data) detail.setData({ ...detail.data, action: res.action });
      return { tone: "success", text: t("Transfer complete. This was a simulation; no real money moved.") };
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
              <strong>{t("No second transfer was made.")}</strong> {t("This transfer is already complete.")}
            </>
          ),
        };
      }
      return {
        tone: op === "forceExecute" ? "warning" : "success",
        text: (
          <>
            {t("Transfer complete. This was a simulation; no real money moved.")}
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
        text: t("Recipient verified for this demo. Check the transfer again to continue."),
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
            ? t("Transfer still on hold: {reasons}.", {
                reasons: a.holdReasons.map((r) => holdReasonLabel(r, t)).join(", ") || t("see the checks below"),
              })
            : a.state === "AWAITING_APPROVAL"
              ? t("All checks passed. Ready for your approval.")
              : t("Re-evaluated: {state}.", { state: a.state }),
      };
    });

  function startEdit() {
    setEditValue(centsToDollarInput(action.amountCents));
    setEditError(null);
    setEditing(true);
  }

  function submitEdit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseDollarsToCents(editValue, { t });
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
        text: `${t("Amount updated. Previous approval was cleared and safety checks ran again.")}${a.state === "HELD" ? ` ${t("Review the hold reasons below.")}` : ""}`,
      };
    });
  }

  return (
    <div ref={rootRef} className="min-w-0 scroll-mt-24 space-y-4">
      {detail.error !== null && (
        <ErrorBox
          error={detail.error}
          title={t("Couldn't refresh this transfer. Actions are disabled until its current state reloads.")}
          onRetry={() => void detail.reload()}
        />
      )}
      <Card>
        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h2 ref={headingRef} tabIndex={-1} className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-50 focus:outline-none">
              {state === "EXECUTED" ? t("Transfer sent") : t("Review transfer")}
            </h2>
            <ActionStateBadge state={state} />
            {action.createdBy === "assistant" && <CreatorBadge createdBy={action.createdBy} />}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="grid size-11 shrink-0 place-items-center rounded-full text-xl leading-none text-white/55 hover:bg-white/[0.08] hover:text-white sm:size-9"
            aria-label={t("Close transfer details")}
          >
            ×
          </button>
        </div>

        {/* Route + amount */}
        <div className="mt-5 rounded-[22px] bg-white/[0.035] p-4 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)] sm:p-5">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-4">
            <RouteEnd
              label={t("From")}
              institution={sourceAccount.institution}
              name={sourceAccount.name}
              accountMask={sourceAccount.mask}
            />
            <span className="hidden size-8 place-items-center rounded-full bg-white/[0.08] text-white/70 sm:grid" aria-hidden>
              <ArrowRight size={14} weight="bold" />
            </span>
            <RouteEnd
              label={t("To")}
              institution={recipient.details.institution}
              name={shortRecipientName(recipient.displayName)}
              accountMask={recipient.details.accountMask}
              badge={recipient.status !== "verified" ? <RecipientStatusBadge status={recipient.status} /> : undefined}
              align="end"
            />
          </div>

          <div className="mt-5 text-center">
            {editing ? (
              <form onSubmit={submitEdit} className="mx-auto max-w-sm space-y-2">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <div className="relative w-40">
                    <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-white/50">$</span>
                    <input
                      aria-label={t("New amount in dollars")}
                      name="amount"
                      className={`${inputClass} pl-7 tabular-nums`}
                      inputMode="decimal"
                      autoComplete="off"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                  </div>
                  <Button size="sm" type="submit" variant="primary" busy={busy === "edit"} disabled={anyBusy}>
                    {t("Save new amount")}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={anyBusy}>
                    {t("Cancel")}
                  </Button>
                </div>
                {editError && <p className="text-xs text-red-300">{editError}</p>}
                <p className="text-xs text-amber-200/90">{t("Changing the amount clears your approval and runs the safety checks again.")}</p>
              </form>
            ) : (
              <>
                <p className="text-5xl font-semibold tracking-tight text-zinc-50 tabular-nums">
                  <Money cents={action.amountCents} />
                </p>
                <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-white/50">
                  <span>USD · {t("simulated")}</span>
                  {action.memo && (
                    <>
                      <span aria-hidden>·</span>
                      <span className="max-w-[18rem] truncate">“{action.memo}”</span>
                    </>
                  )}
                  {state !== "EXECUTED" && (
                    <>
                      <span aria-hidden>·</span>
                      <button
                        type="button"
                        onClick={startEdit}
                        disabled={anyBusy}
                        className="font-medium text-brand-300 hover:underline disabled:opacity-50"
                      >
                        {t("Edit amount")}
                      </button>
                    </>
                  )}
                </p>
              </>
            )}
          </div>
          {action.recipientVersion !== recipient.version && (
            <p className="mt-3 text-center text-xs text-amber-200/90">
              {t("Proposal captured recipient v{captured} ({destination}); the recipient is now v{current}.", {
                captured: action.recipientVersion,
                destination: `${action.destination.institution} ${mask(action.destination.accountMask)}`,
                current: recipient.version,
              })}
            </p>
          )}
        </div>

        <p className={`mt-4 rounded-2xl px-4 py-2.5 text-sm text-pretty ${stateCalloutTone(state)}`}>{stateSummary(action, recipient, t)}</p>

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
          <div className="mt-4 rounded-2xl bg-amber-300/10 p-4 text-sm text-amber-100 shadow-[inset_0_0_0_1px_rgb(252_211_77/0.22)]">
            <p className="font-semibold">{t("This recipient has never been verified.")}</p>
            <p className="mt-1 text-amber-100/80">
              {t("Onera won't let money go to a destination you haven't confirmed through a trusted channel.")}
            </p>
            {recipientNeedsVerify && (
              <Button className="mt-3" variant="warning" busy={busy === "verify"} disabled={anyBusy} onClick={verify}>
                {t("Verify recipient (simulated out-of-band check)")}
              </Button>
            )}
          </div>
        )}

        {action.holdReasons.length > 0 && (
          <section className="mt-5" aria-labelledby="hold-reasons-heading">
            <p id="hold-reasons-heading" className="mb-2 text-xs font-semibold tracking-wide text-white/50 uppercase">
              {state === "HELD" ? t("Why Onera held this transfer") : t("Hold reasons")}
            </p>
            <ul className="space-y-2">
              {action.holdReasons.map((r) => {
                const m = HOLD_MESSAGES[r];
                return (
                  <li key={r} className="rounded-2xl bg-amber-300/[0.07] px-4 py-3 text-sm shadow-[inset_0_0_0_1px_rgb(252_211_77/0.18)]">
                    <HoldReasonChip reason={r} />
                    {m && (
                      <>
                        <p className="mt-1.5 text-zinc-100">{t(m.explanation)}</p>
                        <p className="mt-1 text-xs text-white/60">
                          <span className="font-semibold text-amber-200">{t("What you can do:")} </span>
                          {t(m.recovery)}
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
          <p className="mt-4 rounded-2xl bg-red-400/10 px-4 py-2.5 text-sm text-red-200">{t("Simulation failed: {reason}", { reason: t(action.failureReason) })}</p>
        )}

        {/* Decision bar: one obvious next step */}
        <div className="mt-6">
          {state === "AWAITING_APPROVAL" && (
            <>
              <Button
                variant="primary"
                size="lg"
                className="w-full"
                busy={busy === "approveAndSend"}
                disabled={anyBusy}
                onClick={() => void approveAndSend()}
              >
                {tr("Approve & send {amount}", { amount: <Money cents={action.amountCents} /> })}
              </Button>
              <div className="mt-2 flex justify-center">
                <Button size="sm" variant="ghost" busy={busy === "approve"} disabled={anyBusy} onClick={() => void approve()}>
                  {t("Approve only")}
                </Button>
              </div>
            </>
          )}
          {state === "APPROVED" && (
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              busy={busy === "execute"}
              disabled={anyBusy}
              onClick={() => void execute("execute")}
            >
              {t("Send demo transfer")}
            </Button>
          )}
          {(state === "HELD" || state === "PROPOSED" || justVerified) && state !== "EXECUTED" && (
            <Button
              variant={justVerified || (state === "HELD" && recipient.status === "verified") || state === "PROPOSED" ? "primary" : "secondary"}
              size="lg"
              className="w-full"
              busy={busy === "evaluate"}
              disabled={anyBusy}
              onClick={() => void evaluate()}
            >
              {t("Check again")}
            </Button>
          )}
          <p className="mt-2 text-center text-xs text-white/45">{decisionHint(action, recipient, t)}</p>

          {opError && (
            <ErrorBox
              className="mt-3"
              error={opError.error}
              title={OP_REFUSED[opError.op] ? t(OP_REFUSED[opError.op]) : t("Server refused to {op}", { op: opError.op })}
              onDismiss={() => setOpError(null)}
            />
          )}
          {notice && <NoticeBox notice={notice} onDismiss={() => setNotice(null)} />}
        </div>

        {receipt && <ReceiptView receipt={receipt} />}
        {state === "EXECUTED" && (
          <div className="mt-3 flex justify-center">
            <Button size="sm" variant="secondary" busy={busy === "execute"} disabled={anyBusy} onClick={() => void execute("execute")}>
              {t("Check receipt")}
            </Button>
          </div>
        )}

        {/* Guardrail demo: the server must refuse to send anything that isn't approved. */}
        {(state === "HELD" || state === "AWAITING_APPROVAL") && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-white/[0.03] px-4 py-2.5 text-xs text-white/50">
            <span>{t("Test the guardrail: Onera's server should refuse this.")}</span>
            <Button
              size="sm"
              variant="warning"
              busy={busy === "forceExecute"}
              disabled={anyBusy}
              onClick={() => void execute("forceExecute")}
              title={t("Calls the execute endpoint directly. The server should refuse.")}
            >
              {t("Try to execute anyway")}
            </Button>
          </div>
        )}

        <details className="mt-4 text-sm">
          <summary className="cursor-pointer py-2 text-xs text-white/50 hover:text-white/80">{t("Transfer details")}</summary>
          <dl className="mt-2 grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Field label={t("From")}>
              <p className="font-medium">
                {sourceAccount.name} <span className="text-white/50 tabular-nums">{mask(sourceAccount.mask)}</span>
              </p>
              <p className="text-xs text-white/50">
                {tr("{institution} · {amount} available", { institution: sourceAccount.institution, amount: <Money cents={sourceAccount.availableCents} /> })}
              </p>
            </Field>
            <Field label={t("To")}>
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {recipient.displayName} <RecipientStatusBadge status={recipient.status} />
              </p>
              <p className="text-xs text-white/50">
                {recipient.details.institution} {mask(recipient.details.accountMask)}
                {recipient.details.routingMask ? ` · ${t("routing {mask}", { mask: mask(recipient.details.routingMask) })}` : ""}
                {recipient.kind === "own_account" ? ` · ${t("your account")}` : ""}
              </p>
            </Field>
            <Field label={t("Memo")}>
              <p className={action.memo ? "" : "text-white/40"}>{action.memo || "—"}</p>
            </Field>
            <Field label={t("Created")}>
              <p className="flex flex-wrap items-center gap-2">
                <CreatorBadge createdBy={action.createdBy} />
                <span className="text-white/60">{formatDateTime(action.createdAt)}</span>
              </p>
            </Field>
            <Field label={t("Approval")}>
              {action.hasApproval ? (
                <p>
                  {t("Approved v{version}", { version: action.approvedVersion ?? action.version })} <span className="text-white/50">· {formatDateTime(action.approvedAt)}</span>
                </p>
              ) : (
                <p className="text-white/50">{t("Not approved")}</p>
              )}
            </Field>
            <Field label={t("Version")}>{action.version}</Field>
            <Field label={t("Transfer reference")}>
              <code className="text-xs break-all text-white/60">{action.id}</code>
            </Field>
          </dl>
        </details>
      </Card>
      <PolicyCard action={action} />

      <Card
        title={t("Audit trail")}
        subtitle={t("Latest 10 events for this transfer")}
        action={
          <Button size="sm" variant="ghost" onClick={() => void audit.reload()}>
            ↻ {t("Refresh")}
          </Button>
        }
      >
        <ErrorBox error={audit.error} title={t("Couldn't load audit events")} className="mb-3" />
        {audit.loading && !audit.data ? (
          <Loading />
        ) : audit.data && audit.data.events.length > 0 ? (
          <AuditList events={audit.data.events.slice(0, 10)} showActionLink={false} />
        ) : audit.error ? null : (
          <EmptyState>{t("No audit events yet.")}</EmptyState>
        )}
        <p className="mt-3 text-xs">
          <Link href="/control#audit" className="text-brand-700 hover:underline dark:text-brand-400">
            {t("Full audit log")} →
          </Link>
        </p>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function stateCalloutTone(state: ActionState): string {
  if (state === "HELD" || state === "FAILED") return "bg-red-400/10 text-red-100";
  if (state === "AWAITING_APPROVAL") return "bg-amber-300/10 text-amber-100";
  if (state === "EXECUTED") return "bg-emerald-400/10 text-emerald-100";
  return "bg-sky-400/10 text-sky-100";
}

function stateSummary(action: TransferAction, recipient: RecipientWithStatus, t: Translate): string {
  switch (action.state) {
    case "HELD":
      return recipient.status !== "verified"
        ? t("Transfer held. Verify the recipient through a trusted channel, then re-evaluate the policy.")
        : t("Transfer held. Resolve the policy reasons below, then re-evaluate the transfer.");
    case "AWAITING_APPROVAL":
      return t("All safety checks passed. Review the amount and accounts, then approve v{version}.", { version: action.version });
    case "APPROVED":
      return t("Version {version} is approved. Execution still re-checks your controls.", { version: action.approvedVersion ?? action.version });
    case "EXECUTED":
      return t("The transfer executed as a simulation. The receipt and audit trail are recorded below.");
    case "FAILED":
      return t("The simulated execution failed. No real funds moved; review the failure and audit details below.");
    case "PROPOSED":
    default:
      return t("This proposal is not yet evaluated. Run the policy checks before it can move to approval.");
  }
}

function decisionHint(action: TransferAction, recipient: RecipientWithStatus, t: Translate): string {
  switch (action.state) {
    case "AWAITING_APPROVAL":
      return t("Your approval covers exactly this amount and these accounts. Onera re-checks your limits as it sends.");
    case "APPROVED":
      return t("We’ll check your limits and balance again before sending. No real money moves in this demo.");
    case "HELD":
      return recipient.status !== "verified"
        ? t("Verify the recipient, then check again. Transfers on hold can’t be sent.")
        : t("Resolve the hold reasons above, then check again. This transfer can’t be sent yet.");
    case "EXECUTED":
      return t("Checking again won’t send another transfer.");
    case "PROPOSED":
      return t("Check this transfer against your limits before approving it.");
    case "FAILED":
      return t("The simulated transfer failed. No money moved.");
    default:
      return "";
  }
}

function RouteEnd({
  label,
  institution,
  name,
  accountMask,
  badge,
  align = "start",
}: {
  label: string;
  institution: string;
  name: string;
  accountMask: string;
  badge?: ReactNode;
  align?: "start" | "end";
}) {
  const end = align === "end";
  return (
    <div className={`flex min-w-0 flex-col items-start gap-1.5 ${end ? "sm:items-end sm:text-right" : ""}`} title={institution}>
      <span className="text-[11px] font-medium tracking-wide text-white/45 uppercase">{label}</span>
      <BankLogo institution={institution} size={22} />
      <p className="w-full truncate text-sm font-medium text-zinc-50">{name}</p>
      <p className={`flex w-full items-center gap-1.5 text-xs text-white/50 ${end ? "sm:justify-end" : ""}`}>
        <span className="truncate">
          {shortInstitution(institution)} {mask(accountMask)}
        </span>
        {badge}
      </p>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-wide text-white/45 uppercase">{label}</dt>
      <dd className="mt-1 min-w-0 break-words">{children}</dd>
    </div>
  );
}

function NoticeBox({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  const t = useT();
  const tone =
    notice.tone === "success"
      ? "bg-emerald-400/10 text-emerald-100"
      : notice.tone === "warning"
        ? "bg-amber-300/10 text-amber-100"
        : "bg-sky-400/10 text-sky-100";
  return (
    <div role="status" className={`mt-3 flex items-start justify-between gap-3 rounded-2xl px-4 py-3 text-sm ${tone}`}>
      <div className="min-w-0 break-words">{notice.text}</div>
      <button type="button" onClick={onDismiss} className="shrink-0 text-xs underline underline-offset-2" aria-label={t("Dismiss")}>
        {t("Dismiss")}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------

const STEPS = [msg("Proposed"), msg("Policy check"), msg("Your approval"), msg("Executed")] as const;
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
  const t = useT();
  const statuses = stepStatuses(state);
  return (
    <ol className="mt-5 grid grid-cols-4 gap-1.5" aria-label={t("Transfer lifecycle")}>
      {STEPS.map((label, i) => {
        const s = statuses[i];
        const bar =
          s === "done"
            ? "bg-emerald-400/80"
            : s === "current"
              ? "bg-sky-400"
              : s === "blocked" || s === "failed"
                ? "bg-red-400"
                : "bg-white/10";
        const text =
          s === "blocked" || s === "failed"
            ? "text-red-300"
            : s === "current"
              ? "text-sky-300"
              : s === "done"
                ? "text-white/70"
                : "text-white/35";
        return (
          <li key={label} className="min-w-0" aria-current={s === "current" || s === "blocked" ? "step" : undefined}>
            <div className={`h-1 rounded-full ${bar}`} />
            <p className={`mt-1.5 text-[11px] leading-tight font-medium sm:text-xs ${text}`}>
              {s === "done" ? "✓ " : s === "blocked" ? "⏸ " : s === "failed" ? "✕ " : ""}
              {s === "blocked" ? t("Held by policy") : t(label)}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------

const DIFF_FIELDS: { key: keyof RecipientDetails; label: string; fmt: (d: RecipientDetails) => string }[] = [
  { key: "institution", label: msg("Institution"), fmt: (d) => d.institution },
  { key: "accountMask", label: msg("Account"), fmt: (d) => mask(d.accountMask) },
  { key: "routingMask", label: msg("Routing"), fmt: (d) => mask(d.routingMask) },
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
  const t = useT();
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
              ? t("Onera held this transfer because the destination changed since you last verified it.")
              : t("The destination for this recipient changed since you last verified it.")}
          </p>
          <p className="mt-1 text-sm text-red-800/90 dark:text-red-200/90">
            {t("{name}'s bank details are now version {version}; you last verified version {verified}.", {
              name: recipient.displayName,
              version: recipient.version,
              verified: recipient.verifiedVersion ?? "—",
            })}
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3">
        <DiffColumn
          title={t("Last verified")}
          version={recipient.verifiedVersion}
          details={prev}
          changed={changed}
          side="prev"
        />
        <DiffColumn title={t("Now on file")} version={recipient.version} details={cur} changed={changed} side="cur" />
      </div>

      {recipient.changeNote && (
        <div className="mt-3 rounded-lg border border-red-200 bg-white/70 px-3 py-2 text-sm dark:border-red-900 dark:bg-zinc-900/60">
          <p className="text-xs font-semibold tracking-wide text-red-800 uppercase dark:text-red-300">{t("Change note on record")}</p>
          <p className="mt-0.5 break-words text-zinc-800 italic dark:text-zinc-200">&ldquo;{recipient.changeNote}&rdquo;</p>
        </div>
      )}

      <p className="mt-3 text-xs text-red-900/80 dark:text-red-200/80">
        {t("“We changed banks” is a classic payment-redirect scam. Confirm the new details through a channel you already trust before verifying.")}
      </p>

      {canVerify && (
        <Button className="mt-3" variant="danger" busy={busy} disabled={disabled} onClick={onVerify}>
          {t("Verify recipient (simulated out-of-band check)")}
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
  const t = useT();
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
                  {t(f.label)}
                  {isChanged && side === "cur" && (
                    <Badge tone="amber" className="px-1.5 py-0 text-[10px] normal-case">
                      {t("changed")}
                    </Badge>
                  )}
                </dt>
                <dd className={`mt-0.5 rounded px-1.5 py-0.5 text-sm break-words tabular-nums ${valueClass}`}>{f.fmt(details)}</dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">{t("No verified details on record.")}</p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PolicyCard({ action }: { action: TransferAction }) {
  const t = useT();
  const policy = action.policy;
  return (
    <Card
      title={t("Safety checks")}
      subtitle={
        policy ? (
          <>
            <span className={`font-semibold ${policy.decision === "ALLOW" ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}`}>
              {policy.decision === "ALLOW" ? t("Checks passed") : t("Needs attention")}
            </span>{" "}
            · {t("checked {date}", { date: formatDateTime(policy.evaluatedAt) })}
          </>
        ) : (
          t("Not evaluated yet")
        )
      }
    >
      {!policy || policy.checks.length === 0 ? (
        <EmptyState>{t("This transfer hasn’t been checked yet.")}</EmptyState>
      ) : (
        <details open={policy.decision !== "ALLOW"}>
          <summary className="cursor-pointer pb-3 text-sm">{t("View safety checks")}</summary>
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
  const t = useT();
  return (
    <li
      className={`flex items-start gap-3 rounded-xl border px-3 py-2.5 ${
        check.passed
          ? "border-zinc-200 dark:border-zinc-800"
          : "border-red-200 bg-red-50/60 dark:border-red-900 dark:bg-red-950/30"
      }`}
    >
      <span
        aria-label={check.passed ? t("Passed") : t("Failed")}
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
          {t(check.label)}
          {!check.passed && check.reason && (
            <code className="rounded bg-red-100 px-1.5 py-0.5 font-mono text-[10px] text-red-800 dark:bg-red-900/60 dark:text-red-200">
              {check.reason}
            </code>
          )}
        </p>
        <p className="mt-0.5 text-xs break-words text-zinc-600 dark:text-zinc-400">{t(check.detail)}</p>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------

function ReceiptView({ receipt }: { receipt: ExecutionReceipt }) {
  const t = useT();
  return (
    <div className="mt-5 rounded-2xl border border-green-200 bg-green-50/60 p-4 dark:border-green-900 dark:bg-green-950/30">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-green-900 dark:text-green-200">✓ {t("Transfer complete")}</p>
        <div className="flex gap-1.5">
          <Badge tone="amber">{t("Simulated")}</Badge>
          <SyntheticLabel />
        </div>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
        <Field label={t("Sent on")}>{formatDateTime(receipt.executedAt, { full: true })}</Field>
        <Field label={t("Amount")}>
          <Money cents={receipt.amountCents} className="font-medium" /> <span className="text-zinc-500">USD</span>
        </Field>
        <Field label={t("To")}>{receipt.destination}</Field>
        <Field label={t("From account balance after")}>
          <Money cents={receipt.sourceBalanceAfterCents} />
        </Field>
        {receipt.destinationBalanceAfterCents !== null && (
          <Field label={t("To account balance after")}>
            <Money cents={receipt.destinationBalanceAfterCents} />
          </Field>
        )}
      </dl>
      <p className="mt-3 text-xs text-green-900/70 dark:text-green-200/70">
        {t("Demo transfer using synthetic balances. No real money moved.")}
      </p>
      <details className="mt-3 text-xs text-green-200/70">
        <summary className="cursor-pointer py-2">{t("Receipt reference")}</summary>
        <code className="block break-all py-2">{receipt.receiptId}</code>
      </details>
    </div>
  );
}
