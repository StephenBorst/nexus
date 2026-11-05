// ◆ CALLS — the first thing on Lab home (Market Intel). The graded loop, not the market read:
// "Every call is graded from public price" (always shown, even when the read fails), the counts for
// PEOPLE and OUR ENGINES on separate lines (never blended, borst 2026-11-05), and the newest calls of
// both, each row naming its caller and marking engine rows; one tap to the call's own page.
// Same source and rule as the Trade/Spot strip: GET /calls/pulse (lab-api routes-pulse.mjs,
// app/lib/callPulse.mjs): no copies, no house callers. Display only.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { agoShort, gradedText } from "@/lib/callPulse.mjs";
import { useIsMobile } from "./useIsMobile";
import { C, MONO, UI } from "@/config/theme";
import type { TabId } from "./types";

const PULSE_URL = "https://og.nexustradinglabs.com/calls/pulse";

const LIST_MAX = 4;

interface OpenRow { symbol: string; direction: string; at: number; path: string; caller?: string; engine?: boolean }
interface GradedRow extends OpenRow { outcome: "WIN" | "LOSS"; r: number | null }
interface Block { open: number; gradedWeek: number; last: GradedRow | null; openCalls?: OpenRow[]; recentGraded?: GradedRow[] }
interface Pulse extends Block { ok: boolean; engines?: Block }

// Newest first across people and engines; each row already says whose it is.
const merged = <T extends OpenRow>(a?: T[], b?: T[]) => [...(a || []), ...(b || [])].sort((x, y) => y.at - x.at).slice(0, LIST_MAX);

export function LabCallsPanel({ onSelectTab }: { onSelectTab?: (tab: TabId) => void }) {
  const isMobile = useIsMobile();
  const [pulse, setPulse] = useState<Pulse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(PULSE_URL);
        const j = r.ok ? ((await r.json()) as Pulse) : null;
        if (!alive) return;
        if (j && j.ok) setPulse(j); else setFailed(true);
      } catch { if (alive) setFailed(true); }
    })();
    return () => { alive = false; };
  }, []);

  const now = Date.now();
  const blocks: { label: string; b: Block }[] = pulse
    ? [{ label: "People", b: pulse }, ...(pulse.engines ? [{ label: "Our engines", b: pulse.engines }] : [])]
    : [];

  const label = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: C.text.muted };
  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 0",
    borderTop: `1px solid ${C.border}`, textDecoration: "none", fontFamily: UI, fontSize: 13, color: C.text.bright, minWidth: 0,
  };
  const quiet = { fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "9px 0", borderTop: `1px solid ${C.border}` };

  const list = (title: string, rows: (OpenRow | GradedRow)[] | undefined, empty: string) => (
    <div style={{ minWidth: 0 }}>
      <div style={{ ...label, marginBottom: 6 }}>{title}</div>
      {!pulse ? <div style={quiet}>{failed ? "Unavailable right now." : "Loading…"}</div>
        : !rows || rows.length === 0 ? <div style={quiet}>{empty}</div>
        : rows.map((c) => {
          const g = "outcome" in c ? c : null;
          return (
            <Link key={c.path} to={c.path} style={rowStyle}>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  <b style={{ fontWeight: 600 }}>{c.symbol}</b> <span style={{ color: C.text.fog }}>{c.direction === "LONG" ? "Long" : c.direction === "SHORT" ? "Short" : c.direction}</span>
                </span>
                {c.caller && (
                  <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 11.5, color: C.text.muted }}>
                    <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>by {c.caller}</span>
                    {c.engine && <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: C.text.fog, border: `1px solid ${C.borderStrong}`, borderRadius: 3, padding: "0 4px" }}>ENGINE</span>}
                  </span>
                )}
              </span>
              <span style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0, color: C.text.muted, fontSize: 12 }}>
                {g && <span style={{ color: C.text.fog }}>{g.outcome === "WIN" ? "Win" : "Loss"}</span>}
                {g && g.r != null && <span style={{ fontFamily: MONO, color: g.r >= 0 ? C.pos : C.neg }} title="R = the result in units of the risk taken (entry to stop).">{g.r >= 0 ? "+" : ""}{g.r.toFixed(2)}R</span>}
                <span>{agoShort(c.at, now)} ago</span>
                <span aria-hidden style={{ color: C.text.faint }}>→</span>
              </span>
            </Link>
          );
        })}
    </div>
  );

  return (
    <section aria-label="Calls" style={{ border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt, padding: isMobile ? "14px 14px 8px" : "16px 18px 10px", marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <span style={label}>Calls</span>
        <Link to="/proof" style={{ fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: C.text.fog, textDecoration: "none", whiteSpace: "nowrap" }}>See the record →</Link>
      </div>
      {/* The method line: always rendered, never behind a fold or a fetch. */}
      <div style={{ fontFamily: UI, fontSize: isMobile ? 15 : 16, fontWeight: 600, color: C.text.bright, letterSpacing: "-0.01em", lineHeight: 1.35, marginTop: 6 }}>
        Every call is graded from public price. Nothing self-reported.
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, fontFamily: UI, fontSize: 13, color: C.text.fog }}>
        {blocks.length ? blocks.map(({ label, b }) => (
          <div key={label} style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text.muted, minWidth: isMobile ? 0 : 96 }}>{label}</span>
            <span>{b.open} open · {gradedText(b, now)}</span>
          </div>
        )) : <span style={{ color: C.text.muted }}>{failed ? "Live counts unavailable right now." : "Reading the record…"}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: isMobile ? 14 : 28, marginTop: 14 }}>
        {list("Open now", merged(pulse?.openCalls, pulse?.engines?.openCalls), "No open calls right now.")}
        {list("Recently graded", merged(pulse?.recentGraded, pulse?.engines?.recentGraded), "Nothing graded yet.")}
      </div>
      {onSelectTab && (
        <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 6 }}>
          <button type="button" onClick={() => onSelectTab("thesis")} className="nx-text-action"
            style={{ fontFamily: UI, fontSize: 12.5, fontWeight: 600, color: C.text.fog, background: "none", border: "none", padding: "6px 0", cursor: "pointer" }}>
            Post a call →
          </button>
        </div>
      )}
    </section>
  );
}

export default LabCallsPanel;
