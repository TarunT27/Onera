import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DemoBanner, Header } from "./components/Header";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "ClearFi", template: "%s · ClearFi" },
  description:
    "ClearFi — understand your money in one place, with AI that proposes actions and controls that enforce your decisions. Demo with synthetic accounts and simulated money.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-zinc-50 font-sans text-zinc-900 antialiased dark:bg-zinc-950 dark:text-zinc-100">
        <a
          href="#main-content"
          className="fixed top-2 left-2 z-50 -translate-y-20 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white shadow-lg transition-transform focus:translate-y-0 dark:bg-brand-500 dark:text-zinc-950"
        >
          Skip to main content
        </a>
        <DemoBanner />
        <Header />
        <main id="main-content" tabIndex={-1} className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">
          {children}
        </main>
        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-zinc-500 sm:px-6 dark:text-zinc-500">
          ClearFi is a HackRU demo. All accounts, transactions and recipients are synthetic; every transfer is a
          simulation. The assistant can propose transfers but only you can approve them, and the server enforces your
          controls.
        </footer>
      </body>
    </html>
  );
}
