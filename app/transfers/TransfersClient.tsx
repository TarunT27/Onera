"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import type { TransferAction } from "@/lib/types";
import {
  paths,
  type AccountsResponse,
  type ActionsResponse,
  type ControlsResponse,
  type RecipientsResponse,
} from "../components/api";
import { PageHeader } from "../components/Card";
import { useApiData } from "../components/useApiData";
import { ActionDetail } from "./ActionDetail";
import { ActionList } from "./ActionList";
import { NewTransferForm } from "./NewTransferForm";

export function TransfersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get("id");

  const accounts = useApiData<AccountsResponse>(paths.accounts);
  const recipients = useApiData<RecipientsResponse>(paths.recipients);
  const actions = useApiData<ActionsResponse>(paths.actions);
  const controls = useApiData<ControlsResponse>(paths.controls);

  const select = useCallback(
    (id: string | null) => {
      router.replace(id ? `/transfers?id=${encodeURIComponent(id)}` : "/transfers", { scroll: false });
    },
    [router],
  );

  const reloadActions = actions.reload;
  const reloadRecipients = recipients.reload;
  const reloadAccounts = accounts.reload;
  const reloadControls = controls.reload;
  const reloadAll = useCallback(() => {
    void reloadActions();
    void reloadRecipients();
    void reloadAccounts();
    void reloadControls();
  }, [reloadActions, reloadRecipients, reloadAccounts, reloadControls]);

  function onCreated(action: TransferAction) {
    void actions.reload();
    select(action.id);
  }

  function closeDetail() {
    if (selectedId) document.getElementById(`transfer-list-${selectedId}`)?.focus({ preventScroll: true });
    select(null);
  }

  const paused = controls.data?.controls.paused === true;

  return (
    <div>
      <PageHeader
        title="Transfers"
        description="Every transfer is a proposal first. ClearFi checks it against your controls, you approve the exact version, and only then can it execute — as a simulation."
      />

      {paused && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
          <span>
            <strong>Execution is paused.</strong> No transfer can execute — including ones you already approved — until you
            resume.
          </span>
          <Link href="/control" className="font-medium underline underline-offset-2">
            Open Control
          </Link>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Detail first in the DOM so it leads on phones; placed in the right column on desktop. */}
        <div className={`min-w-0 lg:col-span-7 lg:col-start-6 lg:row-start-1 ${selectedId ? "" : "hidden lg:block"}`}>
          {selectedId ? (
            <ActionDetail key={selectedId} id={selectedId} onChanged={reloadAll} onClose={closeDetail} />
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
              <div>
                <p className="font-medium text-zinc-700 dark:text-zinc-300">Select a transfer to review</p>
                <p className="mt-1">Policy checks, recipient changes, approval and the simulated receipt appear here.</p>
              </div>
            </div>
          )}
        </div>

        <div className="min-w-0 space-y-6 lg:col-span-5 lg:col-start-1 lg:row-start-1">
          <NewTransferForm
            accounts={accounts.data?.accounts ?? null}
            accountsError={accounts.error}
            accountsLoading={accounts.loading}
            recipients={recipients.data?.recipients ?? null}
            recipientsError={recipients.error}
            recipientsLoading={recipients.loading}
            onRetryAccounts={() => void accounts.reload()}
            onRetryRecipients={() => void recipients.reload()}
            onCreated={onCreated}
          />
          <ActionList
            actions={actions.data?.actions ?? null}
            loading={actions.loading && !actions.data}
            error={actions.error}
            selectedId={selectedId}
            onSelect={select}
            onRefresh={() => void actions.reload()}
          />
        </div>
      </div>
    </div>
  );
}
