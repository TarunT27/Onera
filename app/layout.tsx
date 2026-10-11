import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppFooter } from "./components/AppFooter";
import { Header } from "./components/Header";
import { I18nProvider } from "./components/I18nContext";
import { SessionProvider } from "./components/SessionContext";
import { VoiceDock } from "./components/VoiceDock";
import "./globals.css";
import "./obsidian.css";
import { languageOf } from "@/lib/i18n/languages";
import { loadDictionary } from "@/lib/i18n/load";
import { getRequestLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: { default: "Onera", template: "%s · Onera" },
  description:
    "Your money, clearly. Synthetic accounts and simulated transfers, with you in control.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#08090b",
  viewportFit: "cover",
};
export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getRequestLocale();
  const dictionary = await loadDictionary(locale);
  const language = languageOf(locale);
  return (
    <html lang={language.code} dir={language.dir} className="dark" data-scroll-behavior="smooth">
      <body className="obsidian-app">
        <div className="ambient" aria-hidden />
        <div className="grain" aria-hidden />
        <I18nProvider initialLocale={locale} initialDictionary={dictionary}>
        <SessionProvider>
        <Header />
        <main id="main-content" className="app-main">
          {children}
        </main>
        <AppFooter />
        <VoiceDock />
        </SessionProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
