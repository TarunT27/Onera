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
import "./transfers-screen.css";

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
    <div className="screen transfers-screen">
      <div className="screen-title tf-title">
        <PageHeader
          title="Transfers"
          description="Move money between your banks and Onera in a couple of taps. Onera checks every transfer against your limits and sends nothing without your OK. All money here is simulated."
        />
      </div>

      {paused && (
        <div className="tf-paused mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-red-400/10 px-4 py-3 text-sm text-red-100 shadow-[inset_0_0_0_1px_rgb(248_113_113/0.25)]">
          <span>
            <strong>Transfers are paused.</strong> Even approved transfers can’t be sent until you resume.
          </span>
          <Link href="/control" className="font-medium underline underline-offset-2">
            Open Control
          </Link>
        </div>
      )}

      <div className="screen-body tf-body grid items-start gap-6 lg:grid-cols-12">
        {/* One working area: the composer, or the transfer you're reviewing. */}
        <div className="screen-pane tf-work min-w-0 lg:col-span-7">
          {selectedId ? (
            <ActionDetail key={selectedId} id={selectedId} onChanged={reloadAll} onClose={closeDetail} />
          ) : (
            <NewTransferForm
              initialSourceId={searchParams.get("source") ?? undefined}
              accounts={accounts.data?.accounts ?? null}
              accountsError={accounts.error}
              accountsLoading={accounts.loading}
              recipients={recipients.data?.recipients ?? null}
              recipientsError={recipients.error}
              recipientsLoading={recipients.loading}
              perTransferLimitCents={controls.data?.controls.perTransferLimitCents ?? null}
              onRetryAccounts={() => void accounts.reload()}
              onRetryRecipients={() => void recipients.reload()}
              onCreated={onCreated}
            />
          )}
        </div>

        <div className="tf-list min-w-0 lg:col-span-5">
          <ActionList
            actions={actions.data?.actions ?? null}
            accounts={accounts.data?.accounts ?? null}
            loading={actions.loading && !actions.data}
            error={actions.error}
            selectedId={selectedId}
            onSelect={select}
            onNew={selectedId ? () => select(null) : undefined}
            onRefresh={() => void actions.reload()}
          />
        </div>
      </div>
    </div>
  );
}
