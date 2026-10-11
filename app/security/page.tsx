import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { SecurityClient } from "./SecurityClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Security") };
}

export default function SecurityPage() {
  return <SecurityClient />;
}
