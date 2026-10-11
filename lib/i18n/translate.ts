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
  const text = typeof hit === "string" ? hit : hit?.other ?? key;
  return interpolate(text, vars);
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
