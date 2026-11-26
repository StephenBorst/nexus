// The strategy shelf (Agent → Config): every strategy, its stage as the scoreboard serves it, its grade,
// what it still needs and a rough date. As cards (visual pass, borst 2026-11-26): the Quick-start preset look, one card
// language with /proof's lead cards (app/components/ReadCard.tsx): stage chip, the rule in one line, the numbers, Load;
// what it still needs stays, smaller. Every row loads into the agent ON PAPER, whatever its stage
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
import { CardHead, CardShell, Tiles, WHY, WordChip } from "@/components/ReadCard";

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
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fill, minmax(260px, 1fr))", gap: 10, marginTop: 12 }}>
          {rows.map((r) => (
            <CardShell key={r.id}>
              <CardHead title={r.name} stage={r.stageWord} />
              {r.rule && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 12, lineHeight: 1.5, marginTop: -4 }}>{r.rule}</div>}

              {/* The numbers: new-data trades + how often it beat random. No mean R here, so nothing stands alone. */}
              {r.grade && (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <WordChip word={{ key: r.grade.key, text: r.grade.word }} />
                  </div>
                  <Tiles tiles={[
                    { key: "n", big: r.grade.events, cap: "NEW TRADES", why: WHY.trades },
                    { key: "pct", big: r.grade.events >= 5 && r.grade.pct != null ? `${Math.round(r.grade.pct)}%` : "—", cap: "BEAT RANDOM", why: WHY.beat },
                  ]} />
                </>
              )}
              {r.note && <div style={{ color: C.text.fog, fontFamily: UI, fontSize: 12, lineHeight: 1.45 }}>{r.note}</div>}

              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                <Button variant={r.canLoad ? "primary" : "secondary"} size="sm" disabled={!r.canLoad}
                  onClick={() => { const config = shelfConfig(r); if (r.canLoad && config) onLoad({ name: r.name, stageWord: r.stageWord, config }); }}
                  title={r.reason}>
                  {shelfButtonLabel(r)}
                </Button>
                {r.kind === "read" && runs[r.id] && (
                  <Link to={`/proof/paper/${r.id}`} style={{ color: C.text.fog, fontFamily: UI, fontSize: 11.5, textDecoration: "none" }}>
                    {paperCountLine(runs[r.id])} →
                  </Link>
                )}
              </div>
              {!r.canLoad && <span style={{ color: C.text.muted, fontFamily: UI, fontSize: 11, lineHeight: 1.4 }}>{r.reason}</span>}

              {/* What it still needs: kept, secondary. */}
              {(r.need || r.eta) && (
                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 8, color: C.text.muted, fontFamily: UI, fontSize: 11, lineHeight: 1.45 }}>
                  {r.need && <>Needs {r.need}.</>}{r.eta && <span style={{ fontFamily: MONO, fontSize: 10 }}>{r.need ? " " : ""}{r.eta}</span>}
                </div>
              )}
            </CardShell>
          ))}
        </div>
      )}
    </div>
  );
}
