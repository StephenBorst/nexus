// The /proof status strip (borst 2026-11-21): Cleared · Leads · Still testing, counted from the board's own groups
// (proofLayout.mjs statusCounts over signalCard.mjs boardGroups), with jump chips. Sticky under the nav on desktop only:
// on a phone the app's own nav is already sticky, so the strip scrolls with the page.
import { C } from "@/config/theme";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;

export type Jump = { id: string; label: string; onClick?: () => void };

export default function ProofStatus({ counts, jumps, isMobile }: { counts: { cleared: number; lead: number; testing: number } | null; jumps: Jump[]; isMobile: boolean }) {
  const go = (j: Jump) => { if (j.onClick) j.onClick(); else document.getElementById(j.id)?.scrollIntoView({ behavior: "smooth", block: "start" }); };
  const cell = (n: number | null, word: string, lit: boolean) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: isMobile ? 22 : 26, fontWeight: 500, fontVariantNumeric: "tabular-nums", color: lit ? BRIGHT : FOG }}>{n ?? "—"}</span>
      <span style={{ fontFamily: UI, fontSize: 13, color: MUTED, whiteSpace: "nowrap" }}>{word}</span>
    </div>
  );
  return (
    <nav aria-label="Where the reads stand" style={{
      // A whole card (borst 2026-11-21): border on all four sides, rounded, its own inner padding, so the band never
      // starts flush on the first number. Sticky, it keeps a gap above it and a soft shadow over what scrolls under.
      marginTop: 24, padding: isMobile ? "14px 16px" : "16px 20px 14px", background: C.surfaceAlt, border: `1px solid ${C.border}`, borderRadius: 12,
      ...(isMobile ? {} : { position: "sticky" as const, top: 8, zIndex: 5, boxShadow: `0 8px 24px ${C.canvas}` }),
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: isMobile ? "6px 18px" : "6px 28px" }}>
        {cell(counts?.cleared ?? null, "cleared", !!counts?.cleared)}
        {cell(counts?.lead ?? null, counts?.lead === 1 ? "lead" : "leads", true)}
        {cell(counts?.testing ?? null, "still testing", false)}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
        {jumps.map((j) => (
          <button key={j.id} type="button" onClick={() => go(j)}
            style={{ fontFamily: UI, fontSize: 12, color: FOG, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 999, padding: "5px 11px", minHeight: 30, cursor: "pointer", whiteSpace: "nowrap" }}>
            {j.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
