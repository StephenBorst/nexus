// A record set one tap away: the title, its count and a one-line note show; the rows open on tap.
// Controlled when `open` + `onToggle` are passed (the "How we grade" link opens it from the top).
import { useState } from "react";
import { C } from "@/config/theme";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";

export default function Fold({ title, count, note, open: openProp, onToggle, children }: {
  title: string; count?: number | null; note?: string; open?: boolean; onToggle?: () => void; children: React.ReactNode;
}) {
  const [own, setOwn] = useState(false);
  const open = openProp ?? own;
  const toggle = onToggle ?? (() => setOwn((v) => !v));
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        style={{ width: "100%", display: "flex", alignItems: "flex-start", gap: 10, background: "none", border: "none", cursor: "pointer", padding: "14px 2px", textAlign: "left", minHeight: 44 }}>
        <span style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, color: C.text.bright }}>{title}</span>
          {count != null && <span style={{ fontFamily: UI, fontSize: 13, color: C.text.muted }}> ({count})</span>}
          {note && <span style={{ display: "block", marginTop: 3, fontFamily: UI, fontSize: 12.5, color: C.text.muted, lineHeight: 1.45 }}>{note}</span>}
        </span>
        <span aria-hidden style={{ fontFamily: MONO, fontSize: 13, color: C.text.muted, lineHeight: "20px" }}>{open ? "−" : "+"}</span>
      </button>
      {open && <div style={{ paddingBottom: 14 }}>{children}</div>}
    </div>
  );
}
