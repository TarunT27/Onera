/* eslint-disable @next/next/no-img-element -- small static brand PNGs, no optimisation needed */

/**
 * Onera brand assets, cut from the supplied logo onto transparency
 * (public/brand). The lockup already contains the "Onera" wordmark, so it is
 * the accessible name wherever it is used.
 */
const LOCKUP_ASPECT = 868 / 259;

/** The three-ring mark on its own. Decorative unless given a label. */
export function LogoMark({ size = 28, label }: { size?: number; label?: string }) {
  return (
    <img
      className="logo-mark"
      src="/brand/onera-mark.png"
      width={size}
      height={size}
      alt={label ?? ""}
      aria-hidden={label ? undefined : true}
    />
  );
}

/** Mark + "Onera" wordmark. */
export function LogoLockup({ height = 26 }: { height?: number }) {
  return (
    <img
      className="logo-lockup"
      src="/brand/onera-logo.png"
      width={Math.round(height * LOCKUP_ASPECT)}
      height={height}
      alt="Onera"
    />
  );
}
