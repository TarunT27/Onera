"use client";

/**
 * AI monitoring panel: persisted findings from the deterministic monitoring
 * agents (GET /api/agents/insights). Advisory only — the panel can run the
 * read-only monitors and mark findings seen/dismissed. It has no path that
 * approves, executes, verifies or changes controls.
 */
import Link from "next/link";
import { useState } from "react";
import { ShieldCheck } from "@phosphor-icons/react";
import { msg } from "@/lib/i18n/msg";
import type { Account, Transaction, TransferAction } from "@/lib/types";
import {
  clearfi,
  paths,
  type AgentInsight,
  type AgentInsightsResponse,
  type AgentsResponse,
  type TransactionsResponse,
} from "./api";
import { AgentAvatar } from "./AgentAvatar";
import { SyntheticLabel } from "./Badge";
import { Button } from "./Button";
import { Loading } from "./Card";
import { ErrorBox } from "./ErrorBox";
import { useI18n } from "./I18nContext";
import { InsightCard } from "./InsightCard";
import { useApiData } from "./useApiData";
import { formatTxnDate } from "./format";
import { formatCents } from "@/lib/finance/money";

export const MONITORING_ADVISORY = msg("Advisory — agents can't approve or move money");

/** "threat_monitor" → "Threat monitor", until the registry has loaded. */
const fallbackName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1).replace(/_/g, " ");

export function MonitoringPanel({
  accounts = [],
  actions = [],
}: {
  /** Already-loaded records, used only to label evidence links. */
  accounts?: Account[];
  actions?: TransferAction[];
}) {
  const { t, tp } = useI18n();
  const insights = useApiData<AgentInsightsResponse>(paths.agentInsights);
  const agents = useApiData<AgentsResponse>(paths.agents);
  const needsTxns = (insights.data?.insights ?? []).some((i) => (i.evidence.transactionIds?.length ?? 0) > 0);
  const txns = useApiData<TransactionsResponse>(needsTxns ? paths.transactions({ limit: 500 }) : null);

  const [running, setRunning] = useState(false);
  const [runSummary, setRunSummary] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const agentName = (id: string) => t(agents.data?.agents.find((a) => a.id === id)?.name ?? fallbackName(id));
  const txnById = new Map<string, Transaction>((txns.data?.transactions ?? []).map((tx) => [tx.id, tx]));
  const list = insights.data?.insights ?? [];
  const newCount = list.filter((i) => i.status === "new").length;

  // One chip per agent with findings, in order of first appearance.
  const byAgent = new Map<string, number>();
  for (const i of list) byAgent.set(i.agentId, (byAgent.get(i.agentId) ?? 0) + 1);
  const active = filter && byAgent.has(filter) ? filter : null;
  const shown = active ? list.filter((i) => i.agentId === active) : list;
  const roster = agents.data?.agents ?? [];

  async function runAgents() {
    setRunning(true);
    setError(null);
    setRunSummary(null);
    try {
      const res = await clearfi.runAgents();
      const r = res.report;
      const parts = [
        tp(r.processed, "Processed {n} job", "Processed {n} jobs"),
        t("{count} succeeded", { count: r.succeeded }),
        r.failed ? t("{count} failed (will retry)", { count: r.failed }) : "",
        r.dead ? t("{count} dead-lettered", { count: r.dead }) : "",
      ];
      setRunSummary(parts.filter(Boolean).join(" · "));
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
          <div className="monitoring-title-row">
            <h2 id="monitoring-heading">{t("AI monitoring")}</h2>
            {newCount > 0 && <span className="monitoring-count">{t("{count} new", { count: newCount })}</span>}
          </div>
          <p className="monitoring-advisory">
            <ShieldCheck size={16} weight="fill" aria-hidden />
            {t(MONITORING_ADVISORY)}
          </p>
          <p className="monitoring-meta">
            <SyntheticLabel />
            {t("Rule-based checks · no model")}
          </p>
        </div>
        <button type="button" className="pill small" onClick={() => void runAgents()} disabled={running}>
          {running ? t("Running agents…") : t("Run monitoring agents")}
        </button>
      </header>
      <div className="insight-body">
        {runSummary && (
          <p role="status" className="monitoring-status">
            {runSummary}
          </p>
        )}
        <ErrorBox error={error} className="mb-4" onDismiss={() => setError(null)} />
        <ErrorBox
          error={insights.error}
          title={t("Couldn't load agent insights")}
          className="mb-4"
          onRetry={() => void insights.reload()}
        />
        {insights.loading && !insights.data ? (
          <Loading label={t("Loading agent insights…")} />
        ) : list.length === 0 ? (
          <div className="monitoring-empty">
            {roster.length > 0 && (
              <span className="agent-stack" aria-hidden>
                {roster.map((a) => (
                  <AgentAvatar key={a.id} agentId={a.id} size={28} />
                ))}
              </span>
            )}
            <p>{t("No open findings. Run the monitoring agents to review your synthetic accounts.")}</p>
          </div>
        ) : (
          <>
            {byAgent.size > 1 && (
              <div className="agent-filter" role="group" aria-label={t("Filter findings by agent")}>
                <button type="button" aria-pressed={active === null} onClick={() => setFilter(null)}>
                  {t("All")} <span className="agent-filter-count">{list.length}</span>
                </button>
                {[...byAgent].map(([id, n]) => (
                  <button key={id} type="button" aria-pressed={active === id} onClick={() => setFilter(id)}>
                    <AgentAvatar agentId={id} size={20} />
                    {agentName(id)} <span className="agent-filter-count">{n}</span>
                  </button>
                ))}
              </div>
            )}
            <ul className="monitoring-list" aria-label={t("Agent insights")}>
              {shown.map((i) => (
                <InsightCard
                  key={i.id}
                  insight={i}
                  agentName={agentName(i.agentId)}
                  evidenceCount={evidenceCount(i)}
                  evidence={<Evidence insight={i} txnById={txnById} accounts={accounts} actions={actions} />}
                  actions={
                    <>
                      {i.status === "new" && (
                        <Button
                          size="sm"
                          disabled={busyId !== null}
                          busy={busyId === i.id}
                          onClick={() => void mark(i, "seen")}
                        >
                          {t("Mark seen")}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId !== null}
                        onClick={() => void mark(i, "dismissed")}
                        aria-label={t("Dismiss: {title}", { title: i.title })}
                      >
                        {t("Dismiss")}
                      </Button>
                    </>
                  }
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function evidenceCount(i: AgentInsight): number {
  const e = i.evidence;
  return (
    (e.transactionIds?.length ?? 0) +
    (e.actionIds?.length ?? 0) +
    (e.accountIds?.length ?? 0) +
    (e.symbols?.length ?? 0) +
    (e.connectionIds?.length ?? 0)
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
  const { t } = useI18n();
  const e = insight.evidence;
  const txIds = e.transactionIds ?? [];
  const actionIds = e.actionIds ?? [];
  const accountIds = e.accountIds ?? [];
  const symbols = e.symbols ?? [];
  const connectionIds = e.connectionIds ?? [];
  const fallbackAccount = accountIds.length === 1 ? accountIds[0] : null;
  return (
    <ul>
      {actionIds.map((id) => {
        const a = actions.find((x) => x.id === id);
        return (
          <li key={id}>
            <Link href={`/transfers?id=${encodeURIComponent(id)}`}>
              {a ? t("Transfer · {amount} to {name}", { amount: formatCents(a.amountCents), name: a.destination.displayName }) : t("Transfer {id}", { id })}
            </Link>
          </li>
        );
      })}
      {txIds.map((id) => {
        const txn = txnById.get(id);
        const accountId = txn?.accountId ?? fallbackAccount;
        const label = txn
          ? `${formatTxnDate(txn.postedAt, { short: true })} · ${txn.merchant ?? txn.description}`
          : t("Transaction {id}", { id });
        return (
          <li key={id}>
            {accountId ? (
              <Link href={`/accounts?id=${encodeURIComponent(accountId)}&view=activity`}>{label}</Link>
            ) : (
              <span>{label}</span>
            )}
            {txn && <span className="tabular-nums">{formatCents(txn.amountCents, txn.currency)}</span>}
          </li>
        );
      })}
      {accountIds.map((id) => {
        const acct = accounts.find((x) => x.id === id);
        return (
          <li key={id}>
            <Link href={`/accounts?id=${encodeURIComponent(id)}`}>
              {acct ? t("Account · {name} ••{mask}", { name: acct.name, mask: acct.mask }) : t("Account {id}", { id })}
            </Link>
          </li>
        );
      })}
      {symbols.map((s) => (
        <li key={s}>
          <span>{t("Symbol · {symbol} (simulated price)", { symbol: s })}</span>
        </li>
      ))}
      {connectionIds.map((id) => (
        <li key={id}>
          <Link href="/accounts">{t("Bank connection {id}", { id })}</Link>
        </li>
      ))}
    </ul>
  );
}
