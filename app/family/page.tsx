import type { Metadata } from "next";
import { FamilyClient } from "./FamilyClient";

export const metadata: Metadata = { title: "Family" };

export default function FamilyPage() {
  return <FamilyClient />;
}
