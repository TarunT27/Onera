"use client";

/**
 * AI monitoring panel: persisted findings from the deterministic monitoring
 * agents (GET /api/agents/insights). Advisory only — the panel can run the
 * read-only monitors and mark findings seen/dismissed. It has no path that
 * approves, executes, verifies or changes controls.
 */
import Link from "next/link";
import { useState } from "react";
import { Info, ShieldCheck, Warning, WarningOctagon } from "@phosphor-icons/react";
import type { Account, Transaction, TransferAction } from "@/lib/types";
import {
  clearfi,
  paths,
  type AgentInsight,
  type AgentInsightsResponse,
  type AgentsResponse,
  type TransactionsResponse,
} from "./api";
import { Badge, type BadgeTone } from "./Badge";
import { Button } from "./Button";
import { Loading } from "./Card";
import { ErrorBox } from "./ErrorBox";
import { useApiData } from "./useApiData";
import { formatTxnDate } from "./format";
import { formatCents } from "@/lib/finance/money";

export const MONITORING_ADVISORY = "Advisory — agents can't approve or move money";

export const SEVERITY: Record<AgentInsight["severity"], { tone: BadgeTone; label: string; Icon: typeof Info }> = {
  critical: { tone: "red", label: "Critical", Icon: WarningOctagon },
  warning: { tone: "amber", label: "Warning", Icon: Warning },
  info: { tone: "blue", label: "Info", Icon: Info },
};

export function MonitoringPanel({
  accounts = [],
  actions = [],
}: {
  /** Already-loaded records, used only to label evidence links. */
  accounts?: Account[];
  actions?: TransferAction[];
}) {
  const insights = useApiData<AgentInsightsResponse>(paths.agentInsights);
  const agents = useApiData<AgentsResponse>(paths.agents);
  const needsTxns = (insights.data?.insights ?? []).some((i) => (i.evidence.transactionIds?.length ?? 0) > 0);
  const txns = useApiData<TransactionsResponse>(needsTxns ? paths.transactions({ limit: 500 }) : null);

  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const agentName = (id: string) => agents.data?.agents.find((a) => a.id === id)?.name ?? id;
  const txnById = new Map<string, Transaction>((txns.data?.transactions ?? []).map((t) => [t.id, t]));
  const list = insights.data?.insights ?? [];
  const newCount = list.filter((i) => i.status === "new").length;

  async function runAgents() {
    setRunning(true);
    setError(null);
    setRunSummary(null);
    try {
      const res = await clearfi.runAgents();
      const r = res.report;
      const extra = [r.failed ? `${r.failed} failed (will retry)` : "", r.dead ? `${r.dead} dead-lettered` : ""]
        .filter(Boolean)
        .join(" · ");
      setRunSummary(
        `Processed ${r.processed} job${r.processed === 1 ? "" : "s"} · ${r.succeeded} succeeded${extra ? ` · ${extra}` : ""}`,
      );
      insights.setData({ insights: res.insights });
      void agents.reload();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  }

  async function mark(insight: AgentInsight, status: "seen" | "dismissed") {
    setBusyId(insight.id);
    setError(null);
    try {
      const { insight: next } = await clearfi.setInsightStatus(insight.id, status);
      insights.setData({
        insights: list.flatMap((i) => (i.id !== insight.id ? [i] : status === "dismissed" ? [] : [next])),
      });
    } catch (e) {
      setError(e);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="surface monitoring-panel" aria-labelledby="monitoring-heading">
      <header className="surface-head monitoring-head">
        <div className="min-w-0">
          <h2 id="monitoring-heading">AI monitoring</h2>
          <p className="monitoring-advisory">
            <ShieldCheck size={17} weight="fill" aria-hidden />
            {MONITORING_ADVISORY}
          </p>
        </div>
        <button type="button" className="pill small" onClick={() => void runAgents()} disabled={running}>
          {running ? "Running agents…" : "Run monitoring agents"}
        </button>
      </header>
      <div className="insight-body">
        <p className="row-meta !mt-0 mb-4">
          Deterministic rules over your synthetic data; no model is called. Findings cite the records behind them.
          {newCount > 0 && ` ${newCount} new.`}
        </p>
        {runSummary && (
          <p role="status" className="monitoring-status">
            {runSummary}
          </p>
        )}
        <ErrorBox error={error} className="mb-4" onDismiss={() => setError(null)} />
        <ErrorBox
          error={insights.error}
          title="Couldn't load agent insights"
          className="mb-4"
          onRetry={() => void insights.reload()}
        />
        {insights.loading && !insights.data ? (
          <Loading label="Loading agent insights…" />
        ) : list.length === 0 ? (
          <p className="monitoring-empty">
            No open findings. Run the monitoring agents to review your synthetic accounts.
          </p>
        ) : (
          <ul className="monitoring-list" aria-label="Agent insights">
            {list.map((i) => {
              const sev = SEVERITY[i.severity] ?? SEVERITY.info;
              const busy = busyId === i.id;
              return (
                <li key={i.id} className={`monitoring-item sev-${i.severity}`}>
                  <article aria-labelledby={`insight-${i.id}`}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={sev.tone}>
                        <sev.Icon size={13} weight="fill" aria-hidden />
                        {sev.label}
                      </Badge>
                      {i.status === "new" ? <Badge tone="brand">New</Badge> : <Badge tone="gray">Seen</Badge>}
                      <span className="text-xs text-zinc-400">{agentName(i.agentId)}</span>
                    </div>
                    <h3 id={`insight-${i.id}`} className="monitoring-title">
                      {i.title}
                    </h3>
                    <p className="monitoring-body">{i.body}</p>
                    <Evidence insight={i} txnById={txnById} accounts={accounts} actions={actions} />
                    <div className="mt-3 flex flex-wrap gap-2">
                      {i.status === "new" && (
                        <Button size="sm" disabled={busyId !== null} busy={busy} onClick={() => void mark(i, "seen")}>
                          Mark seen
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId !== null}
                        onClick={() => void mark(i, "dismissed")}
                        aria-label={`Dismiss: ${i.title}`}
                      >
                        Dismiss
                      </Button>
                    </div>
                  </article>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

function Evidence({
  insight,
  txnById,
  accounts,
  actions,
}: {
  insight: AgentInsight;
  txnById: Map<string, Transaction>;
  accounts: Account[];
  actions: TransferAction[];
}) {
  const e = insight.evidence;
  const txIds = e.transactionIds ?? [];
  const actionIds = e.actionIds ?? [];
  const accountIds = e.accountIds ?? [];
  const symbols = e.symbols ?? [];
  const connectionIds = e.connectionIds ?? [];
  const total = txIds.length + actionIds.length + accountIds.length + symbols.length + connectionIds.length;
  if (total === 0) return null;
  const fallbackAccount = accountIds.length === 1 ? accountIds[0] : null;
  return (
    <details className="monitoring-evidence">
      <summary>Evidence ({total})</summary>
      <ul>
        {actionIds.map((id) => {
          const a = actions.find((x) => x.id === id);
          return (
            <li key={id}>
              <Link href={`/transfers?id=${encodeURIComponent(id)}`}>
                {a ? `Transfer · ${formatCents(a.amountCents)} to ${a.destination.displayName}` : `Transfer ${id}`}
              </Link>
            </li>
          );
        })}
        {txIds.map((id) => {
          const t = txnById.get(id);
          const accountId = t?.accountId ?? fallbackAccount;
          const label = t
            ? `${formatTxnDate(t.postedAt, { short: true })} · ${t.merchant ?? t.description}`
            : `Transaction ${id}`;
          return (
            <li key={id}>
              {accountId ? (
                <Link href={`/accounts?id=${encodeURIComponent(accountId)}&view=activity`}>{label}</Link>
              ) : (
                <span>{label}</span>
              )}
              {t && <span className="tabular-nums">{formatCents(t.amountCents, t.currency)}</span>}
            </li>
          );
        })}
        {accountIds.map((id) => {
          const acct = accounts.find((x) => x.id === id);
          return (
            <li key={id}>
              <Link href={`/accounts?id=${encodeURIComponent(id)}`}>
                {acct ? `Account · ${acct.name} ••${acct.mask}` : `Account ${id}`}
              </Link>
            </li>
          );
        })}
        {symbols.map((s) => (
          <li key={s}>
            <span>Symbol · {s} (simulated price)</span>
          </li>
        ))}
        {connectionIds.map((id) => (
          <li key={id}>
            <Link href="/accounts">Bank connection {id}</Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
