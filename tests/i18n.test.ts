import { describe, expect, it } from "vitest";
import { uniqueKeys } from "../scripts/i18n-keys";
import { LANGUAGES, DEFAULT_LOCALE } from "../lib/i18n/languages";
import { loadDictionary } from "../lib/i18n/load";
import { interpolate, translate, translatePlural } from "../lib/i18n/translate";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const keys = uniqueKeys();
const locales = LANGUAGES.filter((l) => l.code !== DEFAULT_LOCALE);

describe("translate helpers", () => {
  it("fills placeholders and leaves unknown ones alone", () => {
    expect(interpolate("Hi {name}, {x}", { name: "Ana" })).toBe("Hi Ana, {x}");
  });
  it("falls back to the English key when a message is missing", () => {
    expect(translate({ Hello: "Hola" }, "Hello")).toBe("Hola");
    expect(translate({ Hello: "Hola" }, "Goodbye")).toBe("Goodbye");
    expect(translate(null, "Goodbye {n}", { n: 2 })).toBe("Goodbye 2");
  });
  it("picks plural forms per language", () => {
    const ru = { "{n} accounts": { one: "{n} счёт", few: "{n} счёта", many: "{n} счетов", other: "{n} счёта" } };
    expect(translatePlural(ru, "ru", 1, "{n} account", "{n} accounts")).toBe("1 счёт");
    expect(translatePlural(ru, "ru", 3, "{n} account", "{n} accounts")).toBe("3 счёта");
    expect(translatePlural(ru, "ru", 5, "{n} account", "{n} accounts")).toBe("5 счетов");
    expect(translatePlural(null, "en", 1, "{n} account", "{n} accounts")).toBe("1 account");
    expect(translatePlural(null, "en", 2, "{n} account", "{n} accounts")).toBe("2 accounts");
  });
});

describe("translations are complete", () => {
  it("finds messages in the source", () => {
    expect(keys.length).toBeGreaterThan(50);
  });

  for (const language of locales) {
    it(`${language.english} (${language.code}) covers every message with matching placeholders`, async () => {
      const dict = (await loadDictionary(language.code)) ?? {};
      const missing: string[] = [];
      const broken: string[] = [];
      for (const { key, plural } of keys) {
        const entry = dict[key];
        if (entry === undefined) {
          missing.push(key);
          continue;
        }
        const forms = typeof entry === "string" ? [entry] : Object.values(entry);
        if (plural && typeof entry !== "string" && typeof entry.other !== "string") broken.push(`${key} (no "other" form)`);
        for (const form of forms) {
          const want = placeholders(key).filter((p) => !(plural && p === "n"));
          const got = placeholders(form).filter((p) => !(plural && p === "n"));
          if (want.join() !== got.join()) broken.push(`${key} → ${form}`);
        }
      }
      expect(missing.slice(0, 20), `${missing.length} missing`).toEqual([]);
      expect(broken.slice(0, 20)).toEqual([]);
    });

    it(`${language.english} has no stale entries`, async () => {
      const dict = (await loadDictionary(language.code)) ?? {};
      const known = new Set(keys.map((k) => k.key));
      const stale = Object.keys(dict).filter((k) => !known.has(k));
      expect(stale.slice(0, 20), `${stale.length} stale`).toEqual([]);
    });
  }
});
