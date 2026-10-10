import type { ReactNode } from "react";

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
      className={`min-w-0 rounded-2xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {(title || action) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 pt-4 sm:px-5 sm:pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-zinc-500 dark:text-zinc-400">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={`px-4 pb-4 sm:px-5 sm:pb-5 ${title || action ? "pt-3" : "pt-4 sm:pt-5"} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-200 px-4 py-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
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
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-zinc-500 dark:text-zinc-400">
      <Spinner />
      <span>{label}</span>
    </div>
  );
}

export function PageHeader({ title, description, action }: { title: string; description?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">{description}</p>}
      </div>
      {action}
    </div>
  );
}
