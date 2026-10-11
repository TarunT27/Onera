/** Pure text helpers for monitoring findings (no React, safe to unit test). */
import { identityT, type Translate } from "@/lib/i18n/translate";

/** Sentences that restate the panel-wide advisory and synthetic-data labels. */
const FINE_PRINT =
  /^(advisory only|prepared automatically|general information|rule-based|deterministic (rule|rules|detection)|simulated (prices|institution)|informational|your assistant can(no|['’])t|onera (never|does not|doesn['’]t)|policy checks)/i;

/**
 * Split an insight body into a short lede and everything else. The lede is the
 * first plain sentence of the first paragraph, plus the next one if both fit in
 * about two lines; fine print, advice paragraphs and extra signals go to
 * `more`, in their original order.
 */
export function splitInsightBody(body: string, maxChars = 170, t: Translate = identityT): { lede: string; more: string } {
  const paragraphs = body.trim().split(/\n\s*\n/);
  const first = paragraphs[0] ?? "";
  const later = paragraphs.slice(1);

  // Bulleted findings (the security sentinel lists one signal per line).
  if (/^\s*•/m.test(first)) {
    const lines = first.split("\n").map((l) => l.trim()).filter(Boolean);
    const [head, ...tail] = lines;
    const extra = tail.length ? ` (${t("+{n} more", { n: tail.length })})` : "";
    return {
      lede: `${head.replace(/^•\s*/, "")}${extra}`,
      more: [tail.join("\n"), ...later].filter(Boolean).join("\n\n"),
    };
  }

  const sentences = first.split(/(?<=[.!?])\s+(?=[A-Z0-9"“($])/);
  const lede: string[] = [];
  const rest: string[] = [];
  let length = 0;
  let closed = false;
  for (const s of sentences) {
    const plain = !FINE_PRINT.test(s);
    if (!closed && plain && (lede.length === 0 || (lede.length < 2 && length + s.length <= maxChars))) {
      lede.push(s);
      length += s.length + 1;
    } else {
      // Keep reading order: once a plain sentence spills over, the lede is done.
      if (plain && lede.length > 0) closed = true;
      rest.push(s);
    }
  }
  if (lede.length === 0) return { lede: first, more: later.join("\n\n") };
  return { lede: lede.join(" "), more: [rest.join(" "), ...later].filter(Boolean).join("\n\n") };
}
