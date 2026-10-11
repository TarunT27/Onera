import { DEFAULT_LOCALE, type LocaleCode } from "./languages";
import type { Dictionary } from "./translate";

/** Dictionaries are split per language so only the active one is shipped. */
export async function loadDictionary(locale: LocaleCode): Promise<Dictionary | null> {
  switch (locale) {
    case "es": return (await import("./locales/es")).default;
    case "zh": return (await import("./locales/zh")).default;
    case "hi": return (await import("./locales/hi")).default;
    case "te": return (await import("./locales/te")).default;
    case "ar": return (await import("./locales/ar")).default;
    case "fr": return (await import("./locales/fr")).default;
    case "pt": return (await import("./locales/pt")).default;
    case "bn": return (await import("./locales/bn")).default;
    case "ru": return (await import("./locales/ru")).default;
    case "ja": return (await import("./locales/ja")).default;
    case DEFAULT_LOCALE:
    default:
      return null;
  }
}
