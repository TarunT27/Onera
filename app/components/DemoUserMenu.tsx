"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { CaretDown, Check } from "@phosphor-icons/react";
import type { SessionResponse } from "./api";
import { useT } from "./I18nContext";
import type { UserId } from "@/lib/types";

/** Downward, anchored menu; selecting a demo identity still uses the server session. */
export function DemoUserMenu({ session, busy, onChange }: {
  session: SessionResponse | null;
  busy: boolean;
  onChange: (id: UserId) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  function onMenuKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
      return;
    }
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []);
    if (!items.length) return;
    const index = items.findIndex((item) => item === document.activeElement);
    const next = event.key === "ArrowDown" ? (index + 1) % items.length
      : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
      : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next !== null) { event.preventDefault(); items[next].focus(); }
  }
  return (
    <div className="demo-user-menu" ref={root} onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <button id="demo-user" ref={trigger} className="demo-user-trigger"
        aria-label={t("Demo user: {name}", { name: session?.user.name ?? t("Loading…") })}
        aria-haspopup="menu" aria-expanded={open} aria-controls="demo-user-options"
        disabled={!session || busy} onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } }}>
        <span>{session?.user.name ?? t("Loading…")}</span><CaretDown size={13} aria-hidden />
      </button>
      {open && <div id="demo-user-options" className="demo-user-options" ref={menu}
        role="menu" aria-label={t("Demo users")} onKeyDown={onMenuKey}>
        <p>{t("Switch demo user")}</p>
        {session?.users.map((user) => <button key={user.id} role="menuitemradio"
          aria-checked={session.user.id === user.id} tabIndex={-1} disabled={busy}
          onClick={() => { setOpen(false); if (user.id !== session.user.id) void onChange(user.id); }}>
          <span>{user.name}</span>{session.user.id === user.id && <Check size={15} aria-hidden />}
        </button>)}
      </div>}
    </div>
  );
}
