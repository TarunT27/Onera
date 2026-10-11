import type { Metadata } from "next";
import { BriefingClient } from "./BriefingClient";

export const metadata: Metadata = { title: "Personal assistant" };

export default function BriefingPage() {
  return <BriefingClient />;
}
