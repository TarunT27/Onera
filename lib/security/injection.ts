/**
 * Deterministic prompt-injection markers. Used to label audit events for the
 * threat monitor; never used to make a policy decision and never a guarantee
 * of detection. A match means "this text tries to instruct the assistant".
 */

export interface InjectionMarker {
  id: string;
  /** Plain-words description for alerts. */
  label: string;
  pattern: RegExp;
}

export const INJECTION_MARKERS: readonly InjectionMarker[] = [
  { id: "ignore_instructions", label: "asks to ignore instructions", pattern: /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|prior|above|all|any|your)\b[^.\n]{0,20}\b(instructions|rules|limits|guidelines)\b/i },
  { id: "authority_claim", label: "claims system or admin authority", pattern: /\b(system|admin(istrator)?s?|developer)\s+(instruction|override|message|prompt)\b|\battention\s+ai\b/i },
  { id: "pre_approval_claim", label: "claims you pre-approved it", pattern: /\b(pre-?approved|already approved|authorized you|without asking)\b/i },
  { id: "approve_execute", label: "asks to approve or execute", pattern: /\bapprove\b[^.\n]{0,30}\bexecute\b|\bexecute\b[^.\n]{0,30}\b(immediately|now)\b/i },
  { id: "loosen_controls", label: "asks to loosen limits or controls", pattern: /\b(raise|increase|disable|remove|bypass|turn off|ignore)\b[^.\n]{0,30}\b(daily |transfer |per-transfer )?(limits?|controls?|pause)\b/i },
  { id: "verify_recipient", label: "asks to verify a recipient", pattern: /\bmark\b[^.\n]{0,30}\bverified\b|\bverify\b[^.\n]{0,20}\brecipient\b/i },
  { id: "conceal", label: "asks to hide this from you", pattern: /\b(do not|don't|never)\s+(mention|tell|reveal|show)\b/i },
  { id: "follow_embedded", label: "asks to follow embedded instructions", pattern: /\bfollow\b[^.\n]{0,30}\binstructions\b[^.\n]{0,30}\b(inside|in the|found)\b/i },
  { id: "reveal_secrets", label: "asks to reveal secrets or hidden instructions", pattern: /\b(reveal|show|print|dump|leak|tell me|give me|output)\b[^.\n]{0,40}\b(credentials?|passwords?|api[ -]?keys?|secrets?|tokens?|system prompt|hidden instructions|approval hash(es)?)\b/i },
];

/** Quoted spans: the quote must not touch a letter on its outer side, so apostrophes (what's, don't) never count. */
const QUOTED = /(?<![\p{L}\p{N}])["“'‘]([^"”'’\n]{6,200})["”'’](?![\p{L}\p{N}])/gu;
const ABOUT_ATTACKS = /\b(mean|means|meaning|explain|example|definition|what is|what are|what does|prompt injection|jailbreak)\b/i;

/**
 * True when the text talks *about* an attack rather than making one: every
 * injection marker sits inside quotes in a message that asks about them, or
 * the whole message is one short educational question. Used only to avoid an
 * automatic attack verdict; such text is still eligible for review, and a
 * proposal in the same turn is still flagged.
 */
export function looksLikeQuotedOrEducational(text: string): boolean {
  const t = text.trim();
  if (findInjectionMarkers(t).length > 0) {
    const unquoted = t.replace(QUOTED, " ");
    if (unquoted !== t && findInjectionMarkers(unquoted).length === 0 && ABOUT_ATTACKS.test(unquoted)) return true;
  }
  const oneQuestion =
    t.length <= 160 &&
    /^(what|why|how|explain|define|can you explain|tell me about)\b/i.test(t) &&
    /\?$/.test(t) &&
    !/[.!?]\s+\S/.test(t.slice(0, -1));
  return oneQuestion && /\b(mean|means|meaning|prompt injection|jailbreak)\b/i.test(t);
}

export function injectionMarkerLabel(id: string): string {
  return INJECTION_MARKERS.find((m) => m.id === id)?.label ?? id;
}

/** IDs of the markers found in `text`, in declaration order. */
export function findInjectionMarkers(text: string): string[] {
  return INJECTION_MARKERS.filter((m) => m.pattern.test(text)).map((m) => m.id);
}
