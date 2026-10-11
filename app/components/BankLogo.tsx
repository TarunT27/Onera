/**
 * Institution logo tile. Real logos live in /public/images/banks. Institutions
 * with no real brand (the fictional Northwind import, recipients' banks) fall
 * back to a monogram so every row still has a mark.
 * Logos are decorative: the institution name is always rendered next to them.
 */
const LOGOS: { match: RegExp; src: string; mark?: string }[] = [
  { match: /\btd bank\b|toronto-dominion/i, src: "/images/banks/td.svg" },
  { match: /bank of america/i, src: "/images/banks/bank-of-america.svg", mark: "/images/banks/bank-of-america-mark.svg" },
  { match: /chase/i, src: "/images/banks/chase.svg" },
  { match: /barclays/i, src: "/images/banks/barclays.svg" },
  { match: /\brbc\b|royal bank/i, src: "/images/banks/rbc.svg" },
  // The house brand: Onera Demo Bank, Onera Paper Trading.
  { match: /\bonera\b/i, src: "/images/banks/onera.png" },
];

/** Every tile is the same size (width = size * TILE_ASPECT) so rows line up; artwork is scaled to fit. */
const TILE_ASPECT = 2;

const findLogo = (institution: string) => LOGOS.find((l) => l.match.test(institution)) ?? null;

export function bankLogoSrc(institution: string): string | null {
  return findLogo(institution)?.src ?? null;
}

/** Small inline logo for use beside an institution name. Renders nothing when there is no real logo. */
export function BankMark({ institution }: { institution: string }) {
  const logo = findLogo(institution);
  if (!logo) return null;
  // eslint-disable-next-line @next/next/no-img-element -- static logo assets, no optimisation needed
  return <img className="bank-mark" src={logo.mark ?? logo.src} alt="" aria-hidden />;
}

function monogram(institution: string): string {
  const words = institution
    .replace(/\(.*?\)/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (/^onera/i.test(institution)) return "O";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}

export function BankLogo({
  institution,
  size = 58,
  className = "",
}: {
  institution: string;
  size?: number;
  className?: string;
}) {
  const src = bankLogoSrc(institution);
  return (
    <span
      className={`bank-logo ${src ? "" : "bank-logo-fallback"} ${className}`}
      style={{
        width: Math.round(size * TILE_ASPECT),
        height: size,
        fontSize: Math.round(size * 0.34),
        borderRadius: Math.round(size * 0.24),
        padding: src ? Math.round(size * 0.14) : 0,
      }}
      aria-hidden
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- static logo assets, no optimisation needed
        <img src={src} alt="" />
      ) : (
        monogram(institution)
      )}
    </span>
  );
}
