"use client";

import { useT } from "./I18nContext";

export function AppFooter() {
  const t = useT();
  return (
    <footer className="app-footer">
      {t("All accounts and transactions are synthetic. Transfers are simulated. You approve every action.")}
    </footer>
  );
}
