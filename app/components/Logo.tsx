/** ClearFi mark: a lit squircle with an open "C" stroke. */
export function LogoMark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="cf-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8cb9cc" />
          <stop offset="0.55" stopColor="#00638e" />
          <stop offset="1" stopColor="#003a55" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9.5" fill="url(#cf-fill)" />
      <rect
        x="0.5"
        y="0.5"
        width="31"
        height="31"
        rx="9"
        fill="none"
        stroke="#fff"
        strokeOpacity="0.25"
      />
      <path
        d="M21.5 11.2a7 7 0 1 0 0 9.6"
        fill="none"
        stroke="#fff"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
