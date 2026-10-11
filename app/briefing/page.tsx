import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { BriefingClient } from "./BriefingClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Personal assistant") };
}

export default function BriefingPage() {
  return <BriefingClient />;
}
