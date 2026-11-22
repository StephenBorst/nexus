// The strategy shelf (Agent → Config): every strategy on its way to the agent, its stage as the
// scoreboard serves it, what it still needs and a rough date. Load works only at Paper, and only
// for a strategy an agent preset trades exactly; every other row is greyed with the reason.
// Rules: app/lib/strategyShelf.mjs (tested). Display only: nothing here grades or trades.
import { useEffect, useState } from "react";
import { shelfRows, shelfButtonLabel } from "@/lib/strategyShelf.mjs";
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

export function StrategyShelf({ onLoad }: { onLoad: (presetId: string) => void }) {
  const [rows, setRows] = useState<ShelfRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Every registered read already runs its own public paper agent (house runs): each row links to it, so a row that
  // can't load yet still has something live to open (2026-11-22).
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
      <div style={agentLabelStyle}>STRATEGY SHELF <span style={{ color: C.text.muted }}>· a strategy loads once it reaches Paper</span></div>
      <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 12, lineHeight: 1.55, marginTop: 4 }}>
        Each strategy earns its way here on new data: Testing → Lead → Edge → Tradeable → Paper. Paper is the strategy’s own
        stage, not your agent’s mode: Load turns on once the strategy reaches it and an agent preset trades its exact rule.
        {rows && !rows.some((r) => r.canLoad) ? " None is there yet. Each one’s public paper run is linked below." : ""}
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
                {r.need && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>Needs {r.need}.</div>}
                {r.note && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 11, marginTop: 3, lineHeight: 1.4 }}>{r.note}</div>}
                {r.eta && <div style={{ color: C.text.muted, fontFamily: MONO, fontSize: 10, marginTop: 2 }}>{r.eta}</div>}
              </div>
              <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 3, maxWidth: isMobile ? "100%" : 260 }}>
                <Button variant={r.canLoad ? "primary" : "secondary"} size="sm" disabled={!r.canLoad} onClick={() => r.canLoad && r.presetId && onLoad(r.presetId)}
                  title={r.canLoad ? "Load into the agent, review, then Save" : r.reason}>
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
