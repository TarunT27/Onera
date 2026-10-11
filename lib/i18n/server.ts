import { cookies } from "next/headers";
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, type LocaleCode } from "./languages";

/** The language this request asked for, from the preference cookie. */
export async function getRequestLocale(): Promise<LocaleCode> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

import { loadDictionary } from "./load";
import { translate, type Vars } from "./translate";

/** `t` for server components (page metadata). Client components use `useT()`. */
export async function getServerT() {
  const dict = await loadDictionary(await getRequestLocale());
  return (key: string, vars?: Vars) => translate(dict, key, vars);
}
