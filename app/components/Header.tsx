"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  House,
  ArrowsLeftRight,
  ChatCircle,
  SlidersHorizontal,
  Bank,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { clearfi, errorMessage } from "./api";
import { useSession } from "./SessionContext";
import { LogoMark } from "./Logo";
import { DemoUserMenu } from "./DemoUserMenu";
import type { UserId } from "@/lib/types";

const navigation = [
  { href: "/", label: "Overview", icon: House },
  { href: "/accounts", label: "Accounts", icon: Bank },
  { href: "/transfers", label: "Transfers", icon: ArrowsLeftRight },
  { href: "/chat", label: "Assistant", icon: ChatCircle },
  { href: "/control", label: "Controls", icon: SlidersHorizontal },
];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

/**
 * Glides the glass lens under the active tab. Long jumps stretch the lens
 * mid-flight and let it settle, like a drop of liquid finding its place.
 */
function useLiquidLens(activeHref: string | null) {
  const navRef = useRef<HTMLElement>(null);
  const lensRef = useRef<HTMLSpanElement>(null);
  const prevX = useRef<number | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const lens = lensRef.current;
    if (!nav || !lens) return;
    const place = (animate: boolean) => {
      const link = nav.querySelector<HTMLElement>("a[data-active]");
      if (!link) {
        lens.style.opacity = "0";
        prevX.current = null;
        return;
      }
      lens.style.opacity = "1";
      const x = link.offsetLeft - lens.offsetLeft;
      const from = prevX.current;
      lens.style.transform = `translateX(${x}px)`;
      prevX.current = x;
      if (
        !animate ||
        from === null ||
        from === x ||
        matchMedia("(prefers-reduced-motion: reduce)").matches
      )
        return;
      const hops = Math.min(Math.abs(x - from) / link.offsetWidth, 4);
      const sx = 1 + 0.14 * hops;
      const sy = 1 - 0.05 * hops;
      lens.animate(
        [
          { transform: `translateX(${from}px) scale(1, 1)` },
          {
            transform: `translateX(${(from + x) / 2}px) scale(${sx}, ${sy})`,
            offset: 0.42,
          },
          { transform: `translateX(${x}px) scale(1, 1)` },
        ],
        { duration: 340 + hops * 20, easing: "cubic-bezier(0.32, 0.72, 0, 1)" },
      );
    };
    place(true);
    const onResize = () => {
      prevX.current = null;
      place(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [activeHref]);
  return { navRef, lensRef };
}

export function Header() {
  const pathname = usePathname();
  const { data: session, error: sessionError } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 24);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [pathname]);
  // Move the lens on tap, before the next route finishes loading.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  useEffect(() => setPendingHref(null), [pathname]);
  const activeHref =
    pendingHref ??
    navigation.find((n) => isActive(n.href, pathname))?.href ??
    null;
  const { navRef, lensRef } = useLiquidLens(activeHref);

  useEffect(() => {
    if (sessionError) setError(errorMessage(sessionError));
  }, [sessionError]);
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
      <header className="topbar" data-scrolled={scrolled ? "true" : undefined}>
        <Link className="wordmark" href="/" aria-label="ClearFi home">
          <LogoMark />
          <span>ClearFi</span>
        </Link>
        <nav aria-label="Main" className="island" ref={navRef}>
          <span className="lens" ref={lensRef} aria-hidden />
          {navigation.map(({ href, label, icon: Icon }) => {
            const current = isActive(href, pathname);
            return (
              <Link
                key={href}
                href={href}
                title={label}
                onClick={() => setPendingHref(href)}
                data-active={activeHref === href ? "" : undefined}
                aria-current={current ? "page" : undefined}
              >
                <Icon
                  size={19}
                  weight={activeHref === href ? "fill" : "regular"}
                  aria-hidden
                />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="session">
          <span className="demo-label">
            Demo <span>· simulated money</span>
          </span>
          <div className="session-user">
            <span className="avatar" aria-hidden>
              {session?.user.name
                .split(" ")
                .map((n) => n[0])
                .join("") ?? "…"}
            </span>
            <DemoUserMenu session={session} busy={busy} onChange={changeUser} />
            <button
              className="icon-btn"
              onClick={reset}
              disabled={busy}
              title="Reset demo"
              aria-label="Reset demo"
            >
              <ArrowCounterClockwise size={16} aria-hidden />
            </button>
          </div>
        </div>
      </header>
      {error && (
        <div role="alert" className="shell-error">
          {error}
          <button onClick={() => setError("")}>Dismiss</button>
        </div>
      )}
    </>
  );
}
