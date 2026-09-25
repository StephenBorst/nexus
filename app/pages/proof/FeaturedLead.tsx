// ── FEATURED LEAD — the best config we have, and its real verdict ─────────────
// The booth hero. Basis × CVD Stack is the current lead: the basis-extreme fade taken
// ONLY when same-hour CVD divergence leans the same way. Its read grades PREDICTIVE on
// the signal scoreboard; the strategy around it is thin (≈9 trades over 33d of recorded
// history in the 2026-09-24 replays) and the walk-forward came back NOT ROBUST. We print
// that rather than bury it — this board grades our own work the way it grades everyone
// else's.
//
// ⚠️ Every receipt here must be true of the EXACT preset the Deploy button loads. The
// first cut printed $ figures from a user-edited config (different exits/hold, and a
// walk-forward run with extra filters on) next to the preset's button. Dollar receipts
// come back only when measured on this preset, unedited (Load → Test/Validate, no changes).
//
// Self-contained on purpose: reads NO endpoint (its identity + config come from the
// same preset the Lab/Bankr skill deploy), so it always renders crisp for a 90-second
// demo — no cold-start emptiness. The self-funding line ties the edge to real revenue:
// the same funding signals are sold as data via x402, priced in $NEXUS.
import { useNavigate } from "react-router-dom";
import { STRATEGY_PRESETS } from "@/config/strategyPresets";
import { deployToAgent } from "@/utils/agentPrefill";
import { bareTicker } from "@/utils/utils";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BONE = "#ededf0", BRIGHT = "#f4f4f5", FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b";
const POS = "#3ecf8e", AMBER = "#e0a458", NEG = "#f7525f";
const BORDER = "#232327", SURFACE_ALT = "#0f0f11", INSET = "#08080a";
// The append-only ledger anchor ON ARBITRUM — public, no login, always resolves.
// A judge can tap this on a phone and see the Anchored events (every committed
// root). Cleaner on-stage proof than raw ledger JSON, and screenshot-able offline.
const ANCHOR_EXPLORER = "https://arbiscan.io/address/0x57a698df84a44F3dA3dac3E08CA455a55A4eff84";

const LEAD = STRATEGY_PRESETS.find((p) => p.id === "basis-cvd-stack");

// The receipts — each one true of this preset as deployed. Backtest-derived rows are
// labelled as such; none of this is a live track record.
const RECEIPTS: { label: string; value: string; tone?: string }[] = [
  { label: "the read", value: "◆ PREDICTIVE", tone: POS },
  { label: "sample", value: "~9 trades · 33d", tone: AMBER },
  { label: "walk-forward", value: "NOT ROBUST", tone: NEG },
  { label: "live record", value: "none yet", tone: AMBER },
];

export default function FeaturedLead({ isMobile }: { isMobile?: boolean }) {
  const navigate = useNavigate();
  if (!LEAD) return null;
  const c = LEAD.config;
  const syms = (c.symbols || []).map((s) => bareTicker(s)).join(" · ");

  const receipt = (r: { label: string; value: string; tone?: string }) => (
    <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 2, background: INSET, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "8px 11px", flex: isMobile ? "1 1 44%" : "0 1 auto" }}>
      <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.12em", textTransform: "uppercase", color: MUTED, whiteSpace: "nowrap" }}>{r.label}</span>
      <span style={{ fontFamily: MONO, fontSize: 14, fontWeight: 700, color: r.tone || FOG }}>{r.value}</span>
    </div>
  );

  return (
    <div style={{ marginTop: 20, border: `1px solid ${BORDER}`, borderLeft: `2px solid ${AMBER}`, borderRadius: 8, background: SURFACE_ALT, padding: isMobile ? 14 : 18 }}>
      {/* Identity + status tags */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 9, letterSpacing: "0.2em", textTransform: "uppercase", color: MUTED }}>The current lead</span>
        <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: AMBER, border: `1px solid ${AMBER}55`, borderRadius: 3, padding: "2px 6px" }}>NOT YET ROBUST</span>
        <span style={{ fontFamily: MONO, fontSize: 8, fontWeight: 700, letterSpacing: "0.1em", color: AMBER, border: `1px solid ${AMBER}55`, borderRadius: 3, padding: "2px 6px" }}>NOT YET LIVE-PROVEN</span>
      </div>

      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--nx-font-serif, serif)", fontSize: isMobile ? 22 : 26, fontWeight: 700, color: BRIGHT, letterSpacing: "-0.01em", lineHeight: 1.1 }}>
          ◆ {LEAD.name}
        </span>
      </div>

      <div style={{ fontFamily: UI, fontSize: 13, color: FOG, lineHeight: 1.6, maxWidth: 640, marginBottom: 14 }}>
        It takes the basis-extreme fade — a perp far above spot is froth, far below is capitulation — <b style={{ color: BRIGHT }}>only</b> when
        same-hour CVD divergence leans the same way. The read underneath grades <span style={{ color: POS }}>◆ PREDICTIVE</span> on the
        signal scoreboard. The strategy around it is choosy and still thin: about nine trades in 33 days of recorded history.
      </div>

      {/* Backtest receipts — the honest numbers */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        {RECEIPTS.map(receipt)}
      </div>

      {/* Config line — exactly what deploys */}
      <div style={{ fontFamily: MONO, fontSize: 10, color: FAINT, lineHeight: 1.6, marginBottom: 14 }}>
        BASIS FADE + CVD CONFIRM &nbsp;·&nbsp; {syms} &nbsp;·&nbsp; {c.leverage}x &nbsp;·&nbsp; TP {c.tpPercent}% / SL {c.slPercent}% &nbsp;·&nbsp; {c.maxHoldHours}h max hold &nbsp;·&nbsp; ≤{c.maxTradesPerDay} trades/day
      </div>

      {/* Honest label + self-funding line */}
      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 12, fontFamily: UI, fontSize: 12, color: MUTED, lineHeight: 1.6 }}>
        A <b style={{ color: FOG }}>lead</b>, not an edge. The walk-forward came back <b style={{ color: NEG }}>NOT ROBUST</b>: it
        held on some markets and failed on others, over too few weeks to say which is signal. That verdict is printed here
        rather than buried, and it gets re-run as the history grows.
        Run it in <b style={{ color: FOG }}>PAPER</b> to start its forward clock, risk-free — that record is yours,
        not this board. Take it <b style={{ color: FOG }}>live</b> and it joins the graded, on-chain-verifiable agents
        below: real settled trades, never a paper sim. Either way the edge funds itself — the same signals sell as data
        via <a href="https://x402.bankr.bot/0xd9f7b3273b504e1473c3faba6341299d0ec9b449/nexus-signals" target="_blank" rel="noopener" style={{ color: FOG, textDecoration: "underline" }}>x402</a>, priced in $NEXUS.
      </div>

      {/* CTAs — deploy + verify */}
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <button
          onClick={() => (LEAD ? deployToAgent({ ...LEAD.config, mode: "PAPER" }, `the ${LEAD.name} preset (PAPER)`, undefined, navigate) : navigate("/lab?tab=agent"))}
          style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", color: "#08080a", background: BONE, border: "none", borderRadius: 4, padding: "8px 16px", cursor: "pointer" }}
        >
          Deploy in the Lab →
        </button>
        <a
          href={ANCHOR_EXPLORER} target="_blank" rel="noopener noreferrer"
          style={{ fontFamily: MONO, fontSize: 10.5, color: FOG, textDecoration: "none", border: `1px solid ${BORDER}`, borderRadius: 4, padding: "8px 14px", background: "#1a1a1e" }}
        >
          ⛓ Verify on Arbitrum ↗
        </a>
      </div>
    </div>
  );
}
