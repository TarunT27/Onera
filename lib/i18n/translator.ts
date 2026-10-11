import { DEFAULT_LOCALE, type LocaleCode } from "./languages";
import { loadDictionary } from "./load";
import { translate, type Translate } from "./translate";

/** A `t` for server code that writes text for one request (chat fallback replies). English when no language is given. */
export async function translatorFor(locale: LocaleCode | undefined): Promise<Translate> {
  const dict = await loadDictionary(locale ?? DEFAULT_LOCALE);
  return (key, vars) => translate(dict, key, vars);
}
