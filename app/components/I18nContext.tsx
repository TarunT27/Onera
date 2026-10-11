"use client";

import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  isLocale,
  languageOf,
  type LocaleCode,
} from "@/lib/i18n/languages";
import { loadDictionary } from "@/lib/i18n/load";
import {
  interpolate,
  translate,
  translatePlural,
  type Dictionary,
  type Vars,
} from "@/lib/i18n/translate";
import { setFormatLocale } from "./format";

type RichVars = Record<string, ReactNode>;

export type I18n = {
  locale: LocaleCode;
  /** Translate an English message. `{name}` placeholders come from `vars`. */
  t: (key: string, vars?: Vars) => string;
  /** Plural-aware translate. `other` is the translation key. `{n}` is the count. */
  tp: (count: number, one: string, other: string, vars?: Vars) => string;
  /** Like `t`, but placeholders may be React nodes (links, bold, amounts). */
  tr: (key: string, vars: RichVars) => ReactNode;
  setLocale: (next: LocaleCode) => Promise<void>;
};

const I18nContext = createContext<I18n | null>(null);

export function I18nProvider({
  initialLocale,
  initialDictionary,
  children,
}: {
  initialLocale: LocaleCode;
  initialDictionary: Dictionary | null;
  children: ReactNode;
}) {
  const [state, setState] = useState({ locale: initialLocale, dict: initialDictionary });
  // Remount the tree on a language change so every cached string and
  // formatter is rebuilt. The first render keeps the server's markup.
  const generation = useRef(0);
  setFormatLocale(languageOf(state.locale).intl);

  // The cookie is what the server reads, so a first visit with only a
  // stored preference is promoted to a cookie and re-rendered.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    } catch {}
    if (isLocale(stored) && stored !== initialLocale) void apply(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function apply(next: LocaleCode) {
    const dict = await loadDictionary(next);
    generation.current += 1;
    const language = languageOf(next);
    document.documentElement.lang = language.code;
    document.documentElement.dir = language.dir;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try {
      localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {}
    setState({ locale: next, dict });
  }

  const setLocale = useCallback(async (next: LocaleCode) => apply(next), []); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<I18n>(() => {
    const { locale, dict } = state;
    return {
      locale,
      setLocale,
      t: (key, vars) => translate(dict, key, vars),
      tp: (count, one, other, vars) => translatePlural(dict, locale, count, one, other, vars),
      tr: (key, vars) => {
        const template = translate(dict, key);
        const parts = template.split(/(\{\w+\})/g);
        return parts.map((part, index) => {
          const name = /^\{(\w+)\}$/.exec(part)?.[1];
          if (name && name in vars) return <Fragment key={index}>{vars[name]}</Fragment>;
          return part ? <Fragment key={index}>{interpolate(part)}</Fragment> : null;
        });
      },
    };
  }, [state, setLocale]);

  return (
    <I18nContext.Provider value={value}>
      <Fragment key={generation.current}>{children}</Fragment>
    </I18nContext.Provider>
  );
}

export function useI18n(): I18n {
  const value = useContext(I18nContext);
  if (!value) throw new Error("useI18n requires I18nProvider");
  return value;
}

/** Shorthand for components that only need `t`. */
export function useT() {
  return useI18n().t;
}

export { DEFAULT_LOCALE };
