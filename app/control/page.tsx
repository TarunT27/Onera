import type { Metadata } from "next";
import { ControlClient } from "./ControlClient";

export const metadata: Metadata = { title: "Control" };

export default function ControlPage() {
  return <ControlClient />;
}
