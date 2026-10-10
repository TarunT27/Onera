import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Header } from "./components/Header";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "ClearFi", template: "%s · ClearFi" },
  description:
    "Your money, clearly. Synthetic accounts and simulated transfers, with you in control.",
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#000000",
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Header />
        <main id="main-content" className="app-main">
          {children}
        </main>
        <footer className="app-footer">
          All accounts and transactions are synthetic. Transfers are simulated.
          You approve every action.
        </footer>
      </body>
    </html>
  );
}
