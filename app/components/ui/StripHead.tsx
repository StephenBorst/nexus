import type { ReactNode } from "react";
import { C } from "@/config/theme";

// ── Section title for a strip of rows (Feed ranks, boards) ─────────────────────
// One shape everywhere: a sans title, its one-line clause, and an optional control on the
// right. Titles are words, never a colour or an emoji; the rows below carry the data.
export function StripHead({ title, sub, right }: { title: string; sub?: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: "4px 10px", flexWrap: "wrap", marginBottom: 10 }}>
      <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 16, fontWeight: 600, letterSpacing: "-0.01em", color: C.text.bright }}>{title}</span>
      {sub && <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 13, color: C.text.muted }}>{sub}</span>}
      {right && <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6 }}>{right}</span>}
    </div>
  );
}
