// ── The top of /proof: the verdict in plain words, and the bar in one sentence ──────────────────
// Layout (borst, 2026-10-23: "too dense for normal users"): the headline, one plain sentence on the
// bar, and a link to "How we grade" at the foot of the page. The Oct 15 receipts moved there, still
// dated (Oct15Result below).
//
// ⚠️ The headline is a claim: it stays true while no read has cleared the bar (PREDICTIVE, beats
// random on its side, profitable as traded out of sample over 30+ trades: docs/routines/oct15-if-then.md
// and docs/research/read-pipeline.md). When one clears, this header changes in the same PR.
//
// Self-contained on purpose: reads no endpoint, so it always renders the same for a demo.

import { C } from "@/config/theme";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;

export default function FeaturedLead({ isMobile, onHowWeGrade }: { isMobile?: boolean; onHowWeGrade: () => void }) {
  return (
    <header>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 12 }}>The proof</div>
      <h1 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 28 : 40, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.03em", lineHeight: 1.1, maxWidth: 760 }}>
        Nothing has proven itself yet.
        <span style={{ display: "block", color: FOG }}>Here’s the public record.</span>
      </h1>
      <p style={{ margin: "14px 0 0", fontFamily: UI, fontSize: 15, color: FOG, lineHeight: 1.55, maxWidth: 640 }}>
        To pass, a signal has to beat random entries, make money after fees, and keep doing it on new data, over 30+ trades.
      </p>
      <button type="button" onClick={onHowWeGrade}
        style={{ marginTop: 10, background: "none", border: "none", padding: "6px 0", minHeight: 32, cursor: "pointer", fontFamily: UI, fontSize: 13, color: BRIGHT, textDecoration: "underline", textUnderlineOffset: 3, textDecorationColor: MUTED }}>
        How we grade ↓
      </button>
    </header>
  );
}

// ── The Oct 15 re-validation, as it was decided ──────────────────────────────────────────────
// ⚠️ RECEIPTS RULE: every number is the scoreboard's as served 2026-10-15 19:06 UTC
// (GET /intel/axis-backtest), dated here. Re-measure and re-date on change.
// Basis × CVD, the strongest read on the board then: its entries beat random, its traded exits lose.
const NEG = C.neg;
const RECEIPTS: { label: string; value: string; tone?: string }[] = [
  { label: "basis × cvd · R grade", value: "+0.19R · 62" },
  { label: "vs random entries", value: "beats 97.3%" },
  { label: "as traded · 12h · since Sep 25", value: "−33.9 bps · 20T", tone: NEG },
  { label: "as traded · 24h · since Sep 25", value: "−30.2 bps · 20T", tone: NEG },
];

export function Oct15Result({ isMobile }: { isMobile?: boolean }) {
  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {RECEIPTS.map((r) => (
          <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3, background: C.inset, border: `1px solid ${C.border}`, borderRadius: 6, padding: "10px 12px", flex: isMobile ? "1 1 44%" : "1 1 0", minWidth: 0 }}>
            <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, lineHeight: 1.4 }}>{r.label}</span>
            <span style={{ fontFamily: MONO, fontSize: 15, fontWeight: 700, color: r.tone || BRIGHT, whiteSpace: "nowrap" }}>{r.value}</span>
          </div>
        ))}
      </div>
      <p style={{ margin: "10px 0 0", fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.55 }}>
        Better entries than chance; its exits gave the edge back. Three other basis reads fell to noise. Paper wallets
        keep running. Measured Oct 15, 19:06 UTC.
      </p>
    </div>
  );
}
