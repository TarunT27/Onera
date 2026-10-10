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
];

export function injectionMarkerLabel(id: string): string {
  return INJECTION_MARKERS.find((m) => m.id === id)?.label ?? id;
}

/** IDs of the markers found in `text`, in declaration order. */
export function findInjectionMarkers(text: string): string[] {
  return INJECTION_MARKERS.filter((m) => m.pattern.test(text)).map((m) => m.id);
}
