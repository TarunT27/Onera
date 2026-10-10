import type { CurrencyCode, FxRate } from "@/lib/types";
import { formatCents } from "@/lib/finance/money";
import { displayUsdCents } from "./presentation";

export function CurrencyValue({ cents, currency, rates }: { cents: number; currency: CurrencyCode; rates: FxRate[] }) {
  const usd = displayUsdCents(cents, currency, rates);
  return (
    <span className="currency-value">
      <span>{formatCents(cents, currency)}</span>
      {currency !== "USD" && (
        <small className="currency-equivalent">
          {usd === null ? "USD equivalent unavailable" : `≈ ${formatCents(usd)} USD`}
        </small>
      )}
    </span>
  );
}
