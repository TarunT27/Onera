/**
 * Agent avatars: one calm, soft-gradient disc per monitoring agent, drawn as
 * inline SVG so they stay crisp from 20px chips to 48px headers. Each agent
 * keeps its own hue and a simple white glyph:
 *
 *   personal_assistant    blue    offset lens with a bright point
 *   portfolio_monitor     green   three rising bars
 *   subscription_monitor  violet  two arcs chasing each other (a renewal cycle)
 *   threat_monitor        slate   a watching arc around a centre point
 *   spending_monitor      sand    a donut-chart slice
 *   security_sentinel     indigo  a closed ring around a centre point
 *   connection_monitor    cyan    two linked nodes
 *
 * Decorative by default: the agent's name is always rendered next to it.
 */
import { useId, type ReactNode } from "react";

type Glyph = (id: string) => ReactNode;

interface AgentLook {
  /** Top-left and bottom-right of the disc gradient. */
  from: string;
  to: string;
  glyph: Glyph;
}

const WHITE = "#f7f9fc";

/** Clockwise arc on a circle centred at (20, 20); angles in degrees, 0° = 3 o'clock. */
function arc(r: number, start: number, end: number): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const sweep = (((end - start) % 360) + 360) % 360;
  const x0 = 20 + r * Math.cos(rad(start));
  const y0 = 20 + r * Math.sin(rad(start));
  const x1 = 20 + r * Math.cos(rad(end));
  const y1 = 20 + r * Math.sin(rad(end));
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const LOOKS: Record<string, AgentLook> = {
  personal_assistant: {
    from: "#a3cefa",
    to: "#5a9be8",
    glyph: () => (
      <>
        <circle cx="24.1" cy="20.2" r="13.3" fill="#4a8ae0" opacity="0.38" />
        <circle cx="17.6" cy="21" r="4.2" fill={WHITE} />
      </>
    ),
  },
  portfolio_monitor: {
    from: "#ade8cf",
    to: "#6cc0a2",
    glyph: (id) => (
      <>
        <defs>
          <linearGradient id={`${id}-bar`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#e6f8f0" />
            <stop offset="1" stopColor="#a8e1c7" />
          </linearGradient>
        </defs>
        <g fill={`url(#${id}-bar)`} clipPath={`url(#${id}-disc)`}>
          <rect x="3.2" y="24" width="10.6" height="20" rx="5.3" />
          <rect x="14.7" y="17" width="10.6" height="27" rx="5.3" />
          <rect x="26.2" y="10.2" width="10.6" height="34" rx="5.3" />
        </g>
      </>
    ),
  },
  subscription_monitor: {
    from: "#c6c0fc",
    to: "#9a91e8",
    glyph: () => (
      <>
        <circle cx="20" cy="20" r="10.3" fill="#8f86e0" opacity="0.32" />
        <g fill="none" stroke="#efedfd" strokeWidth="3.6" strokeLinecap="round">
          <path d={arc(12.2, 182, 265)} />
          <path d={arc(12.2, 2, 85)} />
        </g>
      </>
    ),
  },
  threat_monitor: {
    from: "#abbfda",
    to: "#6c83a3",
    glyph: () => (
      <>
        <circle cx="20" cy="20" r="10.9" fill="#5f7698" opacity="0.4" />
        <circle cx="20" cy="20" r="10.9" fill="none" stroke="#c3d0e3" strokeOpacity="0.35" strokeWidth="0.6" />
        <path d={arc(13.4, 280, 154)} fill="none" stroke={WHITE} strokeWidth="3.5" strokeLinecap="round" />
        <circle cx="20" cy="20" r="3.8" fill={WHITE} />
      </>
    ),
  },
  spending_monitor: {
    from: "#f4d6b8",
    to: "#d9a07c",
    glyph: () => (
      <>
        <circle cx="20" cy="20" r="10.6" fill="#c98c66" opacity="0.32" />
        <circle cx="20" cy="20" r="11.6" fill="none" stroke={WHITE} strokeOpacity="0.35" strokeWidth="3.6" />
        <path d={arc(11.6, 270, 30)} fill="none" stroke={WHITE} strokeWidth="3.6" strokeLinecap="round" />
      </>
    ),
  },
  security_sentinel: {
    from: "#b9c1ee",
    to: "#7581c4",
    glyph: () => (
      <>
        <circle cx="20" cy="20" r="12.4" fill="#6470b8" opacity="0.32" />
        <circle cx="20" cy="20" r="10.2" fill="none" stroke={WHITE} strokeWidth="3" />
        <circle cx="20" cy="20" r="3.6" fill={WHITE} />
      </>
    ),
  },
  connection_monitor: {
    from: "#ade5f0",
    to: "#5cb4cd",
    glyph: () => (
      <>
        <circle cx="20" cy="20" r="11.5" fill="#4aa3be" opacity="0.3" />
        <path d="M13.2 24.4 26.8 15.6" stroke={WHITE} strokeWidth="2.6" strokeLinecap="round" />
        <circle cx="13.2" cy="24.4" r="3.9" fill={WHITE} />
        <circle cx="26.8" cy="15.6" r="3.9" fill={WHITE} />
      </>
    ),
  },
};

const FALLBACK: AgentLook = {
  from: "#c4cad3",
  to: "#828b98",
  glyph: () => <circle cx="20" cy="20" r="4" fill={WHITE} />,
};

export function AgentAvatar({
  agentId,
  size = 40,
  label,
  className = "",
}: {
  agentId: string;
  size?: number;
  /** Accessible name; omit when the agent's name is rendered alongside. */
  label?: string;
  className?: string;
}) {
  const id = `agent-${useId().replace(/:/g, "")}`;
  const look = LOOKS[agentId] ?? FALLBACK;
  return (
    <svg
      viewBox="0 0 40 40"
      width={size}
      height={size}
      className={`agent-avatar ${className}`}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      <defs>
        <linearGradient id={`${id}-fill`} x1="0.15" y1="0.05" x2="0.85" y2="0.95">
          <stop offset="0" stopColor={look.from} />
          <stop offset="1" stopColor={look.to} />
        </linearGradient>
        <clipPath id={`${id}-disc`}>
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="20" fill={`url(#${id}-fill)`} />
      {look.glyph(id)}
    </svg>
  );
}
