import { formatCents } from "./format";

/** Money from integer cents. `colorize` tints inflows green; `signed` shows +/−. */
export function Money({
  cents,
  signed = false,
  colorize = false,
  whole = false,
  className = "",
}: {
  cents: number;
  signed?: boolean;
  colorize?: boolean;
  whole?: boolean;
  className?: string;
}) {
  const tint = colorize && cents > 0 ? "text-green-700 dark:text-green-400" : "";
  return <span className={`tabular-nums ${tint} ${className}`}>{formatCents(cents, { signed, whole })}</span>;
}
