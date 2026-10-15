// ── THE LEAD — what the Oct 15 re-validation decided ─────────────────────────
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

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a";
const NEG = "#f7525f";
const BORDER = "#232327", SURFACE_ALT = "#0f0f11", INSET = "#08080a";
// The append-only ledger anchor ON ARBITRUM — public, no login, always resolves.
const ANCHOR_EXPLORER = "https://arbiscan.io/address/0x57a698df84a44F3dA3dac3E08CA455a55A4eff84";

// Basis × CVD, the strongest read on the board: its entries beat random, its traded exits lose.
const RECEIPTS: { label: string; value: string; tone?: string }[] = [
  { label: "basis × cvd · R grade", value: "+0.19R · 62" },
  { label: "vs random entries", value: "beats 97.3%" },
  { label: "as traded · 12h · since Sep 25", value: "−33.9 bps · 20T", tone: NEG },
  { label: "as traded · 24h · since Sep 25", value: "−30.2 bps · 20T", tone: NEG },
];

export default function FeaturedLead({ isMobile }: { isMobile?: boolean }) {
  const receipt = (r: { label: string; value: string; tone?: string }) => (
    <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 2, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "8px 11px", flex: isMobile ? "1 1 44%" : "0 1 auto" }}>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, whiteSpace: "nowrap" }}>{r.label}</span>
      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: r.tone || FOG }}>{r.value}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 20, border: `1px solid ${BORDER}`, borderRadius: 8, background: SURFACE_ALT, padding: isMobile ? 14 : 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: MUTED }}>The lead</span>
        <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: FOG, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "2px 6px" }}>NONE · OCT 15</span>
      </div>

      <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: isMobile ? 20 : 24, fontWeight: 600, color: BRIGHT, letterSpacing: "-0.02em", lineHeight: 1.2, marginBottom: 10 }}>
        Graded in public. Nothing has cleared the bar yet.
      </div>

      <div style={{ fontFamily: UI, fontSize: 13, color: FOG, lineHeight: 1.6, maxWidth: 640, marginBottom: 14 }}>
        The bar was set on Oct 4, before the numbers. A read must grade PREDICTIVE, beat random entries, and make money
        the way the agent trades it, out of sample, over 30 trades or more. On Oct 15 none did.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {RECEIPTS.map(receipt)}
      </div>

      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12, fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        Basis × CVD picks better entries than chance. The exits it trades give the edge back, so it is off the lead. It
        stays on the board below, graded every hour. Three other basis reads fell to noise as the sample grew. The paper
        wallets keep running. Measured Oct 15, 19:06 UTC.
      </div>

      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <a
          href={ANCHOR_EXPLORER} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, color: FOG, textDecoration: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "8px 14px", background: "#1a1a1e" }}
        >
          ⛓ Verify on Arbitrum ↗
        </a>
      </div>
    </div>
  );
}
