/** Shares ↔ micro-shares (shares × 1,000,000) without floating-point drift. */

import { identityT, type Translate } from "@/lib/i18n/translate";
import { formatNumber } from "../components/format";

export type ParseSharesResult = { ok: true; micros: number } | { ok: false; error: string };

const MIN_MICROS = 1_000; // 0.001 shares
const MAX_MICROS = 1_000_000_000_000; // 1,000,000 shares

export function parseSharesToMicros(input: string, t: Translate = identityT): ParseSharesResult {
  const cleaned = input.trim().replace(/,/g, "");
  if (cleaned === "") return { ok: false, error: t("Enter a number of shares") };
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === ".") return { ok: false, error: t("Enter shares like 2 or 0.5") };
  const [whole = "", frac = ""] = cleaned.split(".");
  if (frac.length > 3) return { ok: false, error: t("Use at most 3 decimal places") };
  const micros = Number(whole || "0") * 1_000_000 + Number(frac.padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) return { ok: false, error: t("Too many shares") };
  if (micros < MIN_MICROS) return { ok: false, error: t("Minimum is 0.001 shares") };
  if (micros > MAX_MICROS) return { ok: false, error: t("Maximum is 1,000,000 shares") };
  return { ok: true, micros };
}

/** Display only. */
export function formatShares(micros: number): string {
  return formatNumber(micros / 1_000_000, { maximumFractionDigits: 3 });
}
