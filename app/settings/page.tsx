import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { SettingsClient } from "./SettingsClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Settings") };
}

export default function SettingsPage() {
  return <SettingsClient />;
}
