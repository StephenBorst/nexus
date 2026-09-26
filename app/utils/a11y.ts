import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

/**
 * Keyboard twin of a click on a clickable row or card (a div with role="button"/"link" +
 * tabIndex={0}): Enter or Space runs the same action a real <button> would. Keys typed in a
 * nested control (an input, a button inside the row) are left alone.
 */
export function pressKey(fn: () => unknown) {
  return (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
  };
}

/** Escape closes a modal: the keyboard twin of clicking its backdrop. */
export function useEscapeKey(onEscape: () => unknown, active = true) {
  const ref = useRef(onEscape);
  ref.current = onEscape;
  useEffect(() => {
    if (!active) return;
    const h = (e: globalThis.KeyboardEvent) => { if (e.key === "Escape") ref.current(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [active]);
}
