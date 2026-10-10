"use client";

import { useEffect, useState } from "react";

const PALETTES = [
  { id: "graphite", name: "Graphite & gold", canvas: "#1a1a1a", silver: "#c1c6ce", accent: "#f2b705" },
  { id: "midnight", name: "Midnight & champagne", canvas: "#0b1423", silver: "#becadb", accent: "#ddba72" },
  { id: "plum", name: "Plum & silver", canvas: "#191320", silver: "#c7c0d3", accent: "#cdb184" },
] as const;

type Palette = (typeof PALETTES)[number]["id"];
const STORAGE_KEY = "clearfi.palette.v1";

function isPalette(value: string | null): value is Palette {
  return PALETTES.some((palette) => palette.id === value);
}

function applyPalette(palette: Palette) {
  document.documentElement.dataset.palette = palette;
  document.querySelector('meta[name="theme-color"]')?.setAttribute(
    "content",
    PALETTES.find((item) => item.id === palette)!.canvas,
  );
}

export function PaletteSwitcher() {
  const [selected, setSelected] = useState<Palette>("graphite");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (isPalette(saved)) {
        applyPalette(saved);
        setSelected(saved);
      }
    } catch {
      // The default palette works even when browser storage is unavailable.
    }
  }, []);

  function choose(palette: Palette) {
    setSelected(palette);
    applyPalette(palette);
    try {
      window.localStorage.setItem(STORAGE_KEY, palette);
    } catch {
      // This choice still applies for the current page.
    }
  }

  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <p className="text-xs font-medium text-zinc-400">Dark palettes</p>
      <div className="flex max-w-full flex-wrap gap-2" role="group" aria-label="Choose a dark color palette">
        {PALETTES.map((palette) => (
          <button
            key={palette.id}
            type="button"
            aria-pressed={selected === palette.id}
            onClick={() => choose(palette.id)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
              selected === palette.id
                ? "border-brand-500/60 bg-brand-950 text-zinc-50"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-600 hover:text-zinc-50"
            }`}
          >
            <span className="flex -space-x-1" aria-hidden>
              {[palette.canvas, palette.silver, palette.accent].map((color) => (
                <span key={color} className="size-3.5 rounded-full ring-1 ring-white/25" style={{ backgroundColor: color }} />
              ))}
            </span>
            {palette.name}
          </button>
        ))}
      </div>
    </div>
  );
}
