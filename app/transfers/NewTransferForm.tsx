"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Account, TransferAction } from "@/lib/types";
import { clearfi, type RecipientWithStatus } from "../components/api";
import { HoldReasonChip, RecipientStatusBadge, ActionStateBadge } from "../components/Badge";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { formatCents, mask, parseDollarsToCents } from "../components/format";

export function NewTransferForm({
  accounts,
  accountsError,
  recipients,
  recipientsError,
  onCreated,
  initialSourceId,
}: {
  initialSourceId?: string;
  accounts: Account[] | null;
  accountsError: unknown;
  recipients: RecipientWithStatus[] | null;
  recipientsError: unknown;
  onCreated: (action: TransferAction) => void;
}) {
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const parsed = parseDollarsToCents(amount);
    if (!parsed.ok) {
      setAmountError(parsed.error);
      return;
    }
    setAmountError(null);
    if (!sourceId || !recipientId) {
      setError(new Error("Choose a source account and a recipient."));
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

  const loading = accounts === null && !accountsError;

  return (
    <Card title="New transfer" subtitle="Create a request to review. Nothing moves until you approve it. Demo money only.">
      <ErrorBox error={accountsError} title="Couldn't load accounts" className="mb-3" />
      <ErrorBox error={recipientsError} title="Couldn't load recipients" className="mb-3" />
      {loading ? (
        <Loading />
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div>
            <label htmlFor="tf-source" className={labelClass}>
              From
            </label>
            <select id="tf-source" className={inputClass} value={sourceId} onChange={(e) => setSourceId(e.target.value)} required>
              {sources.length === 0 && <option value="">No accounts can send transfers</option>}
              {sources.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} {mask(a.mask)} — {formatCents(a.availableCents)} available
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
              Only accounts that can send demo transfers are shown.
            </p>
          </div>

          <div>
            <label htmlFor="tf-recipient" className={labelClass}>
              To
            </label>
            <select
              id="tf-recipient"
              className={inputClass}
              value={recipientId}
              onChange={(e) => setRecipientId(e.target.value)}
              required
            >
              <option value="">Choose a recipient…</option>
              {(recipients ?? []).map((r) => {
                const sameAsSource = r.kind === "own_account" && r.accountId !== null && r.accountId === sourceId;
                return (
                  <option key={r.id} value={r.id} disabled={sameAsSource}>
                    {r.displayName} ({r.status}){sameAsSource ? " — same as source" : ""}
                  </option>
                );
              })}
            </select>
            {recipient && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <RecipientStatusBadge status={recipient.status} />
                <span>
                  {recipient.details.institution} {mask(recipient.details.accountMask)}
                  {recipient.details.routingMask ? ` · routing ${mask(recipient.details.routingMask)}` : ""}
                </span>
                {recipient.kind === "own_account" && <span className="text-zinc-400">· your account</span>}
              </div>
            )}
            {recipient && recipient.status !== "verified" && (
              <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                {recipient.status === "changed"
                  ? "This recipient's bank details changed since you verified them — ClearFi will hold the transfer."
                  : "This recipient hasn't been verified — ClearFi will hold the transfer until you verify."}
              </p>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="tf-amount" className={labelClass}>
                Amount (USD)
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-500">$</span>
                <input
                  id="tf-amount"
                  className={`${inputClass} pl-7 tabular-nums`}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
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
                <p id="tf-amount-error" className="mt-1 text-xs text-red-700 dark:text-red-400">
                  {amountError}
                </p>
              )}
              {source && !amountError && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  Available: <span className="tabular-nums">{formatCents(source.availableCents)}</span>
                </p>
              )}
            </div>
            <div>
              <label htmlFor="tf-memo" className={labelClass}>
                Memo <span className="font-normal text-zinc-400">(optional)</span>
              </label>
              <input
                id="tf-memo"
                className={inputClass}
                maxLength={140}
                placeholder="e.g. October rent"
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
              />
            </div>
          </div>

          <ErrorBox error={error} title="Transfer not created" />

          {created && (
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm dark:border-zinc-800 dark:bg-zinc-800/50">
              <div className="flex flex-wrap items-center gap-2">
                <span>Proposal created and checked:</span>
                <ActionStateBadge state={created.state} />
                {created.holdReasons.map((r) => (
                  <HoldReasonChip key={r} reason={r} />
                ))}
              </div>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">Review it in the panel{" "}
                <span className="lg:hidden">above</span>
                <span className="hidden lg:inline">on the right</span>.
              </p>
            </div>
          )}

          <Button type="submit" variant="primary" busy={submitting} disabled={sources.length === 0} className="w-full sm:w-auto">
            Propose transfer
          </Button>
        </form>
      )}
    </Card>
  );
}
