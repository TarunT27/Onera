import { NextResponse } from "next/server";
import { handler } from "@/lib/http";
import { listInstruments, SIMULATED_MARKET_STATUS, SIMULATED_PRICES_DISCLAIMER } from "@/lib/markets";

/** Supported stocks and ETFs. Public catalog data; no user records. */
export const GET = handler(async () =>
  NextResponse.json({
    instruments: listInstruments(),
    market: { status: "open", label: SIMULATED_MARKET_STATUS },
    disclaimer: SIMULATED_PRICES_DISCLAIMER,
  }),
);
