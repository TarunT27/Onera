"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { UserControls } from "@/lib/types";
import { clearfi, paths, type AgentsResponse, type AuditResponse, type ControlsResponse } from "../components/api";
import { AgentAvatar } from "../components/AgentAvatar";
import { AuditList } from "../components/AuditList";
import { Badge } from "../components/Badge";
import { Button, inputClass, labelClass } from "../components/Button";
import { Card, EmptyState, Loading, PageHeader } from "../components/Card";
import { ErrorBox } from "../components/ErrorBox";
import { useI18n, useT } from "../components/I18nContext";
import { msg } from "@/lib/i18n/msg";
import { centsToDollarInput, formatDateTime, parseDollarsToCents } from "../components/format";
import { Money } from "../components/Money";
import { useApiData } from "../components/useApiData";
import "./control-screen.css";

export function ControlClient() {
  const t = useT();
  const controls = useApiData<ControlsResponse>(paths.controls);
  const audit = useApiData<AuditResponse>(paths.audit({ limit: 100 }));

  function onControlsSaved(next: UserControls) {
    if (controls.data) controls.setData({ ...controls.data, controls: next });
    void controls.reload();
    void audit.reload();
  }

  // Desktop only: which of the right-hand panels is shown (phones stack both).
  const [sideView, setSideView] = useState<"audit" | "permissions">("audit");

  // Deep links such as /control#agents open the panel that holds the target.
  useEffect(() => {
    function syncFromHash() {
      if (window.location.hash === "#agents") setSideView("permissions");
      else if (window.location.hash === "#audit") setSideView("audit");
    }
    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);
    return () => window.removeEventListener("hashchange", syncFromHash);
  }, []);

  const c = controls.data?.controls;
  const usage = controls.data?.usage.executedTodayCents ?? 0;

  return (
    <div className="control-screen screen space-y-6">
      <div className="control-head screen-title">
        <PageHeader
          title={t("Control")}
          description={t("Your rules, enforced by the server — not by the assistant's good behavior. Every decision lands in the audit log.")}
        />
      </div>

      <div className="control-body screen-body space-y-6">
        {/* Left: the live controls (pause, limits, today's usage). */}
        <div className="control-main screen-pane screen-stack space-y-6">
          <ErrorBox error={controls.error} title={t("Couldn't load controls")} onRetry={() => void controls.reload()} />

          {controls.loading && !controls.data ? (
            <Loading label={t("Loading controls…")} />
          ) : c ? (
            <>
              <PauseCard controls={c} onSaved={onControlsSaved} />
              <div className="control-limits grid gap-6 lg:grid-cols-2">
                <LimitsCard controls={c} onSaved={onControlsSaved} />
                <UsageCard controls={c} executedTodayCents={usage} />
              </div>
            </>
          ) : null}
        </div>

        {/* Right: audit log and permissions. On desktop a switch shows one at a time; phones see both. */}
        <div className="control-side space-y-6" data-view={sideView}>
          <div className="control-switch hidden">
            <div
              className="seg control-seg"
              role="radiogroup"
              aria-label={t("Show audit log or permissions")}
              style={{ ["--n" as string]: 2, ["--idx" as string]: sideView === "audit" ? 0 : 1 }}
            >
              <span className="seg-lens" aria-hidden />
              {(
                [
                  ["audit", t("Audit log")],
                  ["permissions", t("Permissions")],
                ] as const
              ).map(([view, label]) => (
                <button key={view} type="button" role="radio" aria-checked={sideView === view} onClick={() => setSideView(view)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="control-views screen-pane space-y-6">
            <div className="control-perms screen-stack space-y-6">
              <PermissionsCard />

              <AgentPermissionsCard />
            </div>

            <Card
              id="audit"
              className="control-audit scroll-mt-28"
              title={t("Audit log")}
              subtitle={t("Latest 100 events, newest first")}
              action={
                <Button size="sm" variant="ghost" onClick={() => void audit.reload()} busy={audit.loading && !!audit.data}>
                  ↻ {t("Refresh")}
                </Button>
              }
            >
              <ErrorBox error={audit.error} title={t("Couldn't load audit log")} className="mb-3" />
              {audit.loading && !audit.data ? (
                <Loading />
              ) : audit.data && audit.data.events.length > 0 ? (
                <AuditList events={audit.data.events} variant="table" />
              ) : audit.error ? null : (
                <EmptyState>{t("No audit events yet.")}</EmptyState>
              )}
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PauseCard({ controls, onSaved }: { controls: UserControls; onSaved: (c: UserControls) => void }) {
  const t = useT();
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
            <h2 className="text-lg font-semibold tracking-tight">{paused ? t("Execution is paused") : t("Execution is active")}</h2>
          </div>
          <p className="mt-1 max-w-xl text-sm text-zinc-600 dark:text-zinc-400">
            {t("Pausing blocks execution of new and already-approved transfers. It does not undo completed ones.")}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">{t("Last changed {time}", { time: formatDateTime(controls.updatedAt) })}</p>
        </div>
        <Button
          size="lg"
          variant={paused ? "primary" : "danger"}
          busy={busy}
          onClick={() => void toggle()}
          aria-pressed={paused}
          className="w-full sm:w-auto"
        >
          {paused ? `▶ ${t("Resume")}` : `⏸ ${t("Pause all execution")}`}
        </Button>
      </div>
      <ErrorBox error={error} title={t("Couldn't change pause state")} className="mt-4" />
    </section>
  );
}

function LimitsCard({ controls, onSaved }: { controls: UserControls; onSaved: (c: UserControls) => void }) {
  const t = useT();
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
    const p = parseDollarsToCents(perTransfer, { allowZero: true, t });
    const d = parseDollarsToCents(daily, { allowZero: true, t });
    const errs: { perTransfer?: string; daily?: string } = {};
    if (!p.ok) errs.perTransfer = p.error;
    if (!d.ok) errs.daily = d.error;
    if (p.ok && d.ok && p.cents > d.cents) {
      errs.perTransfer = t("Per-transfer limit cannot exceed daily limit.");
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
    <Card title={t("Transfer limits")} subtitle={t("Proposals over a limit are held. Execution re-checks limits at run time.")}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div className="grid gap-4 sm:grid-cols-2">
          <DollarField
            id="limit-per"
            label={t("Per-transfer limit")}
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
            label={t("Daily limit")}
            value={daily}
            onChange={(v) => {
              setDaily(v);
              setSaved(false);
            }}
            error={fieldErrors.daily}
            current={controls.dailyLimitCents}
          />
        </div>
        <ErrorBox error={error} title={t("Limits not saved")} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="primary" busy={busy}>
            {t("Save limits")}
          </Button>
          {saved && <span className="text-sm text-green-700 dark:text-green-400">✓ {t("Saved")}</span>}
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
  const t = useT();
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
          {t("Current:")} <Money cents={current} />
        </p>
      )}
    </div>
  );
}

function UsageCard({ controls, executedTodayCents }: { controls: UserControls; executedTodayCents: number }) {
  const { t, tr } = useI18n();
  const limit = controls.dailyLimitCents;
  const pct = limit > 0 ? Math.min(100, (executedTodayCents / limit) * 100) : executedTodayCents > 0 ? 100 : 0;
  const remaining = Math.max(0, limit - executedTodayCents);
  const over = executedTodayCents > limit;
  return (
    <Card title={t("Today's usage")} subtitle={t("Simulated transfers executed today vs your daily limit")}>
      <p className="text-3xl font-semibold tracking-tight">
        <Money cents={executedTodayCents} />
        <span className="ml-2 text-base font-normal text-zinc-500 dark:text-zinc-400">
          {t("of")} <Money cents={limit} />
        </span>
      </p>
      <div
        className="mt-4 h-3 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={t("Daily limit used")}
      >
        <div
          className={`h-full rounded-full ${pct >= 100 ? "bg-red-500" : pct >= 75 ? "bg-amber-500" : "bg-brand-600 dark:bg-brand-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {over ? (
          <span className="text-red-700 dark:text-red-400">{t("Over the daily limit — further transfers will be held.")}</span>
        ) : (
          <>
            {tr("{remaining} left today · per-transfer limit {limit}", {
              remaining: <Money cents={remaining} className="font-medium text-zinc-900 dark:text-zinc-100" />,
              limit: <Money cents={controls.perTransferLimitCents} />,
            })}
          </>
        )}
      </p>
      {controls.paused && (
        <p className="mt-3">
          <Badge tone="red">{t("Paused — nothing will execute")}</Badge>
        </p>
      )}
    </Card>
  );
}

function PermissionsCard() {
  const t = useT();
  const can = [
    msg("Read your accounts and balances"),
    msg("Read your transactions"),
    msg("Read spending and subscription insights"),
    msg("Read your saved recipients"),
    msg("Create transfer proposals (which you review)"),
  ];
  const cannot = [
    msg("Approve a transfer"),
    msg("Execute a transfer"),
    msg("Change limits or pause/resume"),
    msg("Verify a recipient"),
  ];
  return (
    <Card title={t("Assistant permissions")} subtitle={t("Enforced on the server: the assistant simply has no tool for the things it can't do.")}>
      <div className="grid gap-6 sm:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-green-700 uppercase dark:text-green-400">{t("The assistant can")}</p>
          <ul className="space-y-1.5 text-sm">
            {can.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-green-600 dark:text-green-400" aria-hidden>
                  ✓
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-red-700 uppercase dark:text-red-400">{t("It cannot")}</p>
          <ul className="space-y-1.5 text-sm">
            {cannot.map((item) => (
              <li key={item} className="flex gap-2">
                <span className="text-red-600 dark:text-red-400" aria-hidden>
                  ✗
                </span>
                {t(item)}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Card>
  );
}

const SCOPE_LABELS: Record<string, string> = {
  accounts: msg("Accounts"),
  transactions: msg("Transactions"),
  recipients: msg("Recipients"),
  actions: msg("Transfer proposals"),
  portfolio: msg("Portfolio"),
  connections: msg("Bank connections"),
  insights: msg("Insights"),
  jobs: msg("Follow-up jobs"),
  connection_sync: msg("Connection sync"),
};

function YesNo({ value }: { value: boolean }) {
  const t = useT();
  return value ? <Badge tone="red">{t("Yes")}</Badge> : <Badge tone="green">{t("No")}</Badge>;
}

function AgentPermissionsCard() {
  const t = useT();
  const agents = useApiData<AgentsResponse>(paths.agents);
  const rows = agents.data?.permissions ?? [];
  return (
    <Card
      id="agents"
      className="scroll-mt-28"
      title={t("Monitoring agent permissions")}
      subtitle={t("Advisory — agents can't approve or move money. Each reads only its listed data and writes insights.")}
    >
      <ErrorBox error={agents.error} title={t("Couldn't load agent permissions")} className="mb-3" onRetry={() => void agents.reload()} />
      {agents.loading && !agents.data ? (
        <Loading label={t("Loading agent permissions…")} />
      ) : rows.length === 0 ? (
        <EmptyState>{t("No monitoring agents registered.")}</EmptyState>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="agent-matrix" aria-label={t("Agent permission matrix")}>
              <thead>
                <tr>
                  <th scope="col">{t("Agent")}</th>
                  <th scope="col">{t("Reads")}</th>
                  <th scope="col">{t("Writes")}</th>
                  <th scope="col">{t("Can approve")}</th>
                  <th scope="col">{t("Can execute")}</th>
                  <th scope="col">{t("Verify / controls")}</th>
                  <th scope="col">{t("Last run")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const def = agents.data?.agents.find((a) => a.id === p.agentId);
                  const reads = Object.entries(p.reads).filter(([, v]) => v).map(([k]) => t(SCOPE_LABELS[k] ?? k));
                  const writes = Object.entries(p.writes).filter(([, v]) => v).map(([k]) => t(SCOPE_LABELS[k] ?? k));
                  return (
                    <tr key={p.agentId}>
                      <th scope="row" className="min-w-52 font-medium">
                        <span className="flex items-start gap-2.5">
                          <AgentAvatar agentId={p.agentId} size={28} />
                          <span>
                            {t(p.name)}
                            {def && <span className="mt-0.5 block text-xs font-normal text-zinc-400">{t(def.trigger)}</span>}
                          </span>
                        </span>
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
                        {def?.lastRun ? `${t(def.lastRun.status)} · ${formatDateTime(def.lastRun.startedAt)}` : t("Never")}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {agents.data?.notice && <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">{t(agents.data.notice)}</p>}
        </>
      )}
    </Card>
  );
}
