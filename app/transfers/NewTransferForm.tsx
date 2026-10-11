"use client";

import { ArrowDown, ArrowsDownUp, CaretDown, Check, NotePencil } from "@phosphor-icons/react";
import { useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { Account, TransferAction } from "@/lib/types";
import { clearfi, type RecipientWithStatus } from "../components/api";
import { Badge, RecipientStatusBadge } from "../components/Badge";
import { BankLogo } from "../components/BankLogo";
import { Button } from "../components/Button";
import { Card, Loading } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { centsToDollarInput, formatCents, mask, parseDollarsToCents } from "../components/format";
import { destinationName, isOnera, ownDestinations, shortInstitution, type OwnDestination } from "./accountLabels";

type Mode = "own" | "external";
type Slot = "from" | "to" | null;

const QUICK_AMOUNTS = [5_000, 10_000, 50_000];

/**
 * "Move money": pick where it comes from, where it goes, and how much.
 * Defaults bring money from a linked bank back into Onera, so the common case
 * is just an amount and one tap. Submitting only creates a proposal; the
 * review panel is where the user approves and sends it.
 */
export function NewTransferForm({
  accounts,
  accountsError,
  accountsLoading,
  recipients,
  recipientsError,
  recipientsLoading,
  perTransferLimitCents,
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
  perTransferLimitCents: number | null;
  onRetryAccounts: () => void;
  onRetryRecipients: () => void;
  onCreated: (action: TransferAction) => void;
}) {
  const sources = useMemo(() => (accounts ?? []).filter((a) => a.capabilities.includes("transfer_source")), [accounts]);
  const ownDests = useMemo(() => ownDestinations(recipients ?? [], accounts ?? []), [recipients, accounts]);
  const externals = useMemo(() => (recipients ?? []).filter((r) => r.kind === "external"), [recipients]);

  const [mode, setMode] = useState<Mode>("own");
  // Explicit choices; null means "use the smart default".
  const [sourceChoice, setSourceChoice] = useState<string | null>(null);
  const [ownChoice, setOwnChoice] = useState<string | null>(null);
  const [externalChoice, setExternalChoice] = useState<string | null>(null);
  const [openSlot, setOpenSlot] = useState<Slot>(null);
  const [amount, setAmount] = useState("");
  const [memo, setMemo] = useState("");
  const [showMemo, setShowMemo] = useState(false);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // From: the account the user picked, else the one passed in the URL, else
  // (for moves between own accounts) a linked bank so money flows back into Onera.
  const sourceId =
    sources.find((a) => a.id === sourceChoice)?.id ??
    sources.find((a) => a.id === initialSourceId)?.id ??
    (mode === "own" ? sources.find((a) => !isOnera(a.institution))?.id : sources.find((a) => isOnera(a.institution))?.id) ??
    sources[0]?.id ??
    "";
  const source = sources.find((a) => a.id === sourceId) ?? null;

  const ownOptions = ownDests.filter((d) => d.recipient.accountId !== sourceId);
  const ownDest =
    ownOptions.find((d) => d.recipient.id === ownChoice) ??
    ownOptions.find((d) => d.account && isOnera(d.account.institution) && d.account.type === "checking") ??
    ownOptions.find((d) => d.account && isOnera(d.account.institution)) ??
    ownOptions[0] ??
    null;
  const external = externals.find((r) => r.id === externalChoice) ?? null;
  const recipient = mode === "own" ? (ownDest?.recipient ?? null) : external;

  // Swapping only works when the destination can also send and the source has a saved own-account recipient.
  const swapTarget =
    mode === "own" && ownDest?.account?.capabilities.includes("transfer_source")
      ? (ownDests.find((d) => d.recipient.accountId === sourceId) ?? null)
      : null;

  function swap() {
    if (!swapTarget || !ownDest?.account) return;
    setSourceChoice(ownDest.account.id);
    setOwnChoice(swapTarget.recipient.id);
    setOpenSlot(null);
  }

  // Selecting (click or arrow keys) changes the choice; only a pointer click closes the list.
  function pickSource(id: string) {
    setSourceChoice(id);
    // Keep the destination unless it is now the same account.
    if (ownChoice && ownDests.find((d) => d.recipient.id === ownChoice)?.recipient.accountId === id) setOwnChoice(null);
  }

  function pickDestination(id: string) {
    if (mode === "own") setOwnChoice(id);
    else setExternalChoice(id);
  }

  const closeSlot = () => setOpenSlot(null);

  function switchMode(next: Mode) {
    setMode(next);
    setOpenSlot(next === "external" && !externalChoice ? "to" : null);
    setError(null);
  }

  const parsed = amount.trim() ? parseDollarsToCents(amount) : null;
  const amountCents = parsed?.ok ? parsed.cents : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = parseDollarsToCents(amount);
    if (!result.ok) {
      setAmountError(result.error);
      return;
    }
    setAmountError(null);
    if (!source || !recipient) {
      setError(new Error("Choose where the money comes from and where it goes."));
      return;
    }
    setSubmitting(true);
    try {
      const { action } = await clearfi.createTransfer({
        sourceAccountId: source.id,
        recipientId: recipient.id,
        amountCents: result.cents,
        currency: "USD",
        memo: memo.trim(),
      });
      setAmount("");
      setMemo("");
      setShowMemo(false);
      onCreated(action);
    } catch (err) {
      setError(err);
    } finally {
      setSubmitting(false);
    }
  }

  const loading = (accounts === null && accountsLoading) || (recipients === null && recipientsLoading);
  const unavailable = (accounts === null && !!accountsError) || (recipients === null && !!recipientsError);
  const disabledReason =
    sources.length === 0
      ? "None of your linked accounts can send transfers."
      : !recipient
        ? mode === "own"
          ? "Link another account to move money between them."
          : "Choose who to pay."
        : null;

  const overAvailable = amountCents !== null && source !== null && amountCents > source.availableCents;
  const overLimit = amountCents !== null && perTransferLimitCents !== null && amountCents > perTransferLimitCents;

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-50">Move money</h2>
          <Badge tone="amber" title="Demo transfers move synthetic balances only">
            Simulated
          </Badge>
        </div>
        <ModeSwitch mode={mode} onChange={switchMode} />
      </div>

      <ErrorBox error={accountsError} title="Couldn't load accounts" className="mt-4" onRetry={onRetryAccounts} />
      <ErrorBox error={recipientsError} title="Couldn't load recipients" className="mt-4" onRetry={onRetryRecipients} />

      {loading ? (
        <div className="mt-4">
          <Loading label="Loading your accounts…" />
        </div>
      ) : unavailable ? null : (
        <form onSubmit={submit} className="mt-5" noValidate>
          {/* From / To */}
          <div className="relative space-y-2">
            <SlotPicker
              label="From"
              valueText={source ? `${source.name} ${mask(source.mask)}, ${shortInstitution(source.institution)}` : "none"}
              open={openSlot === "from"}
              onToggle={() => setOpenSlot(openSlot === "from" ? null : "from")}
              summary={
                source ? (
                  <AccountSummary
                    institution={source.institution}
                    name={source.name}
                    mask={source.mask}
                    detail={`${formatCents(source.availableCents)} available · ${shortInstitution(source.institution)}`}
                  />
                ) : (
                  <Placeholder>No account can send transfers</Placeholder>
                )
              }
            >
              {sources.map((a) => (
                <Option
                  key={a.id}
                  name="from"
                  value={a.id}
                  checked={a.id === sourceId}
                  onPick={pickSource}
                  onDone={closeSlot}
                  institution={a.institution}
                  title={a.name}
                  mask={a.mask}
                  detail={`${formatCents(a.availableCents)} available · ${shortInstitution(a.institution)}`}
                />
              ))}
            </SlotPicker>

            <div className="relative z-10 -my-1 flex justify-center" aria-hidden={mode === "external" ? true : undefined}>
              {mode === "own" ? (
                <button
                  type="button"
                  onClick={swap}
                  disabled={!swapTarget}
                  aria-label="Swap from and to"
                  title={swapTarget ? "Swap from and to" : "This destination can't send money back"}
                  className="grid size-9 place-items-center rounded-full bg-zinc-900 text-white/80 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)] transition hover:bg-zinc-800 hover:text-white active:scale-95 disabled:opacity-40"
                >
                  <ArrowsDownUp size={16} weight="bold" />
                </button>
              ) : (
                <span className="grid size-9 place-items-center rounded-full bg-zinc-900 text-white/60 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.14)]">
                  <ArrowDown size={16} weight="bold" />
                </span>
              )}
            </div>

            <SlotPicker
              label="To"
              valueText={
                recipient
                  ? `${mode === "own" && ownDest ? destinationName(ownDest) : recipient.displayName} ${mask(recipient.details.accountMask)}, ${shortInstitution(recipient.details.institution)}`
                  : "none"
              }
              open={openSlot === "to"}
              onToggle={() => setOpenSlot(openSlot === "to" ? null : "to")}
              summary={
                mode === "own" ? (
                  ownDest ? (
                    <AccountSummary
                      institution={ownDest.recipient.details.institution}
                      name={destinationName(ownDest)}
                      mask={ownDest.recipient.details.accountMask}
                      detail={destinationDetail(ownDest)}
                    />
                  ) : (
                    <Placeholder>No other account to move money into</Placeholder>
                  )
                ) : external ? (
                  <AccountSummary
                    institution={external.details.institution}
                    name={external.displayName}
                    mask={external.details.accountMask}
                    detail={shortInstitution(external.details.institution)}
                    badge={<RecipientStatusBadge status={external.status} />}
                  />
                ) : (
                  <Placeholder>Choose who to pay</Placeholder>
                )
              }
            >
              {mode === "own"
                ? ownOptions.map((d) => (
                    <Option
                      key={d.recipient.id}
                      name="to"
                      value={d.recipient.id}
                      checked={d.recipient.id === ownDest?.recipient.id}
                      onPick={pickDestination}
                      onDone={closeSlot}
                      institution={d.recipient.details.institution}
                      title={destinationName(d)}
                      mask={d.recipient.details.accountMask}
                      detail={destinationDetail(d)}
                    />
                  ))
                : externals.map((r) => (
                    <Option
                      key={r.id}
                      name="to"
                      value={r.id}
                      checked={r.id === external?.id}
                      onPick={pickDestination}
                      onDone={closeSlot}
                      institution={r.details.institution}
                      title={r.displayName}
                      mask={r.details.accountMask}
                      detail={shortInstitution(r.details.institution)}
                      badge={<RecipientStatusBadge status={r.status} />}
                    />
                  ))}
              {mode === "external" && externals.length === 0 && <Placeholder>No saved payees yet.</Placeholder>}
            </SlotPicker>
          </div>

          {mode === "external" && external && external.status !== "verified" && (
            <p className="mt-3 rounded-2xl bg-amber-300/10 px-4 py-2.5 text-[13px] text-amber-200">
              {external.status === "changed"
                ? "This payee's bank details changed since you verified them. Onera will hold the transfer until you confirm."
                : "You haven't verified this payee yet. Onera will hold the transfer until you do."}
            </p>
          )}

          {/* Amount */}
          <div className="mt-6 rounded-[22px] bg-white/[0.035] px-4 pt-4 pb-3 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
            <label htmlFor="tf-amount" className="block text-center text-[12px] font-medium tracking-wide text-white/50 uppercase">
              Amount
            </label>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <span className={`text-4xl font-semibold ${amount ? "text-zinc-50" : "text-white/30"}`} aria-hidden>
                $
              </span>
              <input
                id="tf-amount"
                name="amount"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  if (amountError) setAmountError(null);
                }}
                aria-invalid={amountError ? true : undefined}
                aria-describedby="tf-amount-hint"
                style={{ width: `${Math.max(amount.length, 1) + 0.5}ch` }}
                className="max-w-full min-w-[2ch] bg-transparent text-5xl font-semibold tracking-tight text-zinc-50 tabular-nums placeholder:text-white/30 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {QUICK_AMOUNTS.map((c) => (
                <Chip key={c} active={amountCents === c} onClick={() => setAmount(centsToDollarInput(c).replace(/\.00$/, ""))}>
                  {formatCents(c, { whole: true })}
                </Chip>
              ))}
              {source && source.availableCents > 0 && (
                <Chip active={amountCents === source.availableCents} onClick={() => setAmount(centsToDollarInput(source.availableCents))}>
                  All
                </Chip>
              )}
            </div>
            <p
              id="tf-amount-hint"
              role={amountError ? "alert" : undefined}
              className={`mt-3 min-h-5 text-center text-xs ${
                amountError ? "text-red-300" : overAvailable || overLimit ? "text-amber-200" : "text-white/45"
              }`}
            >
              {amountError ??
                (overAvailable && source
                  ? `More than the ${formatCents(source.availableCents)} available. Onera will hold it.`
                  : overLimit && perTransferLimitCents !== null
                    ? `Above your ${formatCents(perTransferLimitCents, { whole: true })} per-transfer limit. Onera will hold it.`
                    : source
                      ? `${formatCents(source.availableCents)} available${
                          perTransferLimitCents !== null ? ` · ${formatCents(perTransferLimitCents, { whole: true })} limit per transfer` : ""
                        }`
                      : "")}
            </p>
          </div>

          {/* Note */}
          <div className="mt-3">
            {showMemo ? (
              <div>
                <label htmlFor="tf-memo" className="sr-only">
                  Note
                </label>
                <input
                  id="tf-memo"
                  name="memo"
                  maxLength={140}
                  autoComplete="off"
                  autoFocus
                  placeholder="Add a note (optional)"
                  value={memo}
                  onChange={(e) => setMemo(e.target.value)}
                  className="block w-full rounded-2xl border-0 bg-white/[0.05] px-4 py-2.5 text-sm text-zinc-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] placeholder:text-white/35 focus:shadow-[inset_0_0_0_1px_rgb(140_185_204/0.6)] focus:outline-none"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowMemo(true)}
                className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[13px] text-white/55 hover:bg-white/[0.06] hover:text-white"
              >
                <NotePencil size={15} aria-hidden /> Add a note
              </button>
            )}
          </div>

          <ErrorBox error={error} title="Transfer not created" className="mt-3" />

          <Button
            type="submit"
            variant="primary"
            size="lg"
            busy={submitting}
            disabled={!!disabledReason}
            aria-describedby="tf-submit-help"
            className="mt-4 w-full"
          >
            Review transfer
          </Button>
          <p id="tf-submit-help" className="mt-2 text-center text-xs text-white/45">
            {disabledReason ?? "Nothing moves until you approve it on the next step. Simulated money only."}
          </p>
        </form>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function destinationDetail(d: OwnDestination): string {
  const bank = shortInstitution(d.recipient.details.institution);
  if (!d.account) return bank;
  if (d.account.type === "credit") return `${formatCents(Math.abs(d.account.balanceCents))} owed · ${bank}`;
  return `${formatCents(d.account.balanceCents)} · ${bank}`;
}

function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const options: { value: Mode; label: string }[] = [
    { value: "own", label: "My accounts" },
    { value: "external", label: "Pay someone" },
  ];
  return (
    <div role="radiogroup" aria-label="Transfer type" className="flex rounded-full bg-white/[0.06] p-[3px] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      {options.map((o) => {
        const active = o.value === mode;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={`rounded-full px-3.5 py-1.5 text-[12.5px] font-semibold transition ${
              active
                ? "bg-white/[0.16] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.2),0_4px_12px_-4px_rgb(0_0_0/0.6)]"
                : "text-white/55 hover:text-white"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function SlotPicker({
  label,
  valueText,
  open,
  onToggle,
  summary,
  children,
}: {
  label: string;
  valueText: string;
  open: boolean;
  onToggle: () => void;
  summary: ReactNode;
  children: ReactNode;
}) {
  const listId = useId();
  return (
    <div
      className={`rounded-[22px] bg-white/[0.04] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-shadow ${
        open ? "shadow-[inset_0_0_0_1px_rgb(140_185_204/0.45)]" : ""
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={listId}
        aria-label={`${label}: ${valueText}. Change`}
        className="flex w-full items-center gap-3 rounded-[22px] px-4 py-3 text-left hover:bg-white/[0.03]"
      >
        <span className="min-w-0 flex-1">
          <span className="mb-1 block text-[11px] font-medium tracking-wide text-white/45 uppercase">{label}</span>
          {summary}
        </span>
        <CaretDown size={16} aria-hidden className={`shrink-0 text-white/45 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div id={listId} role="radiogroup" aria-label={`${label} account`} className="space-y-1 px-2 pb-2">
          {children}
        </div>
      )}
    </div>
  );
}

function AccountSummary({
  institution,
  name,
  mask: accountMask,
  detail,
  badge,
}: {
  institution: string;
  name: string;
  mask: string;
  detail: string;
  badge?: ReactNode;
}) {
  return (
    <span className="flex min-w-0 items-center gap-3" title={institution}>
      <BankLogo institution={institution} size={18} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-medium text-zinc-50">{name}</span>
        <span className="flex min-w-0 items-center gap-1.5 text-xs text-white/50 tabular-nums">
          {badge}
          <span className="shrink-0">{mask(accountMask)}</span>
          <span className="truncate">· {detail}</span>
        </span>
      </span>
    </span>
  );
}

function Option({
  name,
  value,
  checked,
  onPick,
  onDone,
  institution,
  title,
  mask: accountMask,
  detail,
  badge,
}: {
  name: string;
  value: string;
  checked: boolean;
  onPick: (id: string) => void;
  onDone: () => void;
  institution: string;
  title: string;
  mask: string;
  detail: string;
  badge?: ReactNode;
}) {
  return (
    <label
      // detail is 0 for keyboard-synthesised clicks: keep the list open while arrowing through it.
      onClick={(e) => {
        if (e.detail === 0) return;
        onPick(value);
        onDone();
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors ${
        checked ? "bg-white/[0.09]" : "hover:bg-white/[0.05]"
      } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-400`}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onPick(value)}
        className="sr-only"
      />
      <span className="min-w-0 flex-1">
        <AccountSummary institution={institution} name={title} mask={accountMask} detail={detail} badge={badge} />
      </span>
      <Check size={16} weight="bold" aria-hidden className={`shrink-0 text-brand-300 ${checked ? "" : "invisible"}`} />
    </label>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium tabular-nums transition active:scale-95 ${
        active
          ? "bg-white text-zinc-950"
          : "bg-white/[0.07] text-white/75 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-white/[0.12] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return <span className="block py-1.5 text-sm text-white/45">{children}</span>;
}
