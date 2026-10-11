import type { Metadata } from "next";
import { Suspense } from "react";
import { getServerT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/msg";
import { Loading } from "../components/Card";
import { TransfersClient } from "./TransfersClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Transfers") };
}

export default function TransfersPage() {
  return (
    <Suspense fallback={<Loading label={msg("Loading transfers…")} />}>
      <TransfersClient />
    </Suspense>
  );
}
