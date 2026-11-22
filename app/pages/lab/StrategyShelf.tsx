// The strategy shelf (Agent → Config): every strategy, its stage as the scoreboard serves it, its grade,
// what it still needs and a rough date. Every row loads into the agent ON PAPER, whatever its stage
// (borst 2026-11-22, "open the shelf"; only the CLEARED badge is gated). Rules + the config each row
// loads: app/lib/strategyShelf.mjs (tested). Nothing here grades or trades: Load fills the form, Save sends it.
import { useEffect, useState } from "react";
import { shelfRows, shelfButtonLabel, shelfConfig } from "@/lib/strategyShelf.mjs";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { paperCountLine } from "@/lib/paperRun.mjs";
import { Link } from "react-router-dom";
import { agentCardStyle, agentLabelStyle } from "./styles";
import { C } from "@/config/theme";
import { Button } from "@/components/ui";
import { useIsMobile } from "./useIsMobile";

const SCOREBOARD = "https://og.nexustradinglabs.com/intel/axis-backtest";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui)";

type ShelfRow = ReturnType<typeof shelfRows>[number];

export type ShelfLoad = { name: string; stageWord: string; config: Record<string, unknown> };

export function StrategyShelf({ onLoad }: { onLoad: (load: ShelfLoad) => void }) {
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Every registered read also runs its own public paper agent (house runs): each row links to it, so you can see
  // the strategy's own paper record before you load it (2026-11-22).
  const [runs, setRuns] = useState<Record<string, { count?: number; target?: number; open?: boolean; unread?: boolean }>>({});
  const isMobile = useIsMobile();
  useEffect(() => {
    let alive = true;
    sharedJson("https://og.nexustradinglabs.com/signals/paper-counts").then((d: { runs?: Record<string, never> } | null) => { if (alive && d?.runs) setRuns(d.runs); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch(SCOREBOARD)
      .then((r) => (r.ok ? r.json() : null))
      .then((sc) => {
        if (!alive) return;
        const out = shelfRows(sc);
        if (out.length) setRows(out); else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);

  return (
    <div style={agentCardStyle}>
      <div style={agentLabelStyle}>STRATEGY SHELF <span style={{ color: C.text.muted }}>· every strategy loads on paper</span></div>
      <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
        Load any strategy into your agent on paper, at its exact rule: simulated fills, no orders, no key. Each one’s stage
        and grade stay beside it (Testing → Lead → Edge → Tradeable → Paper). Only a strategy marked CLEARED on /proof has
        passed its bar; everything else is still being tested. Your paper run moves no stage.
      </div>
      {failed && (
        <div style={{ color: C.text.muted, fontFamily: UI, fontSize: 11, marginTop: 12 }}>Couldn’t read the scoreboard. Try again later.</div>
      )}
      {!rows && !failed && (
        <div style={{ color: C.text.muted, fontFamily: MONO, fontSize: 11, marginTop: 12 }}>Reading the scoreboard…</div>
      )}
      {rows && (
        <div style={{ display: "flex", flexDirection: "column", marginTop: 10 }}>
          {rows.map((r) => (
            <div key={r.id} style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "baseline" }}>
                  <span style={{ color: C.text.bright, fontFamily: MONO, fontSize: 12, fontWeight: 600 }}>{r.name}</span>
                  <span style={{ color: C.text.fog, fontFamily: MONO, fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", border: `1px solid ${C.borderStrong}`, borderRadius: 3, padding: "1px 5px" }}>
                    {r.stageWord}
                  </span>
                </div>
                {r.grade && (
                  <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 11.5, marginTop: 3, lineHeight: 1.4 }}>
                    <span style={{ color: C.text.bright }}>{r.grade.word}.</span> {r.grade.line}
                  </div>
                )}
                {r.need && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>Needs {r.need}.</div>}
                {r.note && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>{r.note}</div>}
                {r.eta && <div style={{ color: C.text.muted, fontFamily: MONO, fontSize: 10, marginTop: 2 }}>{r.eta}</div>}
              </div>
              <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 3, maxWidth: isMobile ? "100%" : 260 }}>
                <Button variant={r.canLoad ? "primary" : "secondary"} size="sm" disabled={!r.canLoad}
                  onClick={() => { const config = shelfConfig(r); if (r.canLoad && config) onLoad({ name: r.name, stageWord: r.stageWord, config }); }}
                  title={r.reason}>
                  {shelfButtonLabel(r)}
                </Button>
                {!r.canLoad && <span style={{ color: C.text.muted, fontFamily: UI, fontSize: 11, textAlign: isMobile ? "left" : "right", lineHeight: 1.4 }}>{r.reason}</span>}
                {r.kind === "read" && runs[r.id] && (
                  <Link to={`/proof/paper/${r.id}`} style={{ color: C.text.fog, fontFamily: UI, fontSize: 11.5, textDecoration: "none" }}>
                    {paperCountLine(runs[r.id])} →
                  </Link>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
