/**
 * Deterministic routing for spoken commands. No model picks the route:
 *
 * - a short "open <page>" is navigation and never reaches the assistant;
 * - an explicit buy or sell goes to the Trade drafter, the only agent that can
 *   propose paper orders;
 * - everything else goes to the general assistant, which can read data and
 *   propose transfers.
 *
 * Whatever the route, writes are still only proposals that wait for the user's
 * approval in the app. Choosing an agent here is the same as clicking its chip.
 */
import { msg } from "@/lib/i18n/msg";

export type VoiceRoute =
  | { kind: "navigate"; href: string; label: string }
  | { kind: "ask"; agent: "general" | "drafter" };

const PAGES: { href: string; label: string; names: string[] }[] = [
  { href: "/", label: msg("Overview"), names: ["overview", "home", "home page", "dashboard"] },
  { href: "/accounts", label: msg("Accounts"), names: ["accounts", "account", "balances"] },
  { href: "/family", label: msg("Family"), names: ["family", "family cards", "kids", "kids cards", "kids' cards"] },
  { href: "/transfers", label: msg("Transfers"), names: ["transfers", "transfer", "payments"] },
  { href: "/trade", label: msg("Trade"), names: ["trade", "trading", "paper trading", "market", "markets"] },
  { href: "/chat", label: msg("Assistant"), names: ["assistant", "chat", "ask onera"] },
  { href: "/security", label: msg("Security"), names: ["security", "threats", "threat monitor"] },
  { href: "/control", label: msg("Controls"), names: ["controls", "control", "limits", "settings"] },
];

const NAVIGATE =
  /^(?:go(?: back)?(?: to)?|open(?: up)?|show(?: me)?|take me(?: to)?|navigate to|switch to|bring up|jump to)\s+(?:the |my )?(.+?)(?: (?:page|tab|screen|section|view))?(?: please)?$/;

const FILLER = /^(?:ok(?:ay)?|hey(?: onera)?|hi|so|um+|uh+|alright|right|well|please|onera)\s+/;

const TRADE = [
  /^(?:buy|sell)\b/,
  /\b(?:can|could|would|will) (?:you )?(?:buy|sell)\b/,
  /\b(?:i want|i'd like|i would like|help me|let's|let me)(?: to)? (?:buy|sell)\b/,
  /\b(?:place|draft|make|put in|set up) (?:a |an )?(?:paper )?(?:buy |sell )?(?:order|trade)\b/,
];

/** Lowercase, drop punctuation and leading filler words ("okay, hey Onera, …"). */
export function normalizeCommand(transcript: string): string {
  let text = transcript.toLowerCase().replace(/[.!?,;:"“”]+/g, " ").replace(/\s+/g, " ").trim();
  for (let prev = ""; prev !== text; ) {
    prev = text;
    text = text.replace(FILLER, "");
  }
  return text;
}

export function routeVoiceCommand(transcript: string): VoiceRoute {
  const text = normalizeCommand(transcript);
  const target = NAVIGATE.exec(text)?.[1];
  const page = target ? PAGES.find((p) => p.names.includes(target)) : undefined;
  if (page) return { kind: "navigate", href: page.href, label: page.label };
  return { kind: "ask", agent: TRADE.some((re) => re.test(text)) ? "drafter" : "general" };
}
