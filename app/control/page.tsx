import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { ControlClient } from "./ControlClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Control") };
}

export default function ControlPage() {
  return <ControlClient />;
}
