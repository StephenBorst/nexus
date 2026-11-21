// The Trading Agent tab before a wallet connects: live proof first (borst 2026-11-21). Rules app/lib/agentShowcase.mjs.
// Every registered read runs its own paper agent in public; shown as COUNTS of 30, never a P&L. Plus whether live
// entries are open platform-wide and how many live agents publish now. Each row opens the read's public paper page.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { paperRows, haltLine, liveLine, runsSummary } from "@/lib/agentShowcase.mjs";
import { useIsMobile } from "./useIsMobile";

const API = "https://og.nexustradinglabs.com";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;

type Rows = ReturnType<typeof paperRows>;

export function AgentShowcase() {
  const isMobile = useIsMobile();
  const [runs, setRuns] = useState<Rows | null>(null);
  const [halt, setHalt] = useState<ReturnType<typeof haltLine> | null>(null);
  const [live, setLive] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  useEffect(() => {
    let off = false;
    sharedJson(`${API}/signals/paper-counts`).then((d) => { if (!off) setRuns(paperRows(d as never)); });
    sharedJson(`${API}/ops/halt`).then((d) => { if (!off) setHalt(haltLine(d as never)); });
    sharedJson(`${API}/agents/live`).then((d) => { if (!off) setLive(liveLine(d as never)); });
    return () => { off = true; };
  }, []);

  const shown = runs ? (all ? runs.rows : runs.rows.slice(0, 8)) : [];
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, padding: isMobile ? "14px 14px 10px" : "18px 20px 12px", marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: MUTED }}>RUNNING NOW · IN PUBLIC</div>
        <Link to="/proof" style={{ fontFamily: UI, fontSize: 12.5, color: FOG, textDecoration: "none" }}>How they’re graded →</Link>
      </div>
      <div style={{ fontFamily: UI, fontSize: 16, color: BRIGHT, fontWeight: 600, marginTop: 8, lineHeight: 1.35 }}>
        The same agent you’d run, trading every one of our reads on paper.
      </div>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG, marginTop: 4, lineHeight: 1.55 }}>
        {runs ? runsSummary(runs) : "Reading the paper runs…"} Counts only until then: no running P&amp;L.
      </div>

      <div style={{ marginTop: 12 }}>
        {shown.map((r) => (
          <Link key={r.id} to={`/proof/paper/${r.id}`} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", alignItems: "center", gap: 12, padding: "9px 0", borderTop: `1px solid ${C.border}`, textDecoration: "none", minHeight: 40 }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontFamily: UI, fontSize: 13.5, color: BRIGHT }}>{r.title}</span>
              {r.open && <span style={{ marginLeft: 8, fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.08em", color: BRIGHT, border: `1px solid ${C.borderStrong}`, borderRadius: 3, padding: "1px 5px" }}>TRADE OPEN</span>}
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Where it stands of 30: a dot on a track with the 30 tick, never a bar that fills. */}
              {!isMobile && r.count != null && (
                <span aria-hidden style={{ position: "relative", width: 90, height: 10, display: "inline-block" }}>
                  <span style={{ position: "absolute", left: 0, right: 0, top: 4.5, height: 1, background: C.border }} />
                  <span style={{ position: "absolute", right: 0, top: 1, width: 1, height: 8, background: C.borderStrong }} />
                  <span style={{ position: "absolute", top: 2, width: 6, height: 6, marginLeft: -3, borderRadius: "50%", background: BRIGHT, left: `${Math.min(100, (r.count / r.target) * 100)}%` }} />
                </span>
              )}
              <span style={{ fontFamily: MONO, fontSize: 12, color: r.unread ? MUTED : FOG, whiteSpace: "nowrap", minWidth: 74, textAlign: "right" }}>
                {r.unread ? "unread" : `${r.count} of ${r.target}`}
              </span>
              <span aria-hidden style={{ color: FAINT }}>→</span>
            </span>
          </Link>
        ))}
        {runs && runs.rows.length > 8 && (
          <button type="button" onClick={() => setAll((v) => !v)} style={{ background: "none", border: "none", padding: "8px 0", minHeight: 36, cursor: "pointer", fontFamily: UI, fontSize: 12.5, color: FOG }}>
            {all ? "Show fewer ↑" : `Show all ${runs.rows.length} ↓`}
          </button>
        )}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: 4, paddingTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
        {halt && <div style={{ fontFamily: UI, fontSize: 12.5, color: halt.paused ? SIGNAL.watch : FOG, lineHeight: 1.5 }}>{halt.text}</div>}
        {live && <div style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.5 }}>{live}</div>}
      </div>
    </div>
  );
}
