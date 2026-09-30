import { C } from "@/config/theme";

// ── Chevron — the fold mark on anything that opens and closes ──────────────────
export function Chevron({ open, size = 14 }: { open: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0, color: C.text.muted, transform: open ? "rotate(180deg)" : "none", transition: "transform 160ms ease" }}>
      <path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
