"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { UserControls } from "@/lib/types";
import { clearfi, paths, type AgentsResponse, type AuditResponse, type ControlsResponse } from "../components/api";
import { AuditList } from "../components/AuditList";
import { Badge } from "../components/Badge";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { centsToDollarInput, formatDateTime, parseDollarsToCents } from "../components/format";
import { Money } from "../components/Money";
import { useApiData } from "../components/useApiData";

export function ControlClient() {
  const controls = useApiData<ControlsResponse>(paths.controls);
  const audit = useApiData<AuditResponse>(paths.audit({ limit: 100 }));

  function onControlsSaved(next: UserControls) {
    if (controls.data) controls.setData({ ...controls.data, controls: next });
    void controls.reload();
    void audit.reload();
  }

  const c = controls.data?.controls;
  const usage = controls.data?.usage.executedTodayCents ?? 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Control"
        description="Your rules, enforced by the server — not by the assistant's good behavior. Every decision lands in the audit log."
      />

      <ErrorBox error={controls.error} title="Couldn't load controls" onRetry={() => void controls.reload()} />

      {controls.loading && !controls.data ? (
        <Loading label="Loading controls…" />
      ) : c ? (
        <>
          <PauseCard controls={c} onSaved={onControlsSaved} />
          <div className="grid gap-6 lg:grid-cols-2">
            <LimitsCard controls={c} onSaved={onControlsSaved} />
            <UsageCard controls={c} executedTodayCents={usage} />
          </div>
        </>
      ) : null}

      <PermissionsCard />

      <AgentPermissionsCard />

      <Card
        id="audit"
        className="scroll-mt-28"
        title="Audit log"
        subtitle="Latest 100 events, newest first"
        action={
          <Button size="sm" variant="ghost" onClick={() => void audit.reload()} busy={audit.loading && !!audit.data}>
            ↻ Refresh
          </Button>
        }
      >
        <ErrorBox error={audit.error} title="Couldn't load audit log" className="mb-3" />
        {audit.loading && !audit.data ? (
          <Loading />
        ) : audit.data && audit.data.events.length > 0 ? (
          <AuditList events={audit.data.events} variant="table" />
        ) : audit.error ? null : (
          <EmptyState>No audit events yet.</EmptyState>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PauseCard({ controls, onSaved }: { controls: UserControls; onSaved: (c: UserControls) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const paused = controls.paused;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const { controls: next } = await clearfi.updateControls({ paused: !paused });
      onSaved(next);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className={`rounded-2xl border-2 p-5 shadow-sm sm:p-6 ${
        paused
          ? "border-red-300 bg-red-50 dark:border-red-800 dark:bg-red-950/40"
          : "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-block size-2.5 rounded-full ${paused ? "bg-red-500" : "bg-green-500"}`}
            />
            <h2 className="text-lg font-semibold tracking-tight">{paused ? "Execution is paused" : "Execution is active"}</h2>
          </div>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            Pausing blocks execution of new and already-approved transfers. It does not undo completed ones.
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">Last changed {formatDateTime(controls.updatedAt)}</p>
        </div>
        <Button
          size="lg"
          variant={paused ? "primary" : "danger"}
          busy={busy}
          onClick={() => void toggle()}
          aria-pressed={paused}
          className="w-full sm:w-auto"
        >
          {paused ? "▶ Resume" : "⏸ Pause all execution"}
        </Button>
      </div>
      <ErrorBox error={error} title="Couldn't change pause state" className="mt-4" />
    </section>
  );
}

function LimitsCard({ controls, onSaved }: { controls: UserControls; onSaved: (c: UserControls) => void }) {
  const [perTransfer, setPerTransfer] = useState(centsToDollarInput(controls.perTransferLimitCents));
  const [daily, setDaily] = useState(centsToDollarInput(controls.dailyLimitCents));
  const [fieldErrors, setFieldErrors] = useState<{ perTransfer?: string; daily?: string }>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);

  // Keep inputs in sync if the server values change (e.g. after reset or reload).
  useEffect(() => {
    setPerTransfer(centsToDollarInput(controls.perTransferLimitCents));
    setDaily(centsToDollarInput(controls.dailyLimitCents));
  }, [controls.perTransferLimitCents, controls.dailyLimitCents]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const p = parseDollarsToCents(perTransfer, { allowZero: true });
    const d = parseDollarsToCents(daily, { allowZero: true });
    const errs: { perTransfer?: string; daily?: string } = {};
    if (!p.ok) errs.perTransfer = p.error;
    if (!d.ok) errs.daily = d.error;
    if (p.ok && d.ok && p.cents > d.cents) {
      errs.perTransfer = "Per-transfer limit cannot exceed daily limit.";
    }
    setFieldErrors(errs);
    if (!p.ok || !d.ok || errs.perTransfer) return;

    const patch: { perTransferLimitCents?: number; dailyLimitCents?: number } = {};
    if (p.cents !== controls.perTransferLimitCents) patch.perTransferLimitCents = p.cents;
    if (d.cents !== controls.dailyLimitCents) patch.dailyLimitCents = d.cents;
    if (Object.keys(patch).length === 0) {
      setSaved(true);
      return;
    }
    setBusy(true);
    try {
      const { controls: next } = await clearfi.updateControls(patch);
      onSaved(next);
      setSaved(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Transfer limits" subtitle="Proposals over a limit are held. Execution re-checks limits at run time.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <DollarField
            id="limit-per"
            label="Per-transfer limit"
            value={perTransfer}
            onChange={(v) => {
              setPerTransfer(v);
              setSaved(false);
            }}
            error={fieldErrors.perTransfer}
            current={controls.perTransferLimitCents}
          />
          <DollarField
            id="limit-daily"
            label="Daily limit"
            value={daily}
            onChange={(v) => {
              setDaily(v);
              setSaved(false);
            }}
            error={fieldErrors.daily}
            current={controls.dailyLimitCents}
          />
        </div>
        <ErrorBox error={error} title="Limits not saved" />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy}>
            Save limits
          </Button>
          {saved && <span className="text-sm text-green-700 dark:text-green-400">✓ Saved</span>}
        </div>
      </form>
    </Card>
  );
}

function DollarField({
  id,
  label,
  value,
  onChange,
  error,
  current,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  current: number;
}) {
  return (
    <div>
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-zinc-500">$</span>
        <input
          id={id}
          name={id}
          className={`${inputClass} pl-7 tabular-nums`}
          inputMode="decimal"
          autoComplete="off"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error ? (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{error}</p>
      ) : (
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Current: <Money cents={current} />
        </p>
      )}
    </div>
  );
}

function UsageCard({ controls, executedTodayCents }: { controls: UserControls; executedTodayCents: number }) {
  const limit = controls.dailyLimitCents;
  const pct = limit > 0 ? Math.min(100, (executedTodayCents / limit) * 100) : executedTodayCents > 0 ? 100 : 0;
  const remaining = Math.max(0, limit - executedTodayCents);
  const over = executedTodayCents > limit;
  return (
    <Card title="Today's usage" subtitle="Simulated transfers executed today vs your daily limit">
      <p className="text-3xl font-semibold tracking-tight">
        <Money cents={executedTodayCents} />
        <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
          of <Money cents={limit} />
        </span>
      </p>
      <div
        className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label="Daily limit used"
      >
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {over ? (
          <span className="text-red-700 dark:text-red-400">Over the daily limit — further transfers will be held.</span>
        ) : (
          <>
            <Money cents={remaining} className="font-medium text-zinc-900 dark:text-zinc-100" /> left today · per-transfer limit{" "}
            <Money cents={controls.perTransferLimitCents} />
          </>
        )}
      </p>
      {controls.paused && (
        <p className="mt-3">
          <Badge tone="red">Paused — nothing will execute</Badge>
        </p>
      )}
    </Card>
  );
}

function PermissionsCard() {
  const can = [
    "Read your accounts and balances",
    "Read your transactions",
    "Read spending and subscription insights",
    "Read your saved recipients",
    "Create transfer proposals (which you review)",
  ];
  const cannot = [
    "Approve a transfer",
    "Execute a transfer",
    "Change limits or pause/resume",
    "Verify a recipient",
  ];
  return (
    <Card title="Assistant permissions" subtitle="Enforced on the server: the assistant simply has no tool for the things it can't do.">
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-green-700 uppercase dark:text-green-400">The assistant can</p>
          <ul className="space-y-1.5 text-sm">
            {can.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-green-600 dark:text-green-400" aria-hidden>
                  ✓
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-red-700 uppercase dark:text-red-400">It cannot</p>
          <ul className="space-y-1.5 text-sm">
            {cannot.map((t) => (
              <li key={t} className="flex gap-2">
                <span className="text-red-600 dark:text-red-400" aria-hidden>
                  ✗
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  accounts: "Accounts",
  transactions: "Transactions",
  recipients: "Recipients",
  actions: "Transfer proposals",
  portfolio: "Portfolio",
  connections: "Bank connections",
  insights: "Insights",
  jobs: "Follow-up jobs",
  connection_sync: "Connection sync",
};

function YesNo({ value }: { value: boolean }) {
  return value ? <Badge tone="red">Yes</Badge> : <Badge tone="green">No</Badge>;
}

function AgentPermissionsCard() {
  const agents = useApiData<AgentsResponse>(paths.agents);
  const rows = agents.data?.permissions ?? [];
  return (
    <Card
      id="agents"
      className="scroll-mt-28"
      title="Monitoring agent permissions"
      subtitle="Advisory — agents can't approve or move money. Each reads only its listed data and writes insights."
    >
      <ErrorBox error={agents.error} title="Couldn't load agent permissions" className="mb-3" onRetry={() => void agents.reload()} />
      {agents.loading && !agents.data ? (
        <Loading label="Loading agent permissions…" />
      ) : rows.length === 0 ? (
        <EmptyState>No monitoring agents registered.</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="agent-matrix" aria-label="Agent permission matrix">
              <thead>
                <tr>
                  <th scope="col">Agent</th>
                  <th scope="col">Reads</th>
                  <th scope="col">Writes</th>
                  <th scope="col">Can approve</th>
                  <th scope="col">Can execute</th>
                  <th scope="col">Verify / controls</th>
                  <th scope="col">Last run</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const def = agents.data?.agents.find((a) => a.id === p.agentId);
                  const reads = Object.entries(p.reads).filter(([, v]) => v).map(([k]) => SCOPE_LABELS[k] ?? k);
                  const writes = Object.entries(p.writes).filter(([, v]) => v).map(([k]) => SCOPE_LABELS[k] ?? k);
                  return (
                    <tr key={p.agentId}>
                      <th scope="row" className="min-w-44 font-medium">
                        {p.name}
                        {def && <span className="mt-0.5 block text-xs font-normal text-zinc-400">{def.trigger}</span>}
                      </th>
                      <td className="min-w-32">{reads.join(", ") || "—"}</td>
                      <td className="min-w-32">{writes.join(", ") || "—"}</td>
                      <td>
                        <YesNo value={p.canApprove} />
                      </td>
                      <td>
                        <YesNo value={p.canExecute} />
                      </td>
                      <td>
                        <YesNo value={p.canVerifyRecipients || p.canChangeControls || p.canCreateMandates} />
                      </td>
                      <td className="text-xs whitespace-nowrap text-zinc-400">
                        {def?.lastRun ? `${def.lastRun.status} · ${formatDateTime(def.lastRun.startedAt)}` : "Never"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {agents.data?.notice && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{agents.data.notice}</p>}
        </>
      )}
    </Card>
  );
}
