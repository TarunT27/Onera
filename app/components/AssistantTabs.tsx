"use client";

/** Switches between the two faces of the assistant: the chat and the background briefing. */
import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/chat", label: "Ask Onera" },
  { href: "/briefing", label: "Briefing" },
];

export function AssistantTabs({ className = "mb-6" }: { className?: string }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Assistant" className={`${className} inline-flex rounded-full bg-white/[0.05] p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]`}>
      {TABS.map((t) => {
        const current = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={current ? "page" : undefined}
            className={`rounded-full px-4 py-1.5 text-[13px] font-medium transition-colors ${
              current ? "bg-white text-zinc-950" : "text-white/65 hover:text-white"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
