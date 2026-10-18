// ── THE VERDICT — the top of /proof: what the Oct 15 re-validation decided ─────────────────────
// Until Oct 15 this card was "the current lead": the Basis × CVD Stack with a Deploy button.
// The signed if/then (docs/routines/oct15-if-then.md, written Oct 4 before the numbers existed)
// takes a read off the lead when its traded form loses out of sample: both exit lines negative
// over ≥20 trades each. On Oct 15 they were (docs/routines/oct15-results.md), so there is no lead,
// and the card says so in the page's own words. No Deploy button: the read is AXIS_PAUSED
// (strategyPresets.ts), still graded on the scoreboard below.
//
// ⚠️ RECEIPTS RULE: every number is the scoreboard's as served 2026-10-15 19:06 UTC
// (GET /intel/axis-backtest), dated on the card. Re-measure and re-date on change. A read goes
// back on this card only when it CLEARS: PREDICTIVE, beats random on its side, and its preset
// exit positive out of sample over ≥30 trades. Then the card shows the read, its trade count and
// the date. Nothing more.
//
// Self-contained on purpose: reads no endpoint, so it always renders the same for a demo.
// Layout (borst, 2026-10-18): the verdict line first, the bar in one line, the receipts. No paragraphs;
// the on-chain anchor link moved to the ledger line at the foot of the page.

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a";
const NEG = "#f7525f";
const BORDER = "#232327", INSET = "#08080a";

// Basis × CVD, the strongest read on the board: its entries beat random, its traded exits lose.
const RECEIPTS: { label: string; value: string; tone?: string }[] = [
  { label: "basis × cvd · R grade", value: "+0.19R · 62" },
  { label: "vs random entries", value: "beats 97.3%" },
  { label: "as traded · 12h · since Sep 25", value: "−33.9 bps · 20T", tone: NEG },
  { label: "as traded · 24h · since Sep 25", value: "−30.2 bps · 20T", tone: NEG },
];

export default function FeaturedLead({ isMobile }: { isMobile?: boolean }) {
  const receipt = (r: { label: string; value: string; tone?: string }) => (
    <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 3, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "10px 12px", flex: isMobile ? "1 1 44%" : "1 1 0", minWidth: 0 }}>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, lineHeight: 1.4 }}>{r.label}</span>
      <span style={{ fontFamily: MONO, fontSize: isMobile ? 15 : 17, fontWeight: 700, color: r.tone || BRIGHT, whiteSpace: "nowrap" }}>{r.value}</span>
    </div>
  );

  return (
    <header>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG }}>The proof</span>
        <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: FOG, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "2px 6px" }}>NONE CLEARED · OCT 15</span>
      </div>

      <h1 style={{ margin: 0, fontFamily: "var(--nx-font-ui)", fontSize: isMobile ? 28 : 40, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.03em", lineHeight: 1.08, maxWidth: 760 }}>
        Graded in public. Nothing has cleared the bar yet.
      </h1>

      <p style={{ margin: "12px 0 0", fontFamily: UI, fontSize: 13.5, color: FOG, lineHeight: 1.55, maxWidth: 680 }}>
        The bar, set Oct 4 before the numbers: PREDICTIVE, beats random entries, and profitable as the agent trades it,
        out of sample, over 30+ trades.
      </p>

      <div style={{ marginTop: 20, fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED }}>Closest · Basis × CVD</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
        {RECEIPTS.map(receipt)}
      </div>
      <p style={{ margin: "10px 0 0", fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.55 }}>
        Better entries than chance; its exits give the edge back. Three other basis reads fell to noise. Paper wallets
        keep running. Measured Oct 15, 19:06 UTC.
      </p>
    </header>
  );
}
