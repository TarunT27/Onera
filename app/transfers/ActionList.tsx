"use client";

import { ArrowClockwise, Plus } from "@phosphor-icons/react";
import type { Account, TransferAction } from "@/lib/types";
import { ActionStateBadge, Badge } from "../components/Badge";
import { Button } from "../components/Button";
import { Card, EmptyState, Loading } from "../components/Card";
import { BankLogo } from "../components/BankLogo";
import { ErrorBox } from "../components/ErrorBox";
import { formatDateTime } from "../components/format";
import { Money } from "../components/Money";
import { shortInstitution, shortRecipientName } from "./accountLabels";

export function ActionList({
  actions,
  accounts,
  loading,
  error,
  selectedId,
  onSelect,
  onNew,
  onRefresh,
}: {
  actions: TransferAction[] | null;
  accounts: Account[] | null;
  loading: boolean;
  error: unknown;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** Shown while a transfer is open, to go back to the composer. */
  onNew?: () => void;
  onRefresh: () => void;
}) {
  const accountById = new Map((accounts ?? []).map((a) => [a.id, a]));
  return (
    <Card
      title="Recent transfers"
      action={
        <div className="flex items-center gap-1">
          {onNew && (
            <Button size="sm" variant="secondary" onClick={onNew}>
              <Plus size={14} weight="bold" aria-hidden /> New transfer
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onRefresh} aria-label="Refresh transfers">
            <ArrowClockwise size={14} weight="bold" aria-hidden />
          </Button>
        </div>
      }
    >
      <ErrorBox error={error} title="Couldn't load transfers" className="mb-3" />
      {loading ? (
        <Loading />
      ) : error && !actions ? null : !actions || actions.length === 0 ? (
        <EmptyState>No transfers yet. Move some money or ask the assistant to propose one.</EmptyState>
      ) : (
        <ul className="-mx-2 space-y-0.5">
          {actions.map((a) => {
            const selected = a.id === selectedId;
            const source = accountById.get(a.sourceAccountId);
            return (
              <li key={a.id}>
                <button
                  id={`transfer-list-${a.id}`}
                  type="button"
                  onClick={() => onSelect(a.id)}
                  aria-current={selected ? "true" : undefined}
                  className={`flex w-full items-center gap-3 rounded-2xl px-2 py-2.5 text-left transition-colors ${
                    selected ? "bg-white/[0.09] shadow-[inset_0_0_0_1px_rgb(140_185_204/0.35)]" : "hover:bg-white/[0.05]"
                  }`}
                >
                  <BankLogo institution={a.destination.institution} size={18} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-zinc-50">{shortRecipientName(a.destination.displayName)}</span>
                    <span className="block truncate text-xs text-white/45">
                      {source ? `from ${source.name} · ${shortInstitution(source.institution)}` : formatDateTime(a.createdAt)}
                      {a.memo ? ` · ${a.memo}` : ""}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <Money cents={a.amountCents} className="text-sm font-semibold text-zinc-50" />
                    <span className="flex items-center gap-1">
                      {a.createdBy === "assistant" && (
                        <Badge tone="violet" title="Proposed by the Onera assistant">
                          AI
                        </Badge>
                      )}
                      <ActionStateBadge state={a.state} />
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
