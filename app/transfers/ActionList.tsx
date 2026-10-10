"use client";

import type { TransferAction } from "@/lib/types";
import { ActionStateBadge, CreatorBadge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading } from "../components/Card";
import { BankLogo } from "../components/BankLogo";
import { ErrorBox } from "../components/ErrorBox";
import { formatDateTime, mask } from "../components/format";
import { Money } from "../components/Money";

export function ActionList({
  actions,
  loading,
  error,
  selectedId,
  onSelect,
  onRefresh,
}: {
  actions: TransferAction[] | null;
  loading: boolean;
  error: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onRefresh: () => void;
}) {
  return (
    <Card
      title="Your transfers"
      subtitle="Created by you or proposed by the assistant"
      action={
        <Button size="sm" variant="ghost" onClick={onRefresh}>
          ↻ Refresh
        </Button>
      }
    >
      <ErrorBox error={error} title="Couldn't load transfers" className="mb-3" />
      {loading ? (
        <Loading />
      ) : !actions || actions.length === 0 ? (
        <EmptyState>No transfers yet. Create one above or ask the assistant to propose one.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {actions.map((a) => {
            const selected = a.id === selectedId;
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => onSelect(a.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`w-full rounded-xl border p-3 text-left transition-colors ${
                    selected
                      ? "border-brand-500 bg-brand-50/60 ring-1 ring-brand-500 dark:border-brand-600 dark:bg-brand-950/40 dark:ring-brand-600"
                      : "border-zinc-200 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:border-zinc-700 dark:hover:bg-zinc-800/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <BankLogo institution={a.destination.institution} size={32} className="mr-2" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{a.destination.displayName}</p>
                      <p className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                        {a.destination.institution} {mask(a.destination.accountMask)}
                        {a.memo ? ` · ${a.memo}` : ""}
                      </p>
                    </div>
                    <Money cents={a.amountCents} className="shrink-0 font-semibold" />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                    <ActionStateBadge state={a.state} />
                    <CreatorBadge createdBy={a.createdBy} />
                    <span className="tabular-nums">v{a.version}</span>
                    <span aria-hidden>·</span>
                    <span>{formatDateTime(a.createdAt)}</span>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
