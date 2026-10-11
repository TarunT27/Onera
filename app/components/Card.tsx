"use client";

import type { ReactNode } from "react";
import { useT } from "./I18nContext";

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  bodyClassName = "",
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`glass min-w-0 !rounded-[28px] ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-zinc-50">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-white/45">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-5 pb-5 sm:px-6 sm:pb-6 ${title || action ? "pt-4" : "pt-5 sm:pt-6"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl bg-white/[0.03] px-5 py-8 text-center text-sm text-white/50">
      {children}
    </p>
  );
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px] ${className}`}
    />
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  const t = useT();
  return (
    <div role="status" className="skeleton">
      <i />
      <i />
      <i />
      <span className="sr-only">{t(label)}</span>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[34px] font-semibold leading-[1.05] tracking-[-0.035em] text-zinc-50 sm:text-[46px]">{title}</h1>
        {description && <p className="mt-3 max-w-2xl text-[15px] text-white/55">{description}</p>}
      </div>
      {action}
    </div>
  );
}
