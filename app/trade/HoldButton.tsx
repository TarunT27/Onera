"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "../components/I18nContext";

const HOLD_MS = 1200;

/**
 * Press and hold to confirm, so an approval can't happen by accident.
 * Works with a pointer (press and hold) or the keyboard (hold Space or Enter).
 */
export function HoldButton({
  label,
  busyLabel,
  busy,
  disabled,
  onConfirm,
}: {
  label: string;
  busyLabel: string;
  busy: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const t = useT();
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (disabled || busy || timer.current) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      onConfirm();
    }, HOLD_MS);
  };
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      className={`hold-button${holding ? " holding" : ""}`}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      aria-describedby="hold-hint"
      onPointerDown={(e) => {
        if (e.button === 0) start();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if ((e.key === " " || e.key === "Enter") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === " " || e.key === "Enter") cancel();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <span className="hold-fill" aria-hidden />
      <span className="hold-label">{busy ? busyLabel : holding ? t("Keep holding…") : label}</span>
      <span id="hold-hint" className="sr-only">
        {t("Press and hold for about one second to confirm.")}
      </span>
    </button>
  );
}
