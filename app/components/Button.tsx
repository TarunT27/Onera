import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Card";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "warning";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-brand-700 text-white shadow-sm hover:bg-brand-800 disabled:bg-brand-700/50 dark:bg-brand-500 dark:text-zinc-950 dark:hover:bg-brand-400 dark:disabled:bg-brand-500/40",
  secondary:
    "border border-zinc-300 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
  danger:
    "bg-red-600 text-white shadow-sm hover:bg-red-700 disabled:opacity-50 dark:bg-red-500 dark:hover:bg-red-400 dark:text-zinc-950",
  warning:
    "border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-200 dark:hover:bg-amber-900/50",
  ghost:
    "text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 dark:text-zinc-300 dark:hover:bg-zinc-800",
};

const SIZES = {
  sm: "min-h-11 px-2.5 py-1.5 text-xs sm:min-h-0",
  md: "min-h-11 px-3.5 py-2 text-sm",
  lg: "min-h-11 px-5 py-3 text-base",
};

export function Button({
  variant = "secondary",
  size = "md",
  busy = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: keyof typeof SIZES;
  busy?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type={type}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export const inputClass =
  "block w-full min-w-0 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500";

export const labelClass = "mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300";
