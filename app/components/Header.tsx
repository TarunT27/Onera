"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  House,
  ArrowsLeftRight,
  ChatCircle,
  SlidersHorizontal,
  Bank,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { clearfi, errorMessage, type SessionResponse } from "./api";
import type { UserId } from "@/lib/types";

const navigation = [
  { href: "/", label: "Overview", icon: House },
  { href: "/accounts", label: "Accounts", icon: Bank },
  { href: "/transfers", label: "Transfers", icon: ArrowsLeftRight },
  { href: "/chat", label: "Assistant", icon: ChatCircle },
  { href: "/control", label: "Controls", icon: SlidersHorizontal },
];
export function Header() {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    clearfi
      .getSession()
      .then(setSession)
      .catch((e) => setError(errorMessage(e)));
  }, []);
  async function changeUser(id: UserId) {
    setBusy(true);
    try {
      await clearfi.setSession(id);
      sessionStorage.removeItem("clearfi.chat.v1");
      window.location.reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  async function reset() {
    if (
      !confirm(
        "Reset all synthetic demo accounts, connections, transfers and history?",
      )
    )
      return;
    setBusy(true);
    try {
      await clearfi.resetDemo();
      sessionStorage.clear();
      window.location.reload();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }
  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      <aside className="sidebar">
        <Link className="wordmark" href="/" aria-label="ClearFi home">
          ClearFi<span className="wordmark-period">.</span>
        </Link>
        <nav aria-label="Main">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                (href === "/" ? pathname === "/" : pathname.startsWith(href))
                  ? "page"
                  : undefined
              }
            >
              <Icon size={26} weight="light" aria-hidden />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <p>
            Your money.
            <br />
            Your decisions.
          </p>
          <button onClick={reset} disabled={busy}>
            <ArrowCounterClockwise size={18} aria-hidden />
            Reset demo
          </button>
        </div>
      </aside>
      <div className="session-bar">
        <span className="demo-label">
          Demo <span>· simulated money</span>
        </span>
        <span className="avatar" aria-hidden>
          {session?.user.name
            .split(" ")
            .map((n) => n[0])
            .join("") ?? "…"}
        </span>
        <label className="sr-only" htmlFor="demo-user">
          Demo user
        </label>
        <select
          id="demo-user"
          value={session?.user.id ?? ""}
          disabled={!session || busy}
          onChange={(e) => changeUser(e.target.value as UserId)}
        >
          {!session && <option value="">Loading…</option>}
          {session?.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <div role="alert" className="shell-error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </>
  );
}
