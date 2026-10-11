/**
 * Languages the UI can be shown in. The English text in the code is the
 * translation key, so English needs no dictionary of its own.
 */
export const LANGUAGES = [
  { code: "en", native: "English", english: "English", dir: "ltr", intl: "en-US" },
  { code: "es", native: "Español", english: "Spanish", dir: "ltr", intl: "es-419" },
  { code: "zh", native: "简体中文", english: "Chinese (Simplified)", dir: "ltr", intl: "zh-CN" },
  { code: "hi", native: "हिन्दी", english: "Hindi", dir: "ltr", intl: "hi-IN" },
  { code: "te", native: "తెలుగు", english: "Telugu", dir: "ltr", intl: "te-IN" },
  { code: "ar", native: "العربية", english: "Arabic", dir: "rtl", intl: "ar-u-nu-latn" },
  { code: "fr", native: "Français", english: "French", dir: "ltr", intl: "fr-FR" },
  { code: "pt", native: "Português", english: "Portuguese", dir: "ltr", intl: "pt-BR" },
  { code: "bn", native: "বাংলা", english: "Bengali", dir: "ltr", intl: "bn-BD" },
  { code: "ru", native: "Русский", english: "Russian", dir: "ltr", intl: "ru-RU" },
  { code: "ja", native: "日本語", english: "Japanese", dir: "ltr", intl: "ja-JP" },
] as const;

export type LocaleCode = (typeof LANGUAGES)[number]["code"];

export const LOCALE_CODES = LANGUAGES.map((l) => l.code) as unknown as readonly [LocaleCode, ...LocaleCode[]];

export const DEFAULT_LOCALE: LocaleCode = "en";
export const LOCALE_COOKIE = "onera-lang";
export const LOCALE_STORAGE_KEY = "onera.lang";

export function isLocale(value: unknown): value is LocaleCode {
  return typeof value === "string" && LANGUAGES.some((l) => l.code === value);
}

export function languageOf(code: LocaleCode) {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
