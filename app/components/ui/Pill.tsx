import type { ReactNode } from "react";
import { C } from "@/config/theme";

// ── Pill — a chip you pick: a filter, a timeframe, a size shortcut, a quick market ─────────
// One shape everywhere: UI face, sentence case, radius 15. Active = raised surface + strong
// hairline, never a colour. For an action that DOES something, use <Button>.
export function Pill({ children, active = false, onClick, disabled, title, grow, size = "md" }: {
  children: ReactNode;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  grow?: boolean;              // flex: 1 — for an equal-width row (size chips, venue toggle)
  size?: "sm" | "md";
}) {
  const h = size === "sm" ? 26 : 30;
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active} className="nx-press"
      style={{
        flex: grow ? 1 : undefined, flexShrink: 0, height: h, padding: size === "sm" ? "0 10px" : "0 13px",
        fontFamily: "var(--nx-font-ui)", fontSize: size === "sm" ? 12 : 12.5, fontWeight: 600, whiteSpace: "nowrap",
        color: disabled ? C.text.faint : active ? C.text.bright : C.text.fog,
        background: active ? "#ededf012" : "none",
        border: `1px solid ${active ? C.borderStrong : C.border}`, borderRadius: 15,
        cursor: disabled ? "not-allowed" : "pointer",
      }}>
      {children}
    </button>
  );
}
