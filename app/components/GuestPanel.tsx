// One look for a Lab tab before a wallet connects (borst 2026-11-21: "knock out any other areas that need it").
// Quick Trade and the Holders Room used to show one small line on an empty page. Now: what the tab does, in
// plain lines, and the next step. Facts only, no promise.
import type { ReactNode } from "react";
import { C, MONO, UI } from "@/config/theme";

const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;

export function GuestPanel({ eyebrow, title, lede, rows, children, footnote }: {
  eyebrow: string; title: string; lede: string;
  rows: { k: string; v: ReactNode }[];
  children?: ReactNode; footnote?: ReactNode;
}) {
  return (
    <div style={{ maxWidth: 720, margin: "8px auto 0", border: `1px solid ${C.border}`, borderRadius: 12, background: C.surfaceAlt, padding: "22px 22px 18px" }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: MUTED, textTransform: "uppercase" }}>{eyebrow}</div>
      <div style={{ fontFamily: UI, fontSize: 22, fontWeight: 600, color: BRIGHT, marginTop: 8, letterSpacing: "-0.01em" }}>{title}</div>
      <div style={{ fontFamily: UI, fontSize: 13.5, color: FOG, marginTop: 6, lineHeight: 1.6 }}>{lede}</div>
      <div style={{ marginTop: 14 }}>
        {rows.map((r) => (
          <div key={r.k} style={{ display: "grid", gridTemplateColumns: "minmax(0, 150px) minmax(0, 1fr)", gap: 12, padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <span style={{ fontFamily: UI, fontSize: 13, color: BRIGHT }}>{r.k}</span>
            <span style={{ fontFamily: UI, fontSize: 13, color: FOG, lineHeight: 1.55 }}>{r.v}</span>
          </div>
        ))}
      </div>
      {children && <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginTop: 16 }}>{children}</div>}
      {footnote && <div style={{ fontFamily: UI, fontSize: 12, color: MUTED, marginTop: 14, lineHeight: 1.55 }}>{footnote}</div>}
    </div>
  );
}
