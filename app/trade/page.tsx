import type { Metadata } from "next";
import { TradeClient } from "./TradeClient";

export const metadata: Metadata = { title: "Trade" };

export default function TradePage() {
  return <TradeClient />;
}
