// ── The signal scoreboard, as an evidence board ───────────────────────────────────────
// Our own reads, graded the way we grade traders (/intel/axis-backtest). Display only: every
// number is served by the grader; the one-line verdicts come from app/lib/signalCard.mjs.
// Layout (borst, 2026-10-23): the registered reads first, as plain rows (name · events so far ·
// "needs 30", or "failing" with the grader's `next`); their grade on old data opens on tap. Then two
// folds, "Looked good on old data" and "Worse than random", each with its one-line explanation;
// inside, the detailed rows (grade, mean R, events, vs random), a tap opens the full card.
// The tide and the method moved to "How we grade" (HowWeGrade.tsx).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { AXIS_PRESET, AXIS_PAUSED, presetById } from "@/config/strategyPresets";
import { deployToAgent } from "@/utils/agentPrefill";
import { C } from "@/config/theme";
import { AXIS_BLURB, splitLabel, takeaway, sideBar, stageGroups, randomBar } from "@/lib/signalCard.mjs";
import { pipelineLine, countingSince } from "@/lib/proofCopy.mjs";
import Fold from "./Fold";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { pos: POS, neg: NEG, brand: MARK } = C;
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const BONE = C.accent;

// ── data (only the fields rendered) ──
type SideStat = { samples: number; hitRate: number; meanBps: number };
type Drift = { baseBps: number; excessBps: number; excessStable: boolean; bySide: Record<"LONG" | "SHORT", { baseBps: number; excessBps: number; samples: number }> };
type Horizon = { h: number; samples: number; hitRate: number; meanBps: number; stable: boolean; verdict: string; drift?: Drift };
type ExitGrade = { preset: string; tpPercent: number; slPercent: number; maxHoldHours: number; samples: number; hitRate: number; netBps: number; stable: boolean; verdict: string; exits: Record<string, number>; avgHoldH: number; presetExit?: boolean; shadowOf?: string; bySide?: Record<"LONG" | "SHORT", SideStat>; oos?: { since: string; samples: number; hitRate: number; netBps: number }; exitContract?: string; avgSlPercent?: number; atrMult?: number; rMultiple?: number; funding?: FundingLine };
// The graded exit also net of the funding its trades paid while open (an estimate; the grade above doesn’t use it).
type FundingLine = { estimate: boolean; samples: number; missing: number; netBps: number; hitRate: number; costBps: number; oos: { samples: number; missing: number; netBps: number; hitRate: number; costBps: number } };
type AxisSides = Record<"LONG" | "SHORT", { events: number; r: { samples: number; hitRate: number; meanR: number } }>;
type RandomSide = { verdict: string; n: number; pctBeaten?: number; realMeanR?: number; randomMedianR?: number; moreTradesNeeded?: number | null };
type RandomBaseline = { metric: string; runs: number; window: { from: string; to: string; hours: number }; pooled: RandomSide; bySide: Record<"LONG" | "SHORT", RandomSide> };
export type Tide = { metric: string; from: string; to: string; markets: number; LONG: { n: number; meanR: number }; SHORT: { n: number; meanR: number } };
// A read registered in the read pipeline: the same grade on events after its registration only.
export type OosGrade = { since: string; verdict: string; r?: { samples: number; meanR: number } | null };
export type AxisRow = { name: string; label: string; verdict: string; r?: { samples: number; meanR: number; hitRate?: number } | null; best: (Horizon & { bySide?: Record<"LONG" | "SHORT", SideStat> }) | null; horizons?: Horizon[]; exit?: ExitGrade | null; exit24h?: ExitGrade | null; exitGraded?: ExitGrade | null; sides?: AxisSides; random?: RandomBaseline | null; oos?: OosGrade | null };
export type PipelineRead = { axis: string; side?: string; stage: string; registeredAt?: string; next?: string; numbers?: { events: number; meanR: number } };
export type Scorecard = { failed?: boolean; axes: AxisRow[]; tide?: Tide | null; pipeline?: { rules?: { minEvents?: number }; reads?: PipelineRead[] } | null; config?: { minSamples: number; coins: string[]; horizonsHours: number[] }; asOf?: string };
type Evidence = { ok: boolean; hold: number; markets: number; marketsGreen: number; trades: number; netUsd: number; caveat?: string; baseline?: { verdict: string; pctBeaten?: number; moreTradesNeeded?: number | null } };

const sign = (x: number, d?: number) => `${x >= 0 ? "+" : ""}${d != null ? x.toFixed(d) : x}`;
const moneyTone = (x: number) => (x >= 0 ? POS : NEG);
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");

// The board's verdict. The bone mark sits only on the reads that cleared the bar; the rest stay monochrome.
const PILL: Record<string, { label: string; color: string; bg: string; border: string; tip: string }> = {
  PREDICTIVE: { label: "PREDICTIVE", color: MARK, bg: "#1a1a1e", border: "transparent", tip: "Enough samples, positive and stable in both halves of the record. Graded in R: first touch of a 1.2×ATR stop vs a 1.5R target. A read, not yet a strategy." },
  PROMISING: { label: "PROMISING", color: BONE, bg: "transparent", border: C.borderStrong, tip: "Positive, but not stable across both halves of the record yet." },
  NOISE: { label: "NOISE", color: MUTED, bg: "transparent", border: C.border, tip: "Flat or negative. Kept on the board: we publish the misses." },
  INSUFFICIENT: { label: "ACCRUING", color: FAINT, bg: "transparent", border: C.border, tip: "Not enough history to rate yet." },
};
const HZ_WORD: Record<string, string> = { PREDICTIVE: "PREDICTIVE", PROMISING: "PROMISING", NOISE: "NOISE", INSUFFICIENT: "ACCRUING" };

const label: React.CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.14em", textTransform: "uppercase", color: MUTED };

function Pill({ verdict }: { verdict: string }) {
  const p = PILL[verdict] || PILL.INSUFFICIENT;
  return (
    <span title={p.tip} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: "0.12em", color: p.color, background: p.bg, border: `1px solid ${p.border}`, borderRadius: 5, padding: "4px 8px", whiteSpace: "nowrap", flexShrink: 0, cursor: "help" }}>
      <span style={{ width: 5, height: 5, borderRadius: 3, background: p.color }} />{p.label}
    </span>
  );
}

function Stat({ v, l, color, tip }: { v: string; l: string; color?: string; tip: string }) {
  return (
    <div title={tip} style={{ minWidth: 0, cursor: "help" }}>
      <div style={{ fontFamily: UI, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: color || BRIGHT, lineHeight: 1.1, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{v}</div>
      <div style={{ ...label, fontSize: 8.5, marginTop: 5, whiteSpace: "nowrap" }}>{l}</div>
    </div>
  );
}

// The preset's own signal replayed on every recorded market (each on its own), pooled, vs random.
function EvidenceLine({ axis }: { axis: string }) {
  const [ev, setEv] = useState<Evidence | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API}/intel/evidence?axis=${axis}`).then((r) => r.json()).then((d) => { if (live && d?.ok) setEv(d); }).catch(() => { /* fail-soft */ });
    return () => { live = false; };
  }, [axis]);
  if (!ev) return null;
  const bl = ev.baseline;
  return (
    <div title={`The preset's own signal and ${ev.hold}h exit, replayed on every market with recorded history, each on its own, trades pooled. ${ev.caveat || ""}`}
      style={{ marginTop: 10, fontFamily: MONO, fontSize: 10, color: FOG, lineHeight: 1.7, cursor: "help" }}>
      <span style={{ ...label, fontSize: 8.5 }}>Across {ev.markets} recorded markets</span>{" "}
      <span style={{ color: moneyTone(ev.netUsd) }}>{ev.netUsd >= 0 ? "+" : "-"}${Math.abs(ev.netUsd)}</span> · {ev.trades} trades · green on {ev.marketsGreen}/{ev.markets}
      {bl && bl.verdict === "TOO_FEW_TRADES" && <span style={{ color: FAINT }}> · too few trades to test vs random</span>}
      {bl && bl.verdict !== "TOO_FEW_TRADES" && <> · beat {bl.pctBeaten}% of random entries{bl.verdict !== "BEATS_RANDOM" && bl.moreTradesNeeded != null && <span style={{ color: FAINT }}> · ~{bl.moreTradesNeeded} more trades for a verdict</span>}</>}
      <span style={{ color: FAINT }}> · markets move together, so pooled isn’t independent</span>
    </div>
  );
}

function HorizonStrip({ hz, sel, onSelect, isMobile }: { hz: Horizon[]; sel: number; onSelect: (h: number) => void; isMobile: boolean }) {
  return (
    <div role="radiogroup" aria-label="Forward move by horizon"
      style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : `repeat(${hz.length}, minmax(0, 1fr))`, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", background: C.inset }}>
      {hz.map((h, i) => {
        const on = h.h === sel;
        const edge = { borderLeft: !isMobile && i ? `1px solid ${C.border}` : "none", borderTop: isMobile && i ? `1px solid ${C.border}` : "none" };
        const value = <span style={{ fontFamily: MONO, fontSize: isMobile ? 16 : 18, fontWeight: 600, color: moneyTone(h.meanBps), fontVariantNumeric: "tabular-nums" }}>{sign(h.meanBps)}<span style={{ fontSize: 9, color: MUTED, fontWeight: 500, marginLeft: 5, letterSpacing: "0.1em" }}>BPS</span></span>;
        const word = <span style={{ ...label, fontSize: 8.5, color: on ? FOG : MUTED }}>{HZ_WORD[h.verdict] || h.verdict}{h.stable ? " · stable" : ""}</span>;
        return (
          <button key={h.h} type="button" role="radio" aria-checked={on} onClick={() => onSelect(h.h)}
            title={`${h.h}h forward move after the read fired · ${h.hitRate}% hit · n${h.samples}${h.stable ? " · stable in both halves" : ""}`}
            style={{ ...edge, textAlign: "left", cursor: "pointer", background: on ? C.surface : "transparent", boxShadow: on ? `inset 0 2px 0 ${BONE}` : "none", color: BRIGHT, padding: isMobile ? "12px 14px" : "12px 14px 13px", display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: isMobile ? "center" : "stretch", justifyContent: "space-between", gap: isMobile ? 12 : 8, borderRight: "none", borderBottom: "none" }}>
            {isMobile ? (
              <>
                <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 700, color: on ? BRIGHT : FOG, width: 36 }}>{h.h}H</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 12 }}>{word}{value}</span>
              </>
            ) : (
              <>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: on ? BRIGHT : FOG }}>{h.h}H</span>{word}
                </span>
                {value}
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

function SideRow({ a, side }: { a: AxisRow; side: "LONG" | "SHORT" }) {
  const b = sideBar(a, side);
  const name = side === "LONG" ? "Longs" : "Shorts";
  return (
    <div style={{ display: "grid", gridTemplateColumns: "84px minmax(0, 1fr) auto", alignItems: "center", gap: 12, fontFamily: MONO, fontSize: 10.5 }}>
      <span style={{ color: BRIGHT, whiteSpace: "nowrap" }}>{name} <span style={{ color: MUTED }}>{b.events.toLocaleString()}</span></span>
      <span style={{ height: 4, borderRadius: 2, background: b.state === "tested" ? C.border : "transparent", border: b.state === "tested" ? "none" : `1px dashed ${C.border}`, position: "relative", overflow: "hidden" }}>
        {b.state === "tested" && <span style={{ position: "absolute", inset: 0, width: `${b.pct}%`, background: moneyTone(b.meanR ?? 0), borderRadius: 2 }} />}
      </span>
      <span style={{ color: FOG, whiteSpace: "nowrap", textAlign: "right" }}>
        {b.state === "tested" ? (
          <><span style={{ color: moneyTone(b.meanR ?? 0) }}>{sign(b.meanR ?? 0, 2)}R</span> · beat {b.pct}%</>
        ) : b.state === "thin" && b.meanR != null ? (
          <><span style={{ color: moneyTone(b.meanR) }}>{sign(b.meanR, 2)}R</span> · <span style={{ color: FAINT }}>{b.label}</span></>
        ) : <span style={{ color: FAINT }}>{b.label}</span>}
      </span>
    </div>
  );
}

// A registered read (docs/research/read-pipeline.md): the grade above is the recorded history,
// in-sample; only events after the registration count toward its stage.
function RegisteredLine({ o }: { o: OosGrade }) {
  const n = o.r?.samples ?? 0;
  return (
    <div title="Registered with its rule frozen. The grade above is the whole recorded history, which was there when it was registered. Only events after the registration date count toward a verdict."
      style={{ marginTop: 12, fontFamily: MONO, fontSize: 10.5, color: FOG, lineHeight: 1.6, cursor: "help" }}>
      <span style={{ ...label, color: BRIGHT }}>Registered</span>
      <span style={{ fontSize: 9.5, color: FAINT }}> · counts from {o.since.slice(5, 10)} · the grade above is in-sample</span>
      <div style={{ marginTop: 4 }}>
        {n ? <>Since then: n{n} · <span style={{ color: moneyTone(o.r?.meanR ?? 0) }}>{(o.r?.meanR ?? 0) > 0 ? "+" : ""}{o.r?.meanR}R</span> mean</> : <span style={{ color: FAINT }}>No events since registration yet</span>}
      </div>
    </div>
  );
}

// The scoreboard's own exit (the R contract) graded the way the agent trades it: fees in, a trade
// still open at 168h closed at the market. A paper wallet trades it; the line is its yardstick.
function GradedExitLine({ g }: { g: ExitGrade }) {
  const graded = g.verdict !== "INSUFFICIENT";
  return (
    <div title="Stop = 1.2× the coin’s 4-hour ATR at entry, target = 1.5× the stop, held up to 168h. One position per market, net of a taker fee each side, a trade still open at 168h closed at the market. Paper only. Informational: it doesn’t change the read’s grade."
      style={{ marginTop: 12, fontFamily: MONO, fontSize: 10.5, color: FOG, lineHeight: 1.6, cursor: "help" }}>
      <span style={{ ...label, color: BRIGHT }}>Graded exit, as traded</span>
      <span style={{ fontSize: 9.5, color: FAINT }}> · stop {g.atrMult ?? 1.2}× 4h ATR{g.avgSlPercent ? ` (avg ${g.avgSlPercent}%)` : ""} · target {g.rMultiple ?? 1.5}× · {g.maxHoldHours}h · paper only</span>
      <div style={{ marginTop: 4 }}>
        {graded
          ? <><span style={{ color: g.verdict === "PREDICTIVE" ? MARK : g.verdict === "PROMISING" ? BONE : MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>{HZ_WORD[g.verdict] || g.verdict}</span> · <span style={{ color: moneyTone(g.netBps) }}>{sign(g.netBps)} bps</span> net · {g.hitRate}% win · n{g.samples} · {g.exits.TIMEOUT || 0} timed out</>
          : <span style={{ color: FAINT }}>Accruing · n{g.samples}</span>}
        {g.oos && <span style={{ color: FAINT }}> · since {g.oos.since.slice(5, 10)}: {g.oos.samples ? <>n{g.oos.samples} <span style={{ color: moneyTone(g.oos.netBps) }}>{sign(g.oos.netBps)}</span></> : "none graded yet"}</span>}
      </div>
      {g.funding && <FundingNet f={g.funding} since={g.oos?.since} />}
      {/* The paper wallet closes trades days before this line counts them: a trade is graded only once
          its whole hold window (168h) has passed, so a quick win and a slow loser are judged alike. */}
      <div style={{ marginTop: 3, fontSize: 9.5, color: FAINT }}>
        A trade counts here {g.maxHoldHours % 24 === 0 ? `${g.maxHoldHours / 24} days` : `${g.maxHoldHours}h`} after its entry, once its full hold window has passed, even if it closed sooner.
      </div>
    </div>
  );
}

// Funding paid while a trade was open, taken off too. The bar is still "net of fees"; this shows how
// much funding would move that number. Positive costBps = the trades paid funding on average.
function FundingNet({ f, since }: { f: FundingLine; since?: string }) {
  const paidWord = (c: number) => (c > 0 ? `paid ${c} bps` : c < 0 ? `collected ${-c} bps` : "no funding");
  return (
    <div title="Funding is estimated from the hourly rates the engine records (Orderly’s 8-hour rate spread over the hours held). A trade with gaps in that record is left out, never counted as free. The grade above is net of fees only and doesn’t use this."
      style={{ marginTop: 4, cursor: "help" }}>
      <span style={{ color: BONE }}>Net of funding too (est.)</span>
      {f.samples
        ? <> · <span style={{ color: moneyTone(f.netBps) }}>{sign(f.netBps)} bps</span> · trades {paidWord(f.costBps)} each on average · n{f.samples}</>
        : <span style={{ color: FAINT }}> · no trade with a full funding record yet</span>}
      {f.missing > 0 && <span style={{ color: FAINT }}> · {f.missing} left out (gaps)</span>}
      {since && <span style={{ color: FAINT }}> · since {since.slice(5, 10)}: {f.oos.samples ? <>n{f.oos.samples} <span style={{ color: moneyTone(f.oos.netBps) }}>{sign(f.oos.netBps)}</span></> : "none yet"}</span>}
    </div>
  );
}

function ExitBand({ a, preset, paused, isMobile }: { a: AxisRow; preset?: ReturnType<typeof presetById>; paused?: string; isMobile: boolean }) {
  const navigate = useNavigate();
  const exits = [a.exit, a.exit24h].filter((g): g is ExitGrade => !!g && g.verdict !== "INSUFFICIENT");
  const load = () => preset && deployToAgent({ ...preset.config, mode: "PAPER" }, `the ${preset.name} preset (PAPER)`, undefined, navigate, { replaceFilters: true });
  const research = !preset && !paused && (a.verdict === "PREDICTIVE" || a.verdict === "PROMISING");
  if (!exits.length && !preset && !paused && !research && !a.oos && !a.exitGraded) return null;
  const head = exits[0];
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, background: C.surfaceAlt, padding: isMobile ? "16px 18px 18px" : "16px 24px 18px", display: "grid", gridTemplateColumns: isMobile || !preset ? "1fr" : "minmax(0, 1fr) auto", gap: 16, alignItems: "end" }}>
      <div style={{ minWidth: 0 }}>
        {head && (
          <>
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "4px 10px" }}>
              <span style={{ ...label, color: BRIGHT }}>{head.shadowOf ? "With the Basis × CVD Stack’s exits" : "As the agent trades it"}</span>
              <span style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>TP {head.tpPercent}% · SL {head.slPercent}%{head.shadowOf ? " · no preset trades this" : ""}</span>
            </div>
            <div title="One position per market, first touch of stop or target on the logged hourly candles (a bar touching both counts as the stop), else closed at the max hold. Net of a taker fee each side. Informational: it doesn't change the read's grade."
              style={{ marginTop: 10, display: "grid", gridTemplateColumns: "44px 96px minmax(0, 1fr)", rowGap: 8, columnGap: 8, fontFamily: MONO, fontSize: 10.5, color: FOG, cursor: "help" }}>
              {exits.map((x) => (
                <div key={x.maxHoldHours} style={{ display: "contents" }}>
                  <span style={{ color: BRIGHT }}>{x.maxHoldHours}h</span>
                  <span style={{ color: x.verdict === "PREDICTIVE" ? MARK : x.verdict === "PROMISING" ? BONE : MUTED, fontWeight: 700, letterSpacing: "0.06em" }}>{HZ_WORD[x.verdict] || x.verdict}</span>
                  <span style={{ lineHeight: 1.5 }}>
                    <span style={{ color: moneyTone(x.netBps) }}>{sign(x.netBps)} bps</span> net · {x.hitRate}% win · n{x.samples} · {x.exits.TIMEOUT || 0} timed out
                    {x.oos && <span style={{ color: FAINT }} title="Only trades entered after the 12h-vs-24h question was raised: the out-of-sample test."> · since {x.oos.since.slice(5, 10)}: {x.oos.samples ? <>n{x.oos.samples} <span style={{ color: moneyTone(x.oos.netBps) }}>{sign(x.oos.netBps)}</span></> : "no trades yet"}</span>}
                  </span>
                </div>
              ))}
            </div>
            {!paused && !head.shadowOf && <EvidenceLine axis={a.name} />}
          </>
        )}
        {/* Outside the exit block: a registered read with no preset exit still says its grade is in-sample. */}
        {a.oos && <RegisteredLine o={a.oos} />}
        {a.exitGraded && <GradedExitLine g={a.exitGraded} />}
        {!preset && (paused || research) && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: FAINT, marginTop: 12 }}>{paused || "Research read · not an agent mode yet"}</div>
        )}
      </div>
      {preset && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: isMobile ? "flex-start" : "flex-end", gap: 6 }}>
          <button type="button" onClick={load} className="nx-press"
            style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12.5, fontWeight: 600, color: C.inset, background: BONE, border: "none", borderRadius: 8, padding: "10px 16px", cursor: "pointer", whiteSpace: "nowrap" }}>
            Load in agent →
          </button>
          <span style={{ fontFamily: MONO, fontSize: 9, color: FAINT }}>Paper · the rule this board grades · review, then save</span>
        </div>
      )}
    </div>
  );
}

// The full evidence card for one read. On the board it opens under its row (`expanded`), so
// every detail line (horizons, sides vs random, exits, registration, graded exit) is one tap away.
function SignalCard({ a }: { a: AxisRow }) {
  const isMobile = useIsMobile();
  const hz = (a.horizons || []).filter((h) => h.verdict !== "INSUFFICIENT");
  const [sel, setSel] = useState<number>(a.best?.h ?? hz[0]?.h ?? 0);
  const cur = hz.find((h) => h.h === sel) || a.best;
  const blurb = AXIS_BLURB[a.name as keyof typeof AXIS_BLURB];
  const tk = takeaway(a);
  const paused = AXIS_PAUSED[a.name];
  const preset = AXIS_PRESET[a.name] && !paused ? presetById(AXIS_PRESET[a.name]) : undefined;
  const pad = isMobile ? 18 : 24;
  const rated = !!cur && a.verdict !== "INSUFFICIENT";

  const stats = rated && cur ? (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2, minmax(0, 1fr))" : "repeat(4, auto)", columnGap: isMobile ? 16 : 28, rowGap: 16, justifyContent: isMobile ? "stretch" : "end", textAlign: isMobile ? "left" : "right" }}>
      <Stat v={`${cur.h}h`} l="horizon" tip="How far ahead the move is measured." />
      <Stat v={`${cur.hitRate}%`} l="hit rate" tip="Share of times price moved the predicted way." />
      <Stat v={sign(cur.meanBps)} l="avg edge · bps" color={moneyTone(cur.meanBps)} tip="Average forward move caught, in basis points (100 bps = 1%). Gross, close to close." />
      <Stat v={cur.samples.toLocaleString()} l="samples" tip="Times this read fired at this horizon. More samples, more weight." />
    </div>
  ) : null;

  return (
    <article style={{ background: C.surface, border: `1px solid ${C.border}`, borderRadius: 14, overflow: "hidden", opacity: a.verdict === "NOISE" || a.verdict === "INSUFFICIENT" ? 0.92 : 1 }}>
      <div style={{ padding: `${pad}px ${pad}px 20px` }}>
        {/* what it is · what the evidence says · the numbers */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto", gap: isMobile ? 16 : 24, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            {blurb && <p style={{ margin: 0, fontFamily: UI, fontSize: 13.5, color: FOG, lineHeight: 1.5 }}>{blurb}</p>}
            <p style={{ margin: "8px 0 0", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: tk.tone === "pos" ? BRIGHT : FOG }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, marginRight: 8, verticalAlign: 1, background: tk.tone === "pos" ? BONE : tk.tone === "neg" ? MUTED : FAINT }} />{tk.text}
            </p>
          </div>
          {isMobile && stats && <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>{stats}</div>}
          {!isMobile && (stats || <span style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>accruing · not yet rated</span>)}
        </div>

        {/* the proof underneath */}
        {rated && hz.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ ...label, fontSize: 8.5, marginBottom: 8 }}>Forward move by horizon · tap to inspect</div>
            <HorizonStrip hz={hz} sel={sel} onSelect={setSel} isMobile={isMobile} />
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) minmax(0, 1.4fr)", gap: isMobile ? 18 : 32, marginTop: 20 }}>
              {cur && "drift" in cur && cur.drift ? (
                <div title="The read's move minus what the same side made on an average hour for the same coins. A read that only buys in a rising window scores well raw and near zero here.">
                  <div style={{ ...label, fontSize: 8.5 }}>Above drift · {cur.h}h</div>
                  <div style={{ marginTop: 8, fontFamily: MONO, fontSize: 10.5, color: FOG }}>
                    <span style={{ fontSize: 17, fontWeight: 600, color: moneyTone(cur.drift.excessBps), marginRight: 8 }}>{sign(cur.drift.excessBps)} bps</span>
                    {cur.drift.excessBps >= 0 ? "after the market’s own drift" : "below the market’s own drift"}
                  </div>
                </div>
              ) : <div />}
              {a.sides && (a.sides.LONG.events + a.sides.SHORT.events) > 0 && (
                <div title="Each side graded on its own, in R. 'beat X%' = share of 300 random-hour replays (same market, same side, same window, same contract) the read out-earned. 95%+ beats random; 5% or under is reliably worse.">
                  <div style={{ ...label, fontSize: 8.5, marginBottom: 10 }}>Each side vs random entries · all horizons</div>
                  <div style={{ display: "grid", rowGap: 10 }}>
                    <SideRow a={a} side="LONG" />
                    <SideRow a={a} side="SHORT" />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
      <ExitBand a={a} preset={preset} paused={paused} isMobile={isMobile} />
    </article>
  );
}

// ── One read, one row: what it is · its grade · how it fares vs random. Tap for the evidence. ──
type Reg = { stage: string; registeredAt?: string; next?: string; numbers?: { events: number; meanR: number } } | null;

function RandomBar({ a }: { a: AxisRow }) {
  const b = randomBar(a);
  const tip = "Share of 300 random-hour replays (same markets, same sides, same window, same R contract) the read out-earned. 95%+ beats random; 5% or under is reliably worse.";
  if (b.state !== "tested") return <span title={tip} style={{ fontFamily: MONO, fontSize: 10, color: FAINT, cursor: "help" }}>{b.label}</span>;
  const fill = b.verdict === "BELOW_RANDOM" ? NEG : b.verdict === "BEATS_RANDOM" ? BONE : FOG;
  return (
    <span title={tip} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "help", minWidth: 0 }}>
      <span style={{ position: "relative", flex: 1, minWidth: 48, height: 6, borderRadius: 3, background: C.border }}>
        <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${b.pct}%`, borderRadius: 3, background: fill }} />
        {/* the two bars a read is judged against: 5% (reliably worse) and 95% (beats random) */}
        <span style={{ position: "absolute", left: "5%", top: -2, bottom: -2, width: 1, background: MUTED }} />
        <span style={{ position: "absolute", left: "95%", top: -2, bottom: -2, width: 1, background: MUTED }} />
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: b.verdict === "BELOW_RANDOM" ? NEG : FOG, width: 38, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{Math.round(b.pct ?? 0)}%</span>
    </span>
  );
}

function StageRow({ a, reg, minEvents }: { a: AxisRow; reg: Reg; minEvents: number }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { main, aside } = splitLabel(a.label);
  const r = a.r && a.r.samples ? a.r : null;
  const n = reg?.numbers;
  const sub = reg ? (
    <div style={{ marginTop: 4, fontFamily: MONO, fontSize: 9.5, color: MUTED, lineHeight: 1.5 }}>
      <span style={{ color: FOG }}>{reg.stage === "REGISTERED" ? "Registered" : reg.stage}</span>
      {reg.registeredAt && <> · counts from {day(reg.registeredAt)}</>}
      {" · "}{n?.events ?? 0}/{minEvents} out-of-sample
      {n?.events ? <> · <span style={{ color: moneyTone(n.meanR) }}>{sign(n.meanR, 2)}R</span></> : null}
    </div>
  ) : null;
  const toggle = () => setOpen((v) => !v);
  const cells = (
    <>
      <span style={{ fontFamily: MONO, fontSize: 12, color: r ? moneyTone(r.meanR) : FAINT, textAlign: isMobile ? "left" : "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }} title="Mean R per event: first touch of a 1.2×ATR stop vs a 1.5R target, on the recorded history.">
        {r ? `${sign(r.meanR, 2)}R` : "—"}
      </span>
      <span style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, textAlign: isMobile ? "left" : "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }} title="Graded events">
        {r ? `n${r.samples.toLocaleString()}` : ""}
      </span>
      <RandomBar a={a} />
    </>
  );
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <button type="button" onClick={toggle} aria-expanded={open}
        style={{ width: "100%", background: open ? C.surface : "transparent", border: "none", cursor: "pointer", textAlign: "left", color: BRIGHT, padding: isMobile ? "12px 4px" : "12px 10px",
          display: "grid", alignItems: "center", columnGap: 14, rowGap: 8,
          gridTemplateColumns: isMobile ? "58px 56px minmax(0, 1fr)" : "minmax(0, 1fr) 104px 64px 64px 170px 14px" }}>
        <span style={{ minWidth: 0, gridColumn: isMobile ? "1 / -1" : undefined, display: isMobile ? "flex" : "block", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
          <span style={{ minWidth: 0 }}>
            <span style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, letterSpacing: "-0.01em", color: BRIGHT }}>{main}</span>
            {aside && <span style={{ fontFamily: UI, fontSize: 13, color: MUTED }}> {aside}</span>}
            {sub}
          </span>
          {isMobile && <Pill verdict={a.verdict} />}
        </span>
        {!isMobile && <span><Pill verdict={a.verdict} /></span>}
        {cells}
        {!isMobile && <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>{open ? "−" : "+"}</span>}
      </button>
      {open && (
        <div style={{ padding: isMobile ? "4px 0 14px" : "4px 0 16px" }}>
          <SignalCard a={a} />
        </div>
      )}
    </div>
  );
}

// The two groups that sit folded under the tested reads. One plain line each, visible while folded.
const FOLDS: Record<string, { title: string; note: string }> = {
  history: { title: "Looked good on old data", note: "Graded on history we already had. Counts for nothing until it repeats on new data." },
  below: { title: "Worse than random", note: "Lost to random entries on the same markets. Kept here: we publish the misses." },
};

// One registered read on the "Being tested now" list: its name and how far along it is, nothing
// else. Its grade on old data stays behind the tap (the full card, labelled as such).
function TestRow({ a, reg, minEvents, since }: { a: AxisRow; reg: Reg; minEvents: number; since: string }) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const { main, aside } = splitLabel(a.label);
  const line = pipelineLine(reg, minEvents);
  return (
    <div style={{ borderTop: `1px solid ${C.border}` }}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        style={{ width: "100%", background: open ? C.surface : "transparent", border: "none", cursor: "pointer", textAlign: "left", color: BRIGHT,
          padding: isMobile ? "13px 4px" : "13px 10px", minHeight: 44, display: "flex", alignItems: "flex-start", gap: 12, flexWrap: isMobile ? "wrap" : "nowrap" }}>
        <span style={{ minWidth: 0, flex: "1 1 220px" }}>
          <span style={{ fontFamily: UI, fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", color: BRIGHT }}>{main}</span>
          {aside && <span style={{ fontFamily: UI, fontSize: 13.5, color: MUTED }}> {aside}</span>}
          {line.sub && <span style={{ display: "block", marginTop: 3, fontFamily: UI, fontSize: 12.5, color: MUTED }}>{line.sub}</span>}
        </span>
        <span style={{ display: "flex", alignItems: "baseline", gap: 12, flexShrink: 0, marginLeft: isMobile ? 0 : "auto" }}>
          <span style={{ fontFamily: MONO, fontSize: 12, color: line.state === "counting" ? FOG : BRIGHT, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{line.text}</span>
          <span aria-hidden style={{ fontFamily: MONO, fontSize: 12, color: MUTED }}>{open ? "−" : "+"}</span>
        </span>
      </button>
      {open && (
        <div style={{ padding: isMobile ? "4px 0 14px" : "4px 0 16px" }}>
          <div style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.5, margin: "0 4px 10px" }}>
            Its grade on all recorded history, mostly data that existed before the test began. Only events since {since || "registration"} count toward passing.
          </div>
          <SignalCard a={a} />
        </div>
      )}
    </div>
  );
}

// The detailed rows inside a fold, with their column header on desktop.
function DetailRows({ rows, minEvents }: { rows: { a: AxisRow; reg: Reg }[]; minEvents: number }) {
  const isMobile = useIsMobile();
  return (
    <>
      {!isMobile && (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) 104px 64px 64px 170px 14px", columnGap: 14, padding: "4px 10px 6px", ...label, fontSize: 8.5 }}>
          <span>Read</span><span>Grade · old data</span><span style={{ textAlign: "right" }}>Mean R</span><span style={{ textAlign: "right" }}>Events</span><span>Beats random · 5% / 95%</span><span />
        </div>
      )}
      <div style={{ borderBottom: `1px solid ${C.border}` }}>
        {rows.map(({ a, reg }) => <StageRow key={a.name} a={a} reg={reg} minEvents={minEvents} />)}
      </div>
    </>
  );
}

export default function SignalBoard({ scorecard }: { scorecard: Scorecard | null }) {
  const isMobile = useIsMobile();
  const reads = scorecard?.pipeline?.reads;
  const groups = stageGroups(scorecard?.axes, reads);
  const minEvents = scorecard?.pipeline?.rules?.minEvents ?? 30;
  const since = countingSince(reads);
  const testing = groups.find((g) => g.key === "pipeline");

  const status = (t: string, color: string = FAINT) => <div style={{ fontFamily: UI, fontSize: 13, color, padding: "18px 4px" }}>{t}</div>;

  return (
    <section style={{ marginTop: 40 }}>
      <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 22 : 26, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.15, color: BRIGHT }}>Being tested now</h2>
      <p style={{ margin: "6px 0 10px", fontFamily: UI, fontSize: 13, lineHeight: 1.5, color: MUTED }}>
        {since ? `Counting since ${since}. ` : ""}Tap a signal for its grade on old data.
      </p>

      {scorecard === null ? status("Loading…") : scorecard.failed ? (
        // A failed read is never shown as an empty board.
        status("Couldn’t load the signals. Refresh to try again.", FOG)
      ) : (
        <>
          {testing
            ? <div style={{ borderBottom: `1px solid ${C.border}` }}>{testing.rows.map(({ a, reg }) => <TestRow key={a.name} a={a} reg={reg} minEvents={minEvents} since={since} />)}</div>
            : status("Nothing is being tested right now.")}
          <div style={{ marginTop: 18 }}>
            {groups.filter((g) => g.key !== "pipeline").map((g) => (
              <Fold key={g.key} title={FOLDS[g.key].title} count={g.rows.length} note={FOLDS[g.key].note}>
                <DetailRows rows={g.rows} minEvents={minEvents} />
              </Fold>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
