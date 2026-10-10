"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { UserId } from "@/lib/types";
import { clearfi, errorMessage, type SessionResponse } from "./api";
import { Spinner } from "./Card";

const NAV = [
  { href: "/", label: "Hub", short: "Hub" },
  { href: "/transfers", label: "Transfers", short: "Transfers" },
  { href: "/chat", label: "Ask ClearFi", short: "Ask AI" },
  { href: "/control", label: "Control", short: "Control" },
] as const;

/** Must match CHAT_STORAGE_KEY in app/chat/ChatClient.tsx. */
const CHAT_STORAGE_KEY = "clearfi.chat.v1";

function clearChatHistory() {
  try {
    window.sessionStorage.removeItem(CHAT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

export function DemoBanner() {
  return (
    <div
      role="note"
      className="sticky top-0 z-40 flex min-h-8 items-center justify-center bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-950 ring-1 ring-amber-200 md:h-8 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900"
    >
      <span>
        <span aria-hidden className="mr-1">
          ●
        </span>
        Demo · synthetic accounts · simulated money — no real funds move
      </span>
    </div>
  );
}

export function Header() {
  const pathname = usePathname() ?? "/";
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"switch" | "reset" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sessionRequest = useRef(0);

  const loadSession = useCallback(async () => {
    const request = ++sessionRequest.current;
    setSessionLoading(true);
    setSessionError(null);
    try {
      const next = await clearfi.getSession();
      if (request === sessionRequest.current) setSession(next);
    } catch (err) {
      if (request === sessionRequest.current) setSessionError(`Session: ${errorMessage(err)}`);
    } finally {
      if (request === sessionRequest.current) setSessionLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSession();
    return () => {
      sessionRequest.current += 1;
    };
  }, [loadSession]);

  async function switchUser(userId: UserId) {
    if (!session || userId === session.user.id) return;
    setBusy("switch");
    setError(null);
    try {
      await clearfi.setSession(userId);
      clearChatHistory();
      window.location.reload();
    } catch (err) {
      setError(`Switch user: ${errorMessage(err)}`);
      setBusy(null);
    }
  }

  async function resetDemo() {
    if (!window.confirm("Reset the demo? This wipes and reseeds all synthetic data, transfers and audit history.")) return;
    setBusy("reset");
    setError(null);
    try {
      await clearfi.resetDemo();
      clearChatHistory();
      window.location.reload();
    } catch (err) {
      setError(`Reset: ${errorMessage(err)}`);
      setBusy(null);
    }
  }

  return (
    <header className="z-30 border-b border-zinc-200 bg-white/90 backdrop-blur md:sticky md:top-8 dark:border-zinc-800 dark:bg-zinc-950/90">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 text-zinc-900 dark:text-zinc-50" aria-label="ClearFi home">
          <span
            aria-hidden
            className="grid size-7 place-items-center rounded-lg bg-brand-700 text-sm font-bold text-white dark:bg-brand-500 dark:text-zinc-950"
          >
            C
          </span>
          <span className="text-lg font-semibold tracking-tight">
            Clear<span className="text-brand-700 dark:text-brand-400">Fi</span>
          </span>
        </Link>

        <nav aria-label="Main" className="order-last grid w-full grid-cols-4 gap-1 md:order-none md:flex md:w-auto md:flex-1">
          {NAV.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`grid min-h-11 place-items-center rounded-lg px-1 py-1.5 text-center text-[13px] font-medium whitespace-nowrap transition-colors sm:min-h-0 sm:px-3 sm:text-sm ${
                  active
                    ? "bg-brand-50 text-brand-800 dark:bg-brand-950 dark:text-brand-300"
                    : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                }`}
              >
                <span className="sm:hidden">{item.short}</span>
                <span className="hidden sm:inline">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <label className="sr-only" htmlFor="demo-user">
            Demo user
          </label>
          <div className="flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white py-1 pr-1 pl-2 text-sm dark:border-zinc-700 dark:bg-zinc-900">
            <span className="hidden text-xs text-zinc-500 sm:inline dark:text-zinc-400">Viewing as</span>
            {(sessionLoading || busy === "switch") && <Spinner className="size-3 text-zinc-400" />}
            <select
              id="demo-user"
              name="demo-user"
              value={session?.user.id ?? ""}
              disabled={sessionLoading || !session || busy !== null}
              onChange={(e) => void switchUser(e.target.value as UserId)}
              aria-busy={sessionLoading || undefined}
              aria-describedby={sessionError ? "session-error" : undefined}
              className="min-h-9 rounded-md bg-white py-0.5 pr-1 text-sm font-medium text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-700 dark:bg-zinc-900 dark:text-zinc-100 dark:focus-visible:outline-brand-400"
            >
              {!session && <option value="">{sessionLoading ? "Loading…" : "Unavailable"}</option>}
              {session?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => void resetDemo()}
            disabled={busy !== null}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 sm:min-h-0 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            title="Wipe and reseed all synthetic demo data"
          >
            {busy === "reset" && <Spinner className="size-3" />}
            <span className="sm:hidden">Reset</span>
            <span className="hidden sm:inline">Reset demo</span>
          </button>
        </div>
      </div>
      {(sessionError || error) && (
        <div
          id={sessionError ? "session-error" : undefined}
          role="alert"
          className="border-t border-red-200 bg-red-50 px-4 py-1.5 text-center text-xs text-red-800 dark:border-red-900 dark:bg-red-950/60 dark:text-red-200"
        >
          {sessionError ?? error}{" "}
          {sessionError ? (
            <button type="button" className="ml-2 underline" onClick={() => void loadSession()}>
              Retry session
            </button>
          ) : (
            <button type="button" className="ml-2 underline" onClick={() => setError(null)}>
              Dismiss
            </button>
          )}
        </div>
      )}
    </header>
  );
}
