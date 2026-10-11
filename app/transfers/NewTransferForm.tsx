"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Account, TransferAction } from "@/lib/types";
import { clearfi, type RecipientWithStatus } from "../components/api";
import { HoldReasonChip, RecipientStatusBadge, ActionStateBadge } from "../components/Badge";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { useT } from "../components/I18nContext";
import { formatCents, mask, parseDollarsToCents } from "../components/format";
import { msg } from "@/lib/i18n/msg";

const STATUS_LOWER: Record<string, string> = {
  verified: msg("verified"),
  changed: msg("changed"),
  unverified: msg("unverified"),
};

export function NewTransferForm({
  accounts,
  accountsError,
  accountsLoading,
  recipients,
  recipientsError,
  recipientsLoading,
  onRetryAccounts,
  onRetryRecipients,
  onCreated,
  initialSourceId,
}: {
  initialSourceId?: string;
  accounts: Account[] | null;
  accountsError: unknown;
  accountsLoading: boolean;
  recipients: RecipientWithStatus[] | null;
  recipientsError: unknown;
  recipientsLoading: boolean;
  onRetryAccounts: () => void;
  onRetryRecipients: () => void;
  onCreated: (action: TransferAction) => void;
}) {
  const t = useT();
  const sources = useMemo(() => (accounts ?? []).filter((a) => a.capabilities.includes("transfer_source")), [accounts]);

  const [sourceId, setSourceId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [created, setCreated] = useState<TransferAction | null>(null);

  // Default to the first eligible source once accounts load.
  useEffect(() => {
    if (!sourceId && sources.length > 0) setSourceId(sources.find(a => a.id === initialSourceId)?.id ?? sources[0].id);
  }, [sources, sourceId, initialSourceId]);

  const recipient = recipients?.find((r) => r.id === recipientId) ?? null;
  const source = sources.find((a) => a.id === sourceId) ?? null;
  const validDestination =
    recipient !== null && !(recipient.kind === "own_account" && recipient.accountId !== null && recipient.accountId === sourceId);

  function changeSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    setRecipientId((currentRecipientId) => {
      const currentRecipient = recipients?.find((r) => r.id === currentRecipientId);
      const pointsToSource =
        currentRecipient?.kind === "own_account" &&
        currentRecipient.accountId !== null &&
        currentRecipient.accountId === nextSourceId;
      return pointsToSource ? "" : currentRecipientId;
    });
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const parsed = parseDollarsToCents(amount, { t });
    if (!parsed.ok) {
      setAmountError(parsed.error);
      return;
    }
    setAmountError(null);
    if (!sourceId || !recipientId || !validDestination) {
      setError(new Error(t("Choose a source account and a recipient.")));
      return;
    }
    setSubmitting(true);
    try {
      const { action } = await clearfi.createTransfer({
        sourceAccountId: sourceId,
        recipientId,
        amountCents: parsed.cents,
        currency: "USD",
        memo: memo.trim(),
      });
      setCreated(action);
      setAmount("");
      setMemo("");
      onCreated(action);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const loading = (accounts === null && accountsLoading) || (recipients === null && recipientsLoading);
  const unavailable = (accounts === null && !!accountsError) || (recipients === null && !!recipientsError);
  const proposalDisabledReason =
    sources.length === 0
      ? t("No linked account can send transfers.")
      : (recipients?.length ?? 0) === 0
        ? t("No saved recipient is available for this demo user.")
        : !recipientId
          ? t("Choose a recipient to create a proposal.")
          : !validDestination
            ? t("The source and destination accounts must be different.")
            : null;

  return (
    <Card title={t("New transfer")} subtitle={t("Create a request to review. Nothing moves until you approve it. Demo money only.")}>
      <ErrorBox error={accountsError} title={t("Couldn't load accounts")} className="mb-3" onRetry={onRetryAccounts} />
      <ErrorBox error={recipientsError} title={t("Couldn't load recipients")} className="mb-3" onRetry={onRetryRecipients} />
      {loading ? (
        <Loading label={t("Loading transfer options…")} />
      ) : unavailable ? null : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="tf-source" className={labelClass}>
              {t("From")}
            </label>
            <select id="tf-source" name="sourceAccountId" className={inputClass} value={sourceId} onChange={(e) => changeSource(e.target.value)} required>
              {sources.length === 0 && <option value="">{t("No accounts can send transfers")}</option>}
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {t("{account} — {amount} available", { account: `${a.name} ${mask(a.mask)}`, amount: formatCents(a.availableCents) })}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              {t("Only accounts that can send demo transfers are shown.")}
            </p>
          </div>

          <div>
            <label htmlFor="tf-recipient" className={labelClass}>
              {t("To")}
            </label>
            <select
              id="tf-recipient"
              name="recipientId"
              className={inputClass}
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              required
            >
              <option value="">{recipients?.length === 0 ? t("No recipients available") : t("Choose a recipient…")}</option>
              {(recipients ?? []).map((r) => {
                const sameAsSource = r.kind === "own_account" && r.accountId !== null && r.accountId === sourceId;
                return (
                  <option key={r.id} value={r.id} disabled={sameAsSource}>
                    {r.displayName} ({t(STATUS_LOWER[r.status] ?? r.status)}){sameAsSource ? ` — ${t("same as source")}` : ""}
                  </option>
                );
              })}
            </select>
            {recipients?.length === 0 && (
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {t("No saved recipients are available for this demo user.")}
              </p>
            )}
            {recipient && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <RecipientStatusBadge status={recipient.status} />
                <span>
                  {recipient.details.institution} {mask(recipient.details.accountMask)}
                  {recipient.details.routingMask ? ` · ${t("routing {mask}", { mask: mask(recipient.details.routingMask) })}` : ""}
                </span>
                {recipient.kind === "own_account" && <span className="text-zinc-400">· {t("your account")}</span>}
              </div>
            )}
            {recipient && recipient.status !== "verified" && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                {recipient.status === "changed"
                  ? t("This recipient's bank details changed since you verified them — Onera will hold the transfer.")
                  : t("This recipient hasn't been verified — Onera will hold the transfer until you verify.")}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tf-amount" className={labelClass}>
                {t("Amount (USD)")}
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-500">$</span>
                <input
                  id="tf-amount"
                  name="amount"
                  className={`${inputClass} pl-7 tabular-nums`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={t("1,250.00…")}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    if (amountError) setAmountError(null);
                  }}
                  aria-invalid={amountError ? true : undefined}
                  aria-describedby={amountError ? "tf-amount-error" : undefined}
                />
              </div>
              {amountError && (
                <p id="tf-amount-error" role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">
                  {amountError}
                </p>
              )}
              {source && !amountError && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {t("Available:")} <span className="tabular-nums">{formatCents(source.availableCents)}</span>
                </p>
              )}
            </div>
            <div>
              <label htmlFor="tf-memo" className={labelClass}>
                {t("Memo")} <span className="font-normal text-zinc-400">({t("optional")})</span>
              </label>
              <input
                id="tf-memo"
                name="memo"
                className={inputClass}
                maxLength={140}
                autoComplete="off"
                placeholder={t("October rent…")}
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <ErrorBox error={error} title={t("Transfer not created")} />

          {created && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="flex flex-wrap items-center gap-2">
                <span>{t("Proposal created and checked:")}</span>
                <ActionStateBadge state={created.state} />
                {created.holdReasons.map((r) => (
                  <HoldReasonChip key={r} reason={r} />
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span className="lg:hidden">{t("Review it in the panel above.")}</span>
                <span className="hidden lg:inline">{t("Review it in the panel on the right.")}</span>
              </p>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            busy={submitting}
            disabled={sources.length === 0 || !sourceId || !recipientId || !validDestination}
            aria-describedby={proposalDisabledReason ? "tf-submit-help" : undefined}
            className="w-full sm:w-auto"
          >
            {t("Create transfer proposal")}
          </Button>
          {proposalDisabledReason && (
            <p id="tf-submit-help" className="text-xs text-zinc-500 dark:text-zinc-400">
              {proposalDisabledReason}
            </p>
          )}
        </form>
      )}
    </Card>
  );
}
