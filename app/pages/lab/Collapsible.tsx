import { useState } from "react";
import { useIsMobile } from "./useIsMobile";

// ── Collapsible — progressive disclosure for the Lab ─────────────────────────
// The engine surfaces the synthesized read up top; the raw/deep boards live behind
// a header the user opens on demand, so a tab is one screen by default, not twenty.
// Remembers its open/closed state per storageKey.

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";

export function Collapsible({ title, subtitle, shortTitle, shortSub, defaultOpen = false, storageKey, children }: {
  // Desktop uses title/subtitle. On a phone a long "A · B" title breaks on the mid-dot, so a
  // caller passes shortTitle (one line / two short words) + shortSub (its clause) for a human wrap.
  title: string; subtitle?: string; shortTitle?: string; shortSub?: string; defaultOpen?: boolean; storageKey?: string; children: React.ReactNode;
}) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(() => {
    if (storageKey) { try { const v = window.localStorage.getItem(storageKey); if (v != null) return v === "1"; } catch { /* private mode */ } }
    return defaultOpen;
  });
  const toggle = () => {
    const n = !open; setOpen(n);
    if (storageKey) { try { window.localStorage.setItem(storageKey, n ? "1" : "0"); } catch { /* ignore */ } }
  };

  // ── Mobile — a HUMAN wrap. One short title + its clause flow on one baseline (the clause
  // continues after the title where width allows, wraps beneath when not), both ≥12px, and
  // "expand" is pinned top-right (flexShrink:0, aligned to the first line) so it never sits over
  // the copy. This kills the old three-line "CROWD vs SMART" break. Desktop stays exactly as it was.
  if (isMobile) {
    const t = shortTitle ?? title;
    const sub = shortSub ?? subtitle;
    return (
      <div style={{ marginTop: 14, borderTop: "1px solid #232327", paddingTop: 2 }}>
        <button type="button" onClick={toggle} className="nx-press" style={{
          width: "100%", display: "flex", alignItems: "flex-start", gap: 8, background: "none", border: "none",
          padding: "12px 2px", cursor: "pointer", textAlign: "left",
        }}>
          <span aria-hidden style={{ fontFamily: MONO, fontSize: 12, color: open ? "#ededf0" : "#71717a", width: 12, flexShrink: 0, marginTop: 1, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>›</span>
          <span style={{ flex: 1, minWidth: 0, lineHeight: 1.45 }}>
            <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: "0.06em", color: "#ededf0" }}>{t}</span>
            {sub && <span style={{ fontFamily: UI, fontSize: 12, color: "#71717a" }}>{" "}{sub}</span>}
          </span>
          <span style={{ flexShrink: 0, marginTop: 1, fontFamily: MONO, fontSize: 10, color: "#52525b" }}>{open ? "collapse" : "expand"}</span>
        </button>
        {open && <div className="nx-fade-in" style={{ paddingTop: 6 }}>{children}</div>}
      </div>
    );
  }

  // ── Desktop — unchanged. ─────────────────────────────────────────────────────
  return (
    <div style={{ marginTop: 18, borderTop: "1px solid #232327", paddingTop: 2 }}>
      <button type="button" onClick={toggle} className="nx-press" style={{
        width: "100%", display: "flex", alignItems: "center", gap: 10, background: "none", border: "none",
        padding: "13px 2px", cursor: "pointer", textAlign: "left",
      }}>
        <span aria-hidden style={{ fontFamily: MONO, fontSize: 12, color: open ? "#ededf0" : "#71717a", width: 12, transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none" }}>›</span>
        <span style={{ fontFamily: MONO, fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#ededf0" }}>{title}</span>
        {subtitle && <span style={{ fontFamily: UI, fontSize: 11, color: "#71717a" }}>{subtitle}</span>}
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 10, color: "#52525b" }}>{open ? "collapse" : "expand"}</span>
      </button>
      {open && <div className="nx-fade-in" style={{ paddingTop: 6 }}>{children}</div>}
    </div>
  );
}

export default Collapsible;
