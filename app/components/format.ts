import { identityT, type Translate } from "@/lib/i18n/translate";

/**
 * Formatting helpers. Money is integer cents everywhere; we only divide by 100
 * at the moment of display. Currency stays in US format in every language so
 * amounts read and parse the same everywhere; dates and plain numbers follow
 * the language chosen in Settings.
 */

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const usdSigned = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", signDisplay: "exceptZero" });
const usdWhole = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

let formatLocale = "en-US";

/** Set once by the I18nProvider; all date and number helpers below follow it. */
export function setFormatLocale(intl: string) {
  formatLocale = intl;
}

export function currentFormatLocale() {
  return formatLocale;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
function dateFormatter(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${formatLocale}|${JSON.stringify(options)}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(formatLocale, options);
    formatterCache.set(key, f);
  }
  return f;
}

/** Locale-aware date for anything that is not covered by the helpers below. */
export function formatDate(value: string | number | Date, options: Intl.DateTimeFormatOptions = {}): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : dateFormatter(options).format(d);
}

/** Locale-aware plain number (no currency). */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  return new Intl.NumberFormat(formatLocale, options).format(value);
}

/** $1,234.56 from 123456. `signed` adds +/− for non-zero values. */
export function formatCents(cents: number, opts: { signed?: boolean; whole?: boolean } = {}): string {
  if (!Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  if (opts.signed) return usdSigned.format(dollars).replace("-", "−");
  if (opts.whole) return usdWhole.format(dollars);
  return usd.format(dollars).replace("-", "−");
}

/** Plain decimal string for an input field: 123456 → "1234.56". */
export function centsToDollarInput(cents: number): string {
  if (!Number.isFinite(cents)) return "";
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(cents));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export type ParseCentsResult = { ok: true; cents: number } | { ok: false; error: string };

/**
 * Parse a user-typed dollar amount into integer cents.
 * Accepts "1850", "1,850.00", "$1850.5". Rejects more than 2 decimals,
 * non-numbers, and (unless allowZero) amounts <= 0.
 */
export function parseDollarsToCents(
  input: string,
  opts: { allowZero?: boolean; maxCents?: number; t?: Translate } = {},
): ParseCentsResult {
  const t = opts.t ?? identityT;
  const cleaned = input.trim().replace(/^\$/, "").replace(/,/g, "").trim();
  if (cleaned === "") return { ok: false, error: t("Enter an amount") };
  if (!/^\d*(\.\d*)?$/.test(cleaned) || cleaned === ".") return { ok: false, error: t("Enter a number like 1850 or 1850.00") };
  const decimals = cleaned.includes(".") ? cleaned.split(".")[1].length : 0;
  if (decimals > 2) return { ok: false, error: t("Use at most 2 decimal places") };
  const value = parseFloat(cleaned);
  if (!Number.isFinite(value)) return { ok: false, error: t("Enter a valid amount") };
  const cents = Math.round(value * 100);
  if (opts.allowZero ? cents < 0 : cents <= 0) {
    return { ok: false, error: opts.allowZero ? t("Amount can't be negative") : t("Amount must be greater than $0") };
  }
  const max = opts.maxCents ?? 100_000_000;
  if (cents > max) return { ok: false, error: t("Amount can't exceed {max}", { max: formatCents(max) }) };
  return { ok: true, cents };
}

function toDate(iso: string): Date | null {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}


/** Calendar date of a transaction ("Oct 3, 2026"). Uses UTC so it matches server month bucketing. */
export function formatTxnDate(iso: string, opts: { short?: boolean } = {}): string {
  const d = toDate(iso);
  if (!d) return iso;
  return dateFormatter(opts.short ? { month: "short", day: "numeric", timeZone: "UTC" } : { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(d);
}

/** Local timestamp ("Oct 3, 2:14 PM"). */
export function formatDateTime(iso: string | null | undefined, opts: { full?: boolean } = {}): string {
  if (!iso) return "—";
  const d = toDate(iso);
  if (!d) return iso;
  return dateFormatter(opts.full ? { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(d);
}

export function formatTime(iso: string): string {
  const d = toDate(iso);
  return d ? dateFormatter({ hour: "numeric", minute: "2-digit", second: "2-digit" }).format(d) : iso;
}

/** "2026-10" → "October 2026". */
export function formatMonth(ym: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return ym;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1));
  return dateFormatter({ month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}

export function formatPct(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return "—";
  const rounded = Number(value.toFixed(digits));
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)}%`;
}

/** "1234" or "••1234" → "••1234" (server sends some masks pre-bulleted, e.g. routingMask). */
export function mask(m: string | null | undefined): string {
  const digits = (m ?? "").replace(/^[•*·.\s]+/, "");
  return digits ? `••${digits}` : "—";
}

/** Compact one-line JSON for audit details, truncated. */
export function compactJson(value: unknown, max = 160): string {
  let s: string;
  try {
    s = JSON.stringify(value) ?? "";
  } catch {
    s = String(value);
  }
  if (s === "{}" || s === "") return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
