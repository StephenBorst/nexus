// The weekly scorecard on /proof (borst 2026-11-16, pipeline-if-then.md "Weekly scorecard"; rules app/lib/weeklyScorecard.mjs).
// One frozen snapshot per week from lab-api (GET /proof/weekly), never rewritten, with its sha256 and the command to
// check it. Display only: every line comes from the stored week; nothing here grades or ranks.
import { useEffect, useState } from "react";
import { C } from "@/config/theme";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { sideLine, stageLine, callsLine, weekLabel, fmtR } from "@/lib/weeklyScorecard.mjs";
import Fold from "./Fold";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;

type Side = { n: number; meanR: number | null; randomR: number | null; pct: number | null } | null;
type Read = { axis: string; stage: string; stageWas: string | null; events: number; eventsWeek: number | null; meanR: number | null; sides: { LONG: Side; SHORT: Side } };
type Paper = { axis: string; unread?: boolean; closedWeek?: number; targets?: number; stops?: number; timeStops?: number; trades?: number | null; of?: number; verdict?: string | null };
type Calls = { graded: number; wins: number; netR: number; mae: { n: number; median: number | null }; mfe: { n: number; median: number | null } };
type Week = { week: string; from: string; to: string; builtAt: string; tide: { long: number; short: number } | null; reads: Read[]; paper: Paper[]; calls: { people: Calls; engines: Calls }; note: string };
type Index = { week: string; sha256: string; builtAt: string }[];

export default function WeeklyScorecard() {
  const isMobile = useIsMobile();
  const [weeks, setWeeks] = useState<Index | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [snap, setSnap] = useState<Week | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch(`${API}/proof/weekly`).then((r) => r.json()).then((d) => {
      setWeeks(Array.isArray(d?.weeks) ? d.weeks : []);
      if (d?.latest) { setSnap(d.latest); setPick(d.latest.week); }
    }).catch(() => setFailed(true));
  }, []);
  useEffect(() => {
    if (!pick || snap?.week === pick) return;
    fetch(`${API}/proof/weekly/${pick}`).then((r) => r.json()).then(setSnap).catch(() => setFailed(true));
  }, [pick, snap?.week]);

  const entry = weeks?.find((w) => w.week === pick) || null;
  const note = failed ? "Couldn’t load the weekly scorecard." : weeks && !weeks.length
    ? "The first week is written after its Monday 00:00 UTC close." : snap ? `${weekLabel(snap)} · frozen, never rewritten` : "Loading…";
  const line = { fontFamily: UI, fontSize: 13, lineHeight: 1.55, color: FOG, margin: 0 } as const;
  const tested = snap?.reads.filter((r) => r.events > 0 || (r.eventsWeek ?? 0) > 0) ?? [];

  return (
    <Fold title="This week on the record" note={note}>
      {snap && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16, padding: isMobile ? "0 2px" : "0 4px" }}>
          {weeks && weeks.length > 1 && (
            <label style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, display: "flex", gap: 8, alignItems: "center" }}>
              Week
              <select id="weekly-pick" value={pick ?? ""} onChange={(e) => setPick(e.target.value)}
                style={{ background: C.surface, color: BRIGHT, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 6px", fontFamily: MONO, fontSize: 12 }}>
                {weeks.map((w) => <option key={w.week} value={w.week}>{w.week}</option>)}
              </select>
            </label>
          )}
          {snap.tide && (
            <p style={line}>The market (since the series began): a random long earned {fmtR(snap.tide.long)} a trade, a random short {fmtR(snap.tide.short)}. Each side below is compared with its own random entry, not zero.</p>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {tested.length ? tested.map((r) => (
              <div key={r.axis} style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, minWidth: 0 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "baseline" }}>
                  <span style={{ fontFamily: MONO, fontSize: 12.5, color: BRIGHT, overflowWrap: "anywhere" }}>{r.axis}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: r.stageWas && r.stageWas !== r.stage ? BRIGHT : MUTED }}>{stageLine(r)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
                    {r.eventsWeek != null ? `+${r.eventsWeek} this week · ` : ""}{r.events} since registration{r.meanR != null ? ` · mean ${fmtR(r.meanR)}` : ""}
                  </span>
                </div>
                {(["LONG", "SHORT"] as const).map((s) => { const t = sideLine(s, r.sides[s]); return t ? <p key={s} style={{ ...line, fontSize: 12.5, color: MUTED }}>{t}</p> : null; })}
              </div>
            )) : <p style={line}>No registered read has new events yet.</p>}
          </div>

          {snap.paper.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontFamily: UI, fontSize: 12, fontWeight: 600, color: BRIGHT }}>Paper wallets · counts until their 30-trade judgment</span>
              {snap.paper.map((p) => (
                <p key={p.axis} style={{ ...line, fontSize: 12.5 }}>
                  <span style={{ fontFamily: MONO, color: BRIGHT }}>{p.axis}</span>{" "}
                  {p.unread ? "unread this week" : `${p.closedWeek} closed this week (${p.targets} targets, ${p.stops} stops${p.timeStops ? `, ${p.timeStops} time stops` : ""}) · ${p.trades ?? "—"} of ${p.of}${p.verdict ? ` · ${p.verdict.toLowerCase()}` : ""}`}
                </p>
              ))}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontFamily: UI, fontSize: 12, fontWeight: 600, color: BRIGHT }}>Graded calls this week · people and our engines apart</span>
            <p style={{ ...line, fontSize: 12.5 }}>{callsLine(snap.calls.people, "People")}</p>
            <p style={{ ...line, fontSize: 12.5 }}>{callsLine(snap.calls.engines, "Engines")}</p>
          </div>

          <p style={{ ...line, fontSize: 12, color: MUTED }}>{snap.note}</p>
          {entry && (
            <div style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT, lineHeight: 1.6, overflowWrap: "anywhere" }}>
              Built {snap.builtAt.slice(0, 16).replace("T", " ")} UTC · sha256 {entry.sha256}
              <br />Check it: curl -s {API}/proof/weekly/{entry.week} | sha256sum
            </div>
          )}
        </div>
      )}
    </Fold>
  );
}
