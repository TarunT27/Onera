import type { Metadata } from "next";
import { getServerT } from "@/lib/i18n/server";
import { ChatClient } from "./ChatClient";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getServerT();
  return { title: t("Ask Onera") };
}

export default function ChatPage() {
  return <ChatClient />;
}
