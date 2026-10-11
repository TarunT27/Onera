"use client";

import { Check, Translate } from "@phosphor-icons/react";
import { LANGUAGES } from "@/lib/i18n/languages";
import { Card, PageHeader } from "../components/Card";
import { useI18n } from "../components/I18nContext";

export function SettingsClient() {
  const { t, locale, setLocale } = useI18n();
  return (
    <div className="space-y-6">
      <PageHeader
        title={t("Settings")}
        description={t("Make Onera work the way you do. These preferences stay on this device.")}
      />
      <Card
        title={
          <span className="inline-flex items-center gap-2">
            <Translate size={20} aria-hidden /> {t("Accessibility")}
          </span>
        }
        subtitle={t("Ways to make Onera easier to read and use.")}
      >
        <fieldset>
          <legend className="text-[15px] font-medium text-zinc-100">{t("Language")}</legend>
          <p id="language-help" className="mt-1 text-[13px] text-white/50">
            {t("Choose the language for menus, buttons and messages across the whole app.")}
          </p>
          <div
            role="radiogroup"
            aria-label={t("Language")}
            aria-describedby="language-help"
            className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3"
          >
            {LANGUAGES.map((language) => {
              const selected = language.code === locale;
              return (
                <button
                  key={language.code}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  lang={language.code}
                  dir={language.dir}
                  onClick={() => void setLocale(language.code)}
                  className={`flex min-w-0 items-center justify-between gap-3 rounded-2xl px-4 py-3 text-start transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-300 ${
                    selected
                      ? "bg-white/[0.12] shadow-[inset_0_0_0_1.5px_rgb(140_185_204/0.7)]"
                      : "bg-white/[0.05] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] hover:bg-white/[0.09]"
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[16px] font-medium text-zinc-50">{language.native}</span>
                    <span className="block truncate text-[12px] text-white/45" lang="en" dir="ltr">
                      {language.english}
                    </span>
                  </span>
                  {selected && <Check size={18} weight="bold" aria-hidden className="shrink-0 text-sky-200" />}
                </button>
              );
            })}
          </div>
          <p role="status" className="sr-only">
            {t("Language set to {language}", { language: LANGUAGES.find((l) => l.code === locale)?.native ?? "" })}
          </p>
        </fieldset>
      </Card>
    </div>
  );
}
