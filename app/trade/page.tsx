import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../components/Card";
import { TradeClient } from "./TradeClient";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return (
    <Suspense fallback={<Loading label="Loading trade…" />}>
      <TradeClient />
    </Suspense>
  );
}
