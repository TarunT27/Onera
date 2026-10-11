import type { Metadata } from "next";
import { AgentsClient } from "./AgentsClient";
import "./agents.css";
import "./agents-screen.css";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsClient />;
}
