// ── The signal scoreboard, as an evidence board ───────────────────────────────────────
// Our own reads, graded the way we grade traders (/intel/axis-backtest). Display only: every
// number is served by the grader; the one-line verdicts come from app/lib/signalCard.mjs.
// Hierarchy per card: what the read is → what the evidence says → the numbers → the proof
// underneath → how the agent would trade it (only where a preset trades the exact rule).
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { AXIS_PRESET, AXIS_PAUSED, presetById } from "@/config/strategyPresets";
import { deployToAgent } from "@/utils/agentPrefill";
import { C } from "@/config/theme";
import { AXIS_BLURB, splitLabel, rankAxes, takeaway, sideBar, isCompact } from "@/lib/signalCard.mjs";

const API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { pos: POS, neg: NEG, brand: MARK } = C;
const { bright: BRIGHT, fog: FOG, muted: MUTED, faint: FAINT } = C.text;
const BONE = C.accent;
const VIEW_KEY = "nx_proof_board_view";

// ── data (only the fields rendered) ──
type SideStat = { samples: number; hitRate: number; meanBps: number };
type Drift = { baseBps: number; excessBps: number; excessStable: boolean; bySide: Record<"LONG" | "SHORT", { baseBps: number; excessBps: number; samples: number }> };
type Horizon = { h: number; samples: number; hitRate: number; meanBps: number; stable: boolean; verdict: string; drift?: Drift };
type ExitGrade = { preset: string; tpPercent: number; slPercent: number; maxHoldHours: number; samples: number; hitRate: number; netBps: number; stable: boolean; verdict: string; exits: Record<string, number>; avgHoldH: number; presetExit?: boolean; shadowOf?: string; bySide?: Record<"LONG" | "SHORT", SideStat>; oos?: { since: string; samples: number; hitRate: number; netBps: number } };
type AxisSides = Record<"LONG" | "SHORT", { events: number; r: { samples: number; hitRate: number; meanR: number } }>;
type RandomSide = { verdict: string; n: number; pctBeaten?: number; realMeanR?: number; randomMedianR?: number; moreTradesNeeded?: number | null };
type RandomBaseline = { metric: string; runs: number; window: { from: string; to: string; hours: number }; pooled: RandomSide; bySide: Record<"LONG" | "SHORT", RandomSide> };
type Tide = { metric: string; from: string; to: string; markets: number; LONG: { n: number; meanR: number }; SHORT: { n: number; meanR: number } };
export type AxisRow = { name: string; label: string; verdict: string; best: (Horizon & { bySide?: Record<"LONG" | "SHORT", SideStat> }) | null; horizons?: Horizon[]; exit?: ExitGrade | null; exit24h?: ExitGrade | null; sides?: AxisSides; random?: RandomBaseline | null };
export type Scorecard = { failed?: boolean; axes: AxisRow[]; tide?: Tide | null; config?: { minSamples: number; coins: string[]; horizonsHours: number[] }; asOf?: string };
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
            style={{ ...edge, textAlign: "left", cursor: "pointer", background: on ? C.surface : "transparent", boxShadow: on ? `inset 0 2px 0 ${BONE}` : "none", color: BRIGHT, padding: isMobile ? "12px 14px" : "12px 14px 13px", display: "flex", flexDirection: isMobile ? "row" : "column", alignItems: isMobile ? "center" : "stretch", justifyContent: "space-between", gap: isMobile ? 12 : 8, fontFamily: MONO, borderRight: "none", borderBottom: "none" }}>
            {isMobile ? (
              <>
                <span style={{ fontSize: 11, fontWeight: 700, color: on ? BRIGHT : FOG, width: 36 }}>{h.h}H</span>
                <span style={{ marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 12 }}>{word}{value}</span>
              </>
            ) : (
              <>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? BRIGHT : FOG }}>{h.h}H</span>{word}
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

function ExitBand({ a, preset, paused, isMobile }: { a: AxisRow; preset?: ReturnType<typeof presetById>; paused?: string; isMobile: boolean }) {
  const navigate = useNavigate();
  const exits = [a.exit, a.exit24h].filter((g): g is ExitGrade => !!g && g.verdict !== "INSUFFICIENT");
  const load = () => preset && deployToAgent({ ...preset.config, mode: "PAPER" }, `the ${preset.name} preset (PAPER)`, undefined, navigate, { replaceFilters: true });
  const research = !preset && !paused && (a.verdict === "PREDICTIVE" || a.verdict === "PROMISING");
  if (!exits.length && !preset && !paused && !research) return null;
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
        {!preset && (paused || research) && (
          <div style={{ fontFamily: MONO, fontSize: 10, color: FAINT, marginTop: head ? 12 : 0 }}>{paused || "Research read · not an agent mode yet"}</div>
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

function SignalCard({ a, summary }: { a: AxisRow; summary: boolean }) {
  const isMobile = useIsMobile();
  const compactByDefault = summary || isCompact(a);
  const [open, setOpen] = useState(false);
  const full = !compactByDefault || open;
  const hz = (a.horizons || []).filter((h) => h.verdict !== "INSUFFICIENT");
  const [sel, setSel] = useState<number>(a.best?.h ?? hz[0]?.h ?? 0);
  const cur = hz.find((h) => h.h === sel) || a.best;
  const { main, aside } = splitLabel(a.label);
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
      <div style={{ padding: `${pad}px ${pad}px ${full ? 20 : pad}px` }}>
        {/* what it is · what the evidence says · the numbers */}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto", gap: isMobile ? 16 : 24, alignItems: "start" }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: isMobile ? "space-between" : "flex-start", gap: 12 }}>
              <h3 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 18 : 17, fontWeight: 600, letterSpacing: "-0.015em", color: BRIGHT, lineHeight: 1.3, minWidth: 0 }}>
                {main}{aside && <span style={{ color: FOG, fontWeight: 400 }}> {aside}</span>}
              </h3>
              <Pill verdict={a.verdict} />
            </div>
            {blurb && <p style={{ margin: "8px 0 0", fontFamily: UI, fontSize: 13.5, color: FOG, lineHeight: 1.5 }}>{blurb}</p>}
            <p style={{ margin: "8px 0 0", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.6, color: tk.tone === "pos" ? BRIGHT : FOG }}>
              <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, marginRight: 8, verticalAlign: 1, background: tk.tone === "pos" ? BONE : tk.tone === "neg" ? MUTED : FAINT }} />{tk.text}
            </p>
          </div>
          {isMobile && stats && <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16 }}>{stats}</div>}
          {!isMobile && (stats || <span style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>accruing · not yet rated</span>)}
        </div>

        {/* the proof underneath */}
        {full && rated && hz.length > 0 && (
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

        {compactByDefault && rated && (
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
            style={{ marginTop: 14, background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "var(--nx-font-ui)", fontSize: 12, color: MUTED }}>
            {open ? "Hide the evidence ↑" : "Show the evidence ↓"}
          </button>
        )}
      </div>
      {full && <ExitBand a={a} preset={preset} paused={paused} isMobile={isMobile} />}
    </article>
  );
}

export default function SignalBoard({ scorecard }: { scorecard: Scorecard | null }) {
  const isMobile = useIsMobile();
  const [view, setView] = useState<"summary" | "expanded">(() => {
    try { return localStorage.getItem(VIEW_KEY) === "summary" ? "summary" : "expanded"; } catch { return "expanded"; }
  });
  const pick = (v: "summary" | "expanded") => { setView(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* private window */ } };
  const tide = scorecard?.tide;
  const axes = rankAxes(scorecard?.axes);
  const counts = axes.reduce<Record<string, number>>((m, a) => { m[a.verdict] = (m[a.verdict] || 0) + 1; return m; }, {});

  return (
    <section style={{ marginTop: 36 }}>
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0, 1fr) auto", gap: 16, alignItems: "end" }}>
        <div>
          <div style={{ ...label, color: MARK, marginBottom: 12 }}>Signal scoreboard</div>
          <h2 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 32 : 44, fontWeight: 600, letterSpacing: "-0.035em", lineHeight: 1.02, color: BRIGHT }}>Signals, ranked by evidence.</h2>
          <p style={{ margin: "14px 0 0", fontFamily: UI, fontSize: 14.5, lineHeight: 1.6, color: FOG, maxWidth: 580 }}>
            Every read in the engine, graded the way we grade traders. Forward returns, no lookahead, walk-forward. The call first, the proof underneath. The misses stay on the board.
          </p>
        </div>
        {tide && (
          <div style={{ fontFamily: MONO, fontSize: 10, lineHeight: 1.8, color: MUTED, textAlign: isMobile ? "left" : "right" }}>
            <div style={{ color: FOG }}>{tide.markets} markets</div>
            <div>{day(tide.from)} – {day(tide.to)}</div>
            <div>hourly observations{scorecard?.asOf ? ` · updated ${day(scorecard.asOf)}` : ""}</div>
          </div>
        )}
      </div>

      {tide && (
        <div title="Every recorded market-hour, entered at random, under the same frozen R contract the cards use. Not a sample: the whole population."
          style={{ marginTop: 22, display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "6px 14px", padding: "12px 16px", border: `1px solid ${C.border}`, borderRadius: 10, background: C.surfaceAlt, fontFamily: MONO, fontSize: 11, color: FOG, cursor: "help" }}>
          <span style={{ ...label, color: MARK }}>The tide</span>
          <span>A random long earned <span style={{ color: moneyTone(tide.LONG.meanR) }}>{sign(tide.LONG.meanR)}R</span>; a random short <span style={{ color: moneyTone(tide.SHORT.meanR) }}>{sign(tide.SHORT.meanR)}R</span>.</span>
          <span style={{ marginLeft: isMobile ? 0 : "auto", color: FAINT, fontSize: 10 }}>A read has to beat its side’s tide, not zero.</span>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, margin: "30px 0 14px", flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontFamily: UI, fontSize: 18, fontWeight: 600, letterSpacing: "-0.015em", color: BRIGHT }}>Evidence board</h3>
          {axes.length > 0 && (
            <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>
              {[["PREDICTIVE", "predictive"], ["PROMISING", "promising"], ["NOISE", "noise"], ["INSUFFICIENT", "accruing"]].filter(([k]) => counts[k]).map(([k, w]) => `${counts[k]} ${w}`).join(" · ")}
            </span>
          )}
        </div>
        <div role="radiogroup" aria-label="Board density" style={{ display: "inline-flex", padding: 3, border: `1px solid ${C.border}`, borderRadius: 9, background: C.surfaceAlt }}>
          {(["summary", "expanded"] as const).map((v) => (
            <button key={v} type="button" role="radio" aria-checked={view === v} onClick={() => pick(v)}
              style={{ fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", background: view === v ? BONE : "transparent", color: view === v ? C.inset : FOG, fontWeight: view === v ? 700 : 500 }}>
              {v === "summary" ? "Summary" : "Expanded"}
            </button>
          ))}
        </div>
      </div>

      {scorecard === null ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: FAINT, padding: "24px 0" }}>Loading the board…</div>
      ) : scorecard.failed ? (
        // A failed read is never shown as an empty board.
        <div style={{ fontFamily: MONO, fontSize: 11, color: FOG, padding: "24px 0" }}>Couldn’t load the board. Refresh to try again.</div>
      ) : !axes.length ? (
        <div style={{ fontFamily: MONO, fontSize: 11, color: FAINT, padding: "24px 0" }}>The scorecard is warming up.</div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {axes.map((a) => <SignalCard key={`${a.name}:${view}`} a={a} summary={view === "summary"} />)}
        </div>
      )}

      <p style={{ margin: "16px 0 0", fontFamily: MONO, fontSize: 9.5, color: FAINT, lineHeight: 1.6 }}>
        {scorecard?.config?.coins?.length ? `Pooled across ${scorecard.config.coins.length} markets · min ${scorecard.config.minSamples} observations to rate · ` : ""}
        verdicts are graded in R; the horizon strip shows the raw forward move.
      </p>
    </section>
  );
}
