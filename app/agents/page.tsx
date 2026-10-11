import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { AgentsClient } from "./AgentsClient";
import "./agents.css";
import "./agents-screen.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Agents") };
}

export default function AgentsPage() {
  return <AgentsClient />;
}
