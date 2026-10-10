import type { Metadata } from "next";
import { Suspense } from "react";
import { Loading } from "../components/Card";
import { TransfersClient } from "./TransfersClient";

export const metadata: Metadata = { title: "Transfers" };

export default function TransfersPage() {
  return (
    <Suspense fallback={<Loading label="Loading transfers…" />}>
      <TransfersClient />
    </Suspense>
  );
}
