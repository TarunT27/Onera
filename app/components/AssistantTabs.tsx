"use client";

/** Switches between the two faces of the assistant: the chat and the background briefing. */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { msg } from "@/lib/i18n/msg";
import { useT } from "./I18nContext";

const TABS = [
  { href: "/chat", label: msg("Ask Onera") },
  { href: "/briefing", label: msg("Briefing") },
];

export function AssistantTabs({ className = "mb-6" }: { className?: string }) {
  const pathname = usePathname();
  const t = useT();
  return (
    <nav aria-label={t("Assistant")} className={`${className} inline-flex rounded-full bg-white/[0.05] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]`}>
      {TABS.map((tab) => {
        const current = pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              current ? "bg-white text-zinc-950" : "text-white/65 hover:text-white"
            }`}
          >
            {t(tab.label)}
          </Link>
        );
      })}
    </nav>
  );
}
