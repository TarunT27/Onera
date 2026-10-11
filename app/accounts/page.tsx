import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { Suspense } from "react";
import { AccountsClient } from "./AccountsClient";
import { Loading } from "../components/Card";
export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Accounts") };
}
export default function AccountsPage() {
  return (
    <Suspense fallback={<Loading />}>
      <AccountsClient />
    </Suspense>
  );
}
