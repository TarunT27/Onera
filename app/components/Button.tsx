import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Spinner } from "./Card";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "warning";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-white text-zinc-950 shadow-[0_8px_24px_-10px_rgb(0_0_0/0.6)] hover:bg-brand-100 disabled:bg-white/40",
  secondary:
    "bg-white/[0.08] text-zinc-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1),inset_0_1px_0_rgb(255_255_255/0.08)] hover:bg-white/[0.13] disabled:opacity-50",
  danger:
    "bg-red-400/15 text-red-200 shadow-[inset_0_0_0_1px_rgb(248_113_113/0.25)] hover:bg-red-400/25 disabled:opacity-50",
  warning:
    "bg-amber-300/12 text-amber-200 shadow-[inset_0_0_0_1px_rgb(252_211_77/0.22)] hover:bg-amber-300/20 disabled:opacity-50",
  ghost:
    "text-white/70 hover:bg-white/[0.07] hover:text-white disabled:opacity-50",
};

const SIZES = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
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
      className={`inline-flex items-center justify-center gap-2 rounded-full font-medium active:scale-[0.97] disabled:cursor-not-allowed ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {busy && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export const inputClass =
  "block w-full min-w-0 rounded-2xl border-0 bg-white/[0.06] px-4 py-2.5 text-sm text-zinc-100 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)] transition-shadow duration-300 placeholder:text-white/35 focus:bg-white/[0.08] focus:shadow-[inset_0_0_0_1px_rgb(140_185_204/0.6),0_0_0_4px_rgb(0_99_142/0.25)] focus:outline-none disabled:opacity-60";

export const labelClass = "mb-1.5 block text-[13px] font-medium text-white/60";
