import { DEFAULT_LOCALE, type LocaleCode, languageOf } from "./languages";

/** One translated message, or one message per plural category. */
export type PluralForms = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };
export type Dictionary = Record<string, string | PluralForms>;
export type Vars = Record<string, string | number>;

/** Replace `{name}` placeholders. Unknown placeholders are left as written. */
export function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

/**
 * Look a message up by its English text. Anything missing falls back to the
 * English text, so a half-translated screen never shows a blank or a key.
 */
export function translate(dict: Dictionary | null, key: string, vars?: Vars): string {
  const hit = dict?.[key];
  if (hit === undefined && dict && !vars) {
    // A finished sentence from the server (stored insights, run summaries):
    // find the template it was built from and translate that.
    const matched = translateBuilt(dict, key);
    if (matched !== null) return matched;
  }
  const text = typeof hit === "string" ? hit : hit?.other ?? key;
  return interpolate(text, vars);
}

type Template = { pattern: RegExp; names: string[]; key: string };
const templateCache = new WeakMap<Dictionary, { list: Template[]; seen: Map<string, string | null> }>();

function templatesOf(dict: Dictionary) {
  let entry = templateCache.get(dict);
  if (entry) return entry;
  const list: Template[] = [];
  for (const [key, value] of Object.entries(dict)) {
    if (typeof value !== "string" || !/\{\w+\}/.test(key)) continue;
    const parts = key.split(/(\{\w+\})/);
    const names: string[] = [];
    let literal = "";
    const source = parts
      .map((part) => {
        const name = /^\{(\w+)\}$/.exec(part)?.[1];
        if (name) {
          names.push(name);
          return "(.+?)";
        }
        literal += part.trim();
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("");
    // A template with hardly any fixed words (just "{a}: {b}") would match anything.
    if (/\p{L}{2,}/u.test(literal)) list.push({ pattern: new RegExp(`^${source}$`, "s"), names, key });
  }
  list.sort((a, b) => b.key.length - a.key.length);
  entry = { list, seen: new Map() };
  templateCache.set(dict, entry);
  return entry;
}

/** Translate a sentence that was built on the server from a known template, or null if none fits. */
function translateBuilt(dict: Dictionary, text: string, depth = 0): string | null {
  if (text.length > 4000 || depth > 3 || !/\d|[A-Z]/.test(text)) return null;
  const entry = templatesOf(dict);
  const cached = entry.seen.get(text);
  if (cached !== undefined) return cached;
  let result: string | null = null;
  for (const { pattern, names, key } of entry.list) {
    const m = pattern.exec(text);
    if (!m) continue;
    const vars: Vars = {};
    // A captured piece may itself be a known sentence (a bundled title or advice line).
    names.forEach((name, i) => {
      const piece = m[i + 1];
      const exact = dict[piece];
      vars[name] = typeof exact === "string" ? exact : (translateBuilt(dict, piece, depth + 1) ?? piece);
    });
    result = interpolate(dict[key] as string, vars);
    break;
  }
  if (result === null) {
    // Several sentences joined with a line break or " · ": translate each piece on its own.
    for (const separator of ["\n", " · "]) {
      if (!text.includes(separator)) continue;
      let changed = false;
      const pieces = text.split(separator).map((line) => {
        const bullet = /^(\s*[•\-*]\s+)(.*)$/.exec(line);
        const body = bullet ? bullet[2] : line;
        const done = body.trim() ? (typeof dict[body] === "string" ? (dict[body] as string) : translateBuilt(dict, body, depth + 1)) : null;
        if (done === null) return line;
        changed = true;
        return (bullet ? bullet[1] : "") + done;
      });
      if (changed) {
        result = pieces.join(separator);
        break;
      }
    }
  }
  entry.seen.set(text, result);
  return result;
}

/**
 * Plural-aware lookup. `other` is the key; `one` is only used for English
 * and as the fallback when a language has no entry.
 */
export function translatePlural(
  dict: Dictionary | null,
  locale: LocaleCode,
  count: number,
  one: string,
  other: string,
  vars?: Vars,
): string {
  const all = { n: count, ...vars };
  const hit = dict?.[other];
  if (locale !== DEFAULT_LOCALE && hit) {
    if (typeof hit === "string") return interpolate(hit, all);
    const category = new Intl.PluralRules(languageOf(locale).intl).select(count);
    return interpolate(hit[category] ?? hit.other, all);
  }
  return interpolate(count === 1 ? one : other, all);
}

/** The `t` function, for helpers outside React that build user-facing text. */
export type Translate = (key: string, vars?: Vars) => string;

/** Used when a helper is called without a translator: English with placeholders filled. */
export const identityT: Translate = (key, vars) => interpolate(key, vars);
