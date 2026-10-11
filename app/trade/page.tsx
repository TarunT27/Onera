import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { msg } from "@/lib/i18n/msg";
import { Suspense } from "react";
import { Loading } from "../components/Card";
import { TradeClient } from "./TradeClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Trade") };
}

export default function TradePage() {
  return (
    <Suspense fallback={<Loading label={msg("Loading trade…")} />}>
      <TradeClient />
    </Suspense>
  );
}
