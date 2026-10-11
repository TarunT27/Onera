import type { CurrencyCode, FxRate } from "@/lib/types";
import { formatCents } from "@/lib/finance/money";
import { displayUsdCents } from "./presentation";
import { useT } from "../components/I18nContext";

export function CurrencyValue({ cents, currency, rates }: { cents: number; currency: CurrencyCode; rates: FxRate[] }) {
  const t = useT();
  const usd = displayUsdCents(cents, currency, rates);
  return (
    <span className="currency-value">
      <span>{formatCents(cents, currency)}</span>
      {currency !== "USD" && (
        <small className="currency-equivalent">
          {usd === null ? t("USD equivalent unavailable") : `≈ ${formatCents(usd)} USD`}
        </small>
      )}
    </span>
  );
}
