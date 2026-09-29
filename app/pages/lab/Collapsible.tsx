import { useState } from "react";
import { useIsMobile } from "./useIsMobile";
import { C } from "@/config/theme";

// ── Collapsible — progressive disclosure for the Lab ─────────────────────────
// The engine surfaces the synthesized read up top; the raw/deep boards live behind
// a header the user opens on demand, so a tab is one screen by default, not twenty.
// Remembers its open/closed state per storageKey.

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

  // One row for both widths: chevron, title, then its clause. On a phone the clause flows after
  // the title and wraps beneath it (shortTitle/shortSub keep that wrap human); on desktop it sits
  // on the same line. The open state is the chevron + a brighter title, no "expand" word.
  const t = isMobile ? (shortTitle ?? title) : title;
  const sub = isMobile ? (shortSub ?? subtitle) : subtitle;
  return (
    <div className="nx-collapsible" style={{ marginTop: isMobile ? 12 : 14, borderTop: `1px solid ${C.border}` }}>
      <button type="button" onClick={toggle} aria-expanded={open} className="nx-press" style={{
        width: "100%", display: "flex", alignItems: isMobile ? "flex-start" : "center", gap: 12, background: "none", border: "none",
        padding: isMobile ? "14px 2px" : "15px 2px", cursor: "pointer", textAlign: "left",
      }}>
        <span aria-hidden style={{
          width: 20, height: 20, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
          borderRadius: 5, border: `1px solid ${open ? C.borderStrong : C.border}`, color: open ? C.text.bright : C.text.muted,
          transition: "transform 0.15s", transform: open ? "rotate(90deg)" : "none",
        }}>
          <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M2.75 1.25L5.5 4L2.75 6.75" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.45, paddingTop: isMobile ? 1 : 0 }}>
          <span style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, letterSpacing: "-0.005em", color: open ? C.text.bright : C.text.fog }}>{t}</span>
          {sub && <span style={{ fontFamily: UI, fontSize: 13, color: C.text.muted }}>{isMobile ? " " : "  ·  "}{sub}</span>}
        </span>
      </button>
      {open && <div className="nx-fade-in" style={{ paddingTop: 4, paddingBottom: 6 }}>{children}</div>}
    </div>
  );
}

export default Collapsible;
