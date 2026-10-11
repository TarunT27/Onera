/**
 * Deterministic redaction of sensitive patterns. Applied before anything from a
 * chat turn is persisted (audit text, security-event excerpts) and before an
 * excerpt is shown to the optional AI reviewer. Also used by the output gate to
 * detect sensitive data in a draft reply.
 *
 * Pattern matching is fallible: it catches the defined shapes below, not every
 * possible secret. Keep secrets out of model context in the first place.
 */

export interface SensitivePattern {
  id: string;
  /** Plain-words description for findings. */
  label: string;
  pattern: RegExp;
  /** Replacement text. Digit runs keep their last four digits. */
  replace: (match: string) => string;
}

const mask = (label: string) => () => `[redacted ${label}]`;
const keepLast4 = (m: string) => `[redacted number ••${m.replace(/\D/g, "").slice(-4)}]`;

/** Synthetic canary prefix used by tests and demos. Never a real secret. */
export const SYNTHETIC_SECRET_PREFIX = "ONERA-CANARY-";

export const SENSITIVE_PATTERNS: readonly SensitivePattern[] = [
  {
    id: "synthetic_secret",
    label: "synthetic secret marker",
    pattern: /\bONERA-CANARY-[A-Za-z0-9_-]{4,64}\b/g,
    replace: mask("secret"),
  },
  {
    id: "api_key",
    label: "API key or bearer token",
    pattern: /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,})/g,
    replace: mask("key"),
  },
  {
    id: "approval_hash",
    label: "approval hash or similar 64-hex token",
    pattern: /\b[a-f0-9]{64}\b/gi,
    replace: mask("hash"),
  },
  {
    id: "card_number",
    label: "card number",
    pattern: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b/g,
    replace: keepLast4,
  },
  {
    id: "ssn",
    label: "US social security number",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replace: mask("SSN"),
  },
  {
    id: "account_number",
    label: "full bank account or card number",
    pattern: /\b\d{10,19}\b/g,
    replace: keepLast4,
  },
];

/** Extra literal secrets configured at runtime: CLEARFI_SECRET_MARKERS (comma-separated) and the API keys themselves. */
export function configuredSecrets(): string[] {
  const extra = (process.env.CLEARFI_SECRET_MARKERS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
  const keys = [process.env.ANTHROPIC_API_KEY, process.env.ALPACA_API_KEY_ID, process.env.ALPACA_API_SECRET_KEY]
    .map((k) => k?.trim() ?? "")
    .filter((k) => k.length >= 8);
  return [...extra, ...keys];
}

/** IDs of the sensitive patterns found in `text` ("configured_secret" for literal markers). */
export function findSensitiveData(text: string): string[] {
  const found = SENSITIVE_PATTERNS.filter((p) => {
    p.pattern.lastIndex = 0;
    return p.pattern.test(text);
  }).map((p) => p.id);
  if (configuredSecrets().some((s) => text.includes(s))) found.push("configured_secret");
  return found;
}

export function sensitiveLabel(id: string): string {
  if (id === "configured_secret") return "configured secret value";
  return SENSITIVE_PATTERNS.find((p) => p.id === id)?.label ?? id;
}

/** Replaces every sensitive match, then bounds the length. */
export function redact(text: string, maxLength = 500): string {
  let out = text;
  for (const s of configuredSecrets()) out = out.split(s).join("[redacted secret]");
  for (const p of SENSITIVE_PATTERNS) out = out.replace(p.pattern, p.replace);
  return out.length > maxLength ? `${out.slice(0, maxLength - 1)}…` : out;
}
