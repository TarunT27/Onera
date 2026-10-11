import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { FamilyClient } from "./FamilyClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Family") };
}

export default function FamilyPage() {
  return <FamilyClient />;
}
