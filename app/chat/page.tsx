import type { Metadata } from "next";
import { ChatClient } from "./ChatClient";

export const metadata: Metadata = { title: "Ask Onera" };

export default function ChatPage() {
  return <ChatClient />;
}
