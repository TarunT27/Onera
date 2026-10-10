/** Shares ↔ micro-shares (shares × 1,000,000) without floating-point drift. */

export type ParseSharesResult = { ok: true; micros: number } | { ok: false; error: string };

const MIN_MICROS = 1_000; // 0.001 shares
const MAX_MICROS = 1_000_000_000_000; // 1,000,000 shares

export function parseSharesToMicros(input: string): ParseSharesResult {
  const cleaned = input.trim().replace(/,/g, "");
  if (cleaned === "") return { ok: false, error: "Enter a number of shares" };
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === ".") return { ok: false, error: "Enter shares like 2 or 0.5" };
  const [whole = "", frac = ""] = cleaned.split(".");
  if (frac.length > 3) return { ok: false, error: "Use at most 3 decimal places" };
  const micros = Number(whole || "0") * 1_000_000 + Number(frac.padEnd(6, "0"));
  if (!Number.isSafeInteger(micros)) return { ok: false, error: "Too many shares" };
  if (micros < MIN_MICROS) return { ok: false, error: "Minimum is 0.001 shares" };
  if (micros > MAX_MICROS) return { ok: false, error: "Maximum is 1,000,000 shares" };
  return { ok: true, micros };
}

/** Display only. */
export function formatShares(micros: number): string {
  return (micros / 1_000_000).toLocaleString("en-US", { maximumFractionDigits: 3 });
}
