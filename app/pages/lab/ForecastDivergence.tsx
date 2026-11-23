import { useEffect, useState, type CSSProperties } from "react";
import { CoinLink } from "@/components/CoinLink";
import { useNavigate } from "react-router-dom";
import { C, SIGNAL } from "@/config/theme";
import { handOffCall } from "@/lib/callHandoff";
import { ProjectionBand } from "@/components/ProjectionBand";
import { SectionHeader } from "./components";
import { useIsMobile } from "./useIsMobile";
import { forecastRead, forecastChip } from "@/lib/forecastRead.mjs";

// ── Forecast Divergence card (the prediction-market lens) ────────────────────
// Reads the FORECASTING crowd (Polymarket) and puts each price-target market next to the coin's OWN history: how
// often the coin itself made that move in the time left, over its last year (app/lib/forecastOdds.mjs, served by
// /intel/forecasts as `history` + `crowdGapPts`, 2026-11-23). The crowd leans only past a 10-point gap; a divergence
// = that lean against funding's. It used to fold "12% that BTC climbs 14% this week" into "the crowd leans DOWN",
// which was distance, not a view. We never claim a fair probability; the trader picks any side (handOffCall).

const AGENT_API = "https://og.nexustradinglabs.com";
// Palette repointed to the canonical design tokens (app/config/theme.ts) — collapses
// the local-hex drift so this corner matches the Mispriced Board + the rest of the Lab.
const BONE = C.text.bright, DIM = C.text.muted, FAINT = C.text.faint;
// Amber = caution (SIGNAL.watch), the only flag colour here. Leans are directions, not money: ink, never green/red.
const WATCH = SIGNAL.watch;
const SURFACE = C.surface, BORDER = C.border, BORDER_STRONG = C.borderStrong, FOG = C.text.fog;

interface ForecastMarket {
  id: string | null;
  coin: string;
  symbol: string | null;
  question: string;
  slug: string | null;
  forecastProbPct: number;
  clobTokenId: string | null;
  volumeUsd: number;
  liquidityUsd: number;
  endDate: string | null;
  markPrice: number | null;
  target: number | null;
  targetDirection: "UP" | "DOWN" | null;
  distancePct: number | null;
  forecastLean: "UP" | "DOWN" | null;
  nearMoney: boolean | null;
  fundingLean: "UP" | "DOWN" | null;
  alignment: "ALIGNED" | "DIVERGENT" | null;
  divergence: boolean;
  history: { pct: number; days: number; kind: "touch" | "close"; lookbackDays: number; windows: number } | null;
  crowdGapPts: number | null;
}

function fmtUsd(n: number): string {
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}k`;
  return `$${Math.round(n)}`;
}
function fmtPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(n < 10 ? 3 : 2)}`;
}
function fmtEnds(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// A lean is a direction, not money: ink only (brand rule; it used to be green/red).
const leanColor = (l: string | null) => (l ? FOG : DIM);
const leanWord = (l: string | null) => (l === "UP" ? "up" : l === "DOWN" ? "down" : "none");

// The floor on how much of the plot the PRICE series is guaranteed. A forecast target joins
// the y-domain only while the tape still owns at least this share of the height; past that it
// is pinned to the edge and labelled "off scale", so a distant strike can never squash the one
// mark the chart exists to show.
const TAPE_MIN_SHARE = 0.55;

// Client-side Orderly candle fetch (same public endpoint the Mispriced Board uses).
// Fail-soft: null until loaded, [] on error — the chart simply doesn't render.
function useOrderlyPrice(coin: string, days: number): { t: number; c: number }[] | null {
  const [price, setPrice] = useState<{ t: number; c: number }[] | null>(null);
  useEffect(() => {
    let live = true; setPrice(null);
    const to = Math.floor(Date.now() / 1000), from = to - days * 86400;
    fetch(`https://api-evm.orderly.org/tv/history?symbol=PERP_${coin}_USDC&resolution=60&from=${from}&to=${to}`)
      .then((r) => r.json())
      .then((d) => {
        if (!live) return;
        if (d && d.s === "ok" && Array.isArray(d.t) && Array.isArray(d.c))
          setPrice(d.t.map((t: number, i: number) => ({ t: t * 1000, c: Number(d.c[i]) })).filter((p: { c: number }) => p.c > 0));
        else setPrice([]);
      })
      .catch(() => { if (live) setPrice([]); });
    return () => { live = false; };
  }, [coin, days]);
  return price;
}

// ── THE FORECAST CHART — price is the hero, the target is a reference line ──────
// The y-domain is fit to PRICE ONLY. It used to include the target, so a far strike
// (BTC $90k with the tape at $110k) crushed three weeks of price into a sliver and the
// price→target wash became a solid wall. Now: price fills the plot; the target is a 1px
// dashed line + small label when it sits inside the range, or pinned to the top/bottom
// edge with an arrow + distance when it's off-chart. The wash is a faint (≤10%) band
// from last price toward the target, clipped to the plot — never a wall. Plot sits on
// the Lab canvas. Honest: one target + one probability, no fake quartiles.
function ForecastChart({ coin, markPrice, target, forecastLean }: {
  coin: string; markPrice: number | null; target: number | null; forecastLean: string | null;
}) {
  const price = useOrderlyPrice(coin, 21);
  const pc = (price || []).filter((p) => Number.isFinite(p.c) && p.c > 0);
  if (pc.length < 2) return null;

  const VB_W = 440, padL = 3, gutterR = 62, plotW = VB_W - padL - gutterR;
  const top = 13, H = 150, plotBot = H - 18;
  const cs = pc.map((p) => p.c);
  const tgt = target != null && Number.isFinite(target) ? target : null;
  const mk = markPrice != null && Number.isFinite(markPrice) ? markPrice : cs[cs.length - 1];
  const vals = [...cs, mk];
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || hi * 0.01 || 1, pad = sp * 0.1;
  const pLo = lo - pad, pHi = hi + pad, pSpan = (pHi - pLo) || 1;
  // Fitting the domain to price ONLY is right for a far strike, but it also pinned NEAR-money
  // ones: a target 3% above the 21d high fell outside a range that only spans 8%, so the
  // commonest case on this card — a strike just out of reach — read "off scale". So widen the
  // domain to take the target in, but only while the tape still owns TAPE_MIN_SHARE of the
  // height. Near strike ⇒ drawn at its true level; far strike ⇒ still pinned, price intact.
  const wLo = tgt != null ? Math.min(pLo, tgt) : pLo;
  const wHi = tgt != null ? Math.max(pHi, tgt) : pHi;
  const room = (wHi - wLo) * 0.04;                       // breathing room the target rule needs
  const fits = tgt != null && wHi > wLo && pSpan / ((wHi - wLo) * 1.08) >= TAPE_MIN_SHARE;
  const yLo = fits ? wLo - room : pLo, yHi = fits ? wHi + room : pHi;
  const py = (c: number) => plotBot - ((c - yLo) / (yHi - yLo)) * (plotBot - top);
  const t0 = pc[0].t, t1 = pc[pc.length - 1].t, tspan = (t1 - t0) || 1;
  const X = (t: number) => padL + ((t - t0) / tspan) * plotW;
  const line = pc.map((p) => `${X(p.t).toFixed(1)},${py(p.c).toFixed(1)}`).join(" ");
  const lastPx = cs[cs.length - 1];
  const lastY = py(lastPx);
  // Target placement: inside the price range → its true level; outside → pinned to the edge.
  const tgtOff = tgt == null ? null : tgt > yHi ? "above" : tgt < yLo ? "below" : null;
  const tgtY = tgt == null ? null : tgtOff === "above" ? top : tgtOff === "below" ? plotBot : py(tgt);
  const tgtDist = tgt != null && lastPx ? ((tgt - lastPx) / lastPx) * 100 : null;
  void forecastLean;
  const ticks = [0, 1, 2].map((i) => {
    const tt = t0 + (tspan * i) / 2;
    const anchor: "start" | "middle" | "end" = i === 0 ? "start" : i === 2 ? "end" : "middle";
    return { x: X(tt), label: new Date(tt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), anchor };
  });
  const MF = "var(--nx-font-mono)";
  // Label sits on the inside of the plot so an edge-pinned target never clips.
  const tgtLabelY = tgtY == null ? 0 : tgtOff === "below" ? tgtY - 3.5 : tgtOff === "above" ? tgtY + 9 : (tgtY - 3.5 < top + 6 ? tgtY + 9 : tgtY - 3.5);
  return (
    <svg viewBox={`0 0 ${VB_W} ${H}`} style={{ display: "block", width: "100%", height: "auto", margin: "2px 0 8px", background: C.canvas, borderRadius: 2 }} role="img" aria-label={`${coin} price over 21 days with the forecast target ${fmtPrice(tgt)}.`}>
      {/* Implied-move band: last price → target. Neutral BONE, not the lean colour — the band
          measures the DISTANCE to a level, and a red wash across a downside forecast read as a
          loss. Direction is carried by the dashed rule, the arrow and the header chips. Drawn
          only while the target shares the plot; pinned to an edge it would BE the whole plot. */}
      {tgtY != null && tgtOff == null && <rect x={padL} y={Math.min(lastY, tgtY)} width={plotW} height={Math.max(1, Math.abs(tgtY - lastY))} fill={BONE} opacity="0.05" />}
      {tgtY != null && <>
        <line x1={padL} y1={tgtY} x2={plotW} y2={tgtY} stroke={FOG} strokeWidth="1" strokeDasharray="4 3" opacity="0.85" />
        <text x={padL + 2} y={tgtLabelY} fontFamily={MF} fontSize="7.5">
          <tspan fill={FOG}>{tgtOff === "above" ? "\u2191 " : tgtOff === "below" ? "\u2193 " : ""}</tspan>
          <tspan fill={FAINT}>TARGET </tspan><tspan fill={BONE} fontWeight="700">{fmtPrice(tgt)}</tspan>
          {tgtDist != null ? <tspan fill={FOG}> {tgtDist >= 0 ? "+" : ""}{tgtDist.toFixed(1)}%</tspan> : null}
          {tgtOff ? <tspan fill={FAINT}> · off scale</tspan> : null}
        </text>
      </>}
      <polyline points={line} fill="none" stroke={BONE} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={X(t1)} cy={lastY} r="2.5" fill={BONE} />
      <line x1={X(t1)} y1={lastY} x2={VB_W - gutterR} y2={lastY} stroke={BORDER_STRONG} strokeWidth="0.5" strokeDasharray="2 2" />
      <rect x={VB_W - gutterR} y={lastY - 8} width={gutterR - 6} height={16} rx="2" fill={SURFACE} stroke={BORDER_STRONG} />
      <text x={VB_W - gutterR + 4} y={lastY + 3.4} fill={BONE} fontFamily={MF} fontSize="8.5" fontWeight="700">{fmtPrice(lastPx)}</text>
      <line x1={padL} y1={plotBot + 4} x2={plotW} y2={plotBot + 4} stroke={BORDER} strokeWidth="0.75" />
      {ticks.map((tk, i) => <text key={i} x={Math.max(padL, Math.min(plotW, tk.x))} y={plotBot + 13} textAnchor={tk.anchor} fill={FAINT} fontFamily={MF} fontSize="7.5">{tk.label}</text>)}
    </svg>
  );
}

// ── FORECAST-PROBABILITY — the crowd's conviction over time ──────────────────
// Polymarket's YES probability (via /intel/events/history). The fetch lives in a hook so
// the CARD HEADER can carry the YES % + pt-change as chips (read first, not buried under
// an axis); the line below is a thin series on the Lab canvas. Fail-soft: null/[] → the
// chips fall back to the snapshot % and the line doesn't render.
type ProbPt = { t: number; p: number };
function useProbHistory(token: string | null): ProbPt[] | null {
  const [hist, setHist] = useState<ProbPt[] | null>(null);
  useEffect(() => {
    if (!token) { setHist([]); return; }
    let live = true; setHist(null);
    fetch(`${AGENT_API}/intel/events/history?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { if (live) setHist(Array.isArray(d?.history) ? d.history.filter((x: ProbPt) => Number.isFinite(x.p) && Number.isFinite(x.t)) : []); })
      .catch(() => { if (live) setHist([]); });
    return () => { live = false; };
  }, [token]);
  return hist;
}
// pt-change over the whole returned series (first → last), in percentage points.
function probChange(h: ProbPt[] | null): number | null {
  if (!h || h.length < 4) return null;
  return Math.round((h[h.length - 1].p - h[0].p) * 1000) / 10;
}

function ForecastProbLine({ hist, lean, question }: { hist: ProbPt[] | null; lean: string | null; question: string }) {
  const h = hist || [];
  if (h.length < 4) return null; // loading or no series → the price chart already carries the card

  void lean;
  const VB_W = 440, padL = 3, gutterR = 44, plotW = VB_W - padL - gutterR;
  const top = 10, H = 78, plotBot = H - 16;
  const ps = h.map((x) => x.p * 100);
  const lo = Math.max(0, Math.min(...ps) - 6), hi = Math.min(100, Math.max(...ps) + 6), sp = (hi - lo) || 1;
  const py = (v: number) => plotBot - ((v - lo) / sp) * (plotBot - top);
  const t0 = h[0].t, t1 = h[h.length - 1].t, tspan = (t1 - t0) || 1;
  const X = (t: number) => padL + ((t - t0) / tspan) * plotW;
  const line = h.map((x) => `${X(x.t).toFixed(1)},${py(x.p * 100).toFixed(1)}`).join(" ");
  const lastPct = ps[ps.length - 1], lastY = py(lastPct);
  const mid = lo <= 50 && hi >= 50 ? py(50) : null;
  const ticks = [0, 1, 2].map((i) => {
    const tt = t0 + (tspan * i) / 2;
    const anchor: "start" | "middle" | "end" = i === 0 ? "start" : i === 2 ? "end" : "middle";
    return { x: X(tt), label: new Date(tt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), anchor };
  });
  const MF = "var(--nx-font-mono)";
  return (
    <svg viewBox={`0 0 ${VB_W} ${H}`} style={{ display: "block", width: "100%", height: "auto", margin: "0 0 8px", background: C.canvas, borderRadius: 2 }} role="img" aria-label={`YES probability over time for: ${question}`}>
      {mid != null && <>
        <line x1={padL} y1={mid} x2={plotW} y2={mid} stroke={BORDER_STRONG} strokeWidth="0.75" strokeDasharray="3 4" />
        <text x={padL + 2} y={mid - 3} fill={FAINT} fontFamily={MF} fontSize="6.5" letterSpacing="0.5">50% · COIN-FLIP</text>
      </>}
      <text x={padL + 2} y={top - 2} fill={FAINT} fontFamily={MF} fontSize="6.5" letterSpacing="0.5">YES PROBABILITY</text>
      <polyline points={line} fill="none" stroke={BONE} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={X(t1)} cy={lastY} r="2.2" fill={BONE} />
      <line x1={X(t1)} y1={lastY} x2={VB_W - gutterR} y2={lastY} stroke={BORDER_STRONG} strokeWidth="0.5" strokeDasharray="2 2" />
      <text x={VB_W - gutterR + 4} y={lastY + 3} fill={FOG} fontFamily={MF} fontSize="8">{Math.round(lastPct)}%</text>
      <line x1={padL} y1={plotBot + 4} x2={plotW} y2={plotBot + 4} stroke={BORDER} strokeWidth="0.75" />
      {ticks.map((tk, i) => <text key={i} x={Math.max(padL, Math.min(plotW, tk.x))} y={plotBot + 13} textAnchor={tk.anchor} fill={FAINT} fontFamily={MF} fontSize="7.5">{tk.label}</text>)}
    </svg>
  );
}

const chip = (color: string, border: string): CSSProperties => ({
  color, fontFamily: "var(--nx-font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em",
  border: `1px solid ${border}`, borderRadius: 2, padding: "1px 6px", whiteSpace: "nowrap",
});

// ── THE CROWD vs HISTORY, as marks ─────────────────────────────────────────────
// One 0–100% track: a filled dot = the crowd's YES, a ring = how often the coin itself made the move (history). The gap
// between them IS the read. Marks on a track, never a filling bar (house rule for /proof and /intel).
function OddsTrack({ crowd, history }: { crowd: number; history: number | null }) {
  const W = 440, H = 46, L = 8, R = W - 8, y = 19;
  const X = (p: number) => L + (Math.max(0, Math.min(100, p)) / 100) * (R - L);
  const MF = "var(--nx-font-mono)";
  const cx = X(crowd), hx = history == null ? null : X(history);
  const near = hx != null && Math.abs(cx - hx) < 70; // labels would collide: stack them
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto", margin: "2px 0 10px" }} role="img"
      aria-label={`Crowd ${Math.round(crowd)}%${history == null ? ", history unread" : `, the coin's own history ${Math.round(history)}%`}`}>
      <line x1={L} y1={y} x2={R} y2={y} stroke={BORDER_STRONG} strokeWidth="1" />
      {[0, 50, 100].map((p) => <line key={p} x1={X(p)} y1={y - 3} x2={X(p)} y2={y + 3} stroke={BORDER_STRONG} strokeWidth="1" />)}
      {hx != null && <line x1={Math.min(cx, hx)} y1={y} x2={Math.max(cx, hx)} y2={y} stroke={FOG} strokeWidth="1.4" opacity="0.55" />}
      {hx != null && <circle cx={hx} cy={y} r="5.5" fill={C.canvas} stroke={FOG} strokeWidth="1.4" />}
      <circle cx={cx} cy={y} r="5.5" fill={BONE} />
      <text x={Math.min(R - 2, Math.max(L + 2, cx))} y={y + (near && hx != null && cx < hx ? 20 : -9)} textAnchor="middle" fill={BONE} fontFamily={MF} fontSize="12" fontWeight="700">crowd {Math.round(crowd)}%</text>
      {hx != null && <text x={Math.min(R - 2, Math.max(L + 2, hx))} y={y + (near && cx >= hx ? 20 : near ? -9 : 20)} textAnchor="middle" fill={FOG} fontFamily={MF} fontSize="12">history {history! < 1 && history! > 0 ? history!.toFixed(1) : Math.round(history!)}%</text>}
      {hx == null && <text x={R} y={y + 20} textAnchor="end" fill={FAINT} fontFamily={MF} fontSize="11">history unread</text>}
    </svg>
  );
}

// Post a call from this market: the trader picks Long or Short here. The tab never picks one (2026-11-23: it used to
// side with the crowd and write the thesis note itself). Same hand-off as the coin drawer and the market table.
function CallPick({ coin, compact = false }: { coin: string; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const btn: CSSProperties = { color: BONE, background: "transparent", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: compact ? "2px 8px" : "3px 10px", fontFamily: "var(--nx-font-ui)", fontSize: 12, cursor: "pointer", minHeight: 28 };
  if (!open) return <button type="button" className="nx-press" onClick={() => setOpen(true)} style={btn} aria-label={`Post a call on ${coin}`}>{compact ? "Call" : "Post a call"}</button>;
  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      {!compact && <span style={{ color: FAINT, fontFamily: "var(--nx-font-ui)", fontSize: 11.5 }}>Your side:</span>}
      {(["LONG", "SHORT"] as const).map((side) => (
        <button key={side} type="button" className="nx-press" style={btn} onClick={() => handOffCall(coin, side, navigate, "forecast-divergence")}>{side === "LONG" ? "Long" : "Short"}</button>
      ))}
      <button type="button" onClick={() => setOpen(false)} style={{ ...btn, border: "none", color: DIM }}>Cancel</button>
    </span>
  );
}

// The hero: the market with the biggest gap between the crowd and the coin's own history (divergences first).
function ForecastCard({ m }: { m: ForecastMarket }) {
  const hist = useProbHistory(m.clobTokenId);
  const chg = probChange(hist);
  const yes = hist && hist.length >= 4 ? Math.round(hist[hist.length - 1].p * 100) : m.forecastProbPct;
  const isMobile = useIsMobile();
  const read = forecastRead({ coin: m.coin, yesPct: yes, target: m.target, targetDirection: m.targetDirection, distancePct: m.distancePct,
    forecastLean: m.forecastLean, fundingLean: m.fundingLean, divergence: m.divergence, ends: m.endDate ? fmtEnds(m.endDate) : null,
    history: m.history, crowdGapPts: m.crowdGapPts });
  const state = forecastChip(m);
  return (
    <div style={{ border: `1px solid ${state.watch ? `${WATCH}55` : BORDER}`, background: SURFACE, borderRadius: 2, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={chip(state.watch ? WATCH : BONE, state.watch ? `${WATCH}66` : BORDER_STRONG)}>{state.watch ? "◆ " : ""}{state.word.toUpperCase()}</span>
        <span style={{ color: BONE, fontFamily: "var(--nx-font-mono)", fontSize: 12, fontWeight: 700 }}><CoinLink coin={m.coin} /></span>
        <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)" }}>{fmtPrice(m.markPrice)}</span>
        {chg != null ? <span style={chip(FOG, BORDER_STRONG)}>{chg >= 0 ? "+" : ""}{chg}pt · 30d</span> : null}
        {m.endDate ? <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)", marginLeft: "auto" }}>ends {fmtEnds(m.endDate)}</span> : null}
      </div>
      <div style={{ color: FOG, fontSize: 12, lineHeight: 1.45, marginBottom: 4 }}>{m.question}</div>
      <OddsTrack crowd={yes} history={m.history ? m.history.pct : null} />
      {/* The read, in plain words (app/lib/forecastRead.mjs). */}
      <div style={{ background: C.inset, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "9px 11px", marginBottom: 10 }}>
        <div style={{ color: BONE, fontFamily: "var(--nx-font-ui)", fontSize: 13.5, lineHeight: 1.55 }}>{read.read}</div>
        {read.caveat && <div style={{ color: WATCH, fontFamily: "var(--nx-font-ui)", fontSize: 12.5, lineHeight: 1.5, marginTop: 4 }}>{read.caveat}</div>}
      </div>
      {/* Phone: stacked. Desktop: two columns at half width. */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "minmax(0,1fr) minmax(0,1fr)", gap: isMobile ? 0 : 16, alignItems: "start" }}>
        <div style={{ minWidth: 0 }}>
          <ForecastChart coin={m.coin} markPrice={m.markPrice} target={m.target} forecastLean={m.forecastLean} />
          <ForecastProbLine hist={hist} lean={m.forecastLean} question={m.question} />
        </div>
        {/* The expected-move cone (realized volatility), WITHOUT the funding-fade lean: this card's subject is the crowd. */}
        <div style={{ minWidth: 0, margin: isMobile ? "8px 0" : 0 }}>
          <ProjectionBand symbol={m.coin} height={196} showLean={false} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontFamily: "var(--nx-font-mono)", fontSize: 10, marginTop: 4 }}>
        <span style={{ color: DIM }}>crowd vs history <b style={{ color: leanColor(m.forecastLean) }}>{leanWord(m.forecastLean)}</b></span>
        <span style={{ color: DIM }}>funding <b style={{ color: leanColor(m.fundingLean) }}>{leanWord(m.fundingLean)}</b></span>
        {m.target != null ? <span style={{ color: DIM }}>{fmtPrice(m.target)} ({m.distancePct != null && m.distancePct > 0 ? "+" : ""}{m.distancePct}%)</span> : null}
        <span style={{ color: FAINT }}>{fmtUsd(m.volumeUsd)} vol</span>
        <span style={{ marginLeft: "auto" }}><CallPick coin={m.coin} /></span>
      </div>
    </div>
  );
}

// Every other price-target market: one row, crowd vs history as numbers.
function ForecastRow({ m }: { m: ForecastMarket }) {
  const state = forecastChip(m);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 10, lineHeight: 1.4, padding: "7px 0", borderTop: `1px solid ${BORDER}`, flexWrap: "wrap" }}>
      <span style={{ color: state.watch ? WATCH : FAINT, fontSize: 9, width: 10 }}>{state.watch ? "◆" : "·"}</span>
      <span style={{ color: BONE, fontWeight: 700, minWidth: 34 }}><CoinLink coin={m.coin} /></span>
      <span style={{ color: FOG, flex: "1 1 180px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
      <span style={{ color: BONE, whiteSpace: "nowrap" }}>crowd {Math.round(m.forecastProbPct)}%</span>
      <span style={{ color: FOG, whiteSpace: "nowrap" }}>history {m.history ? `${m.history.pct < 1 && m.history.pct > 0 ? m.history.pct.toFixed(1) : Math.round(m.history.pct)}%` : "unread"}</span>
      <span style={{ color: state.watch ? WATCH : DIM, whiteSpace: "nowrap" }}>{state.word}</span>
      <CallPick coin={m.coin} compact />
    </div>
  );
}

export function ForecastDivergence() {
  const [markets, setMarkets] = useState<ForecastMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return; // no polling in a background tab
      try {
        const r = await fetch(`${AGENT_API}/intel/forecasts`);
        const d = await r.json();
        if (!cancelled) { setMarkets(Array.isArray(d?.markets) ? d.markets : []); setFailed(!r.ok || !!d?.error); }
      } catch { if (!cancelled) setFailed(true); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    const iv = setInterval(load, 120_000); // 2-min poll (the board is KV-cached 5 min)
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // OUR MARKETS ONLY: a forecast shows only when it maps to a market you can trade here (Orderly returned a mark).
  const tradable = markets.filter((m) => m.markPrice != null && m.symbol);
  // Near-money price targets, in the board's order (divergences, then the biggest crowd-vs-history gap, then volume).
  const strikes = tradable.filter((m) => m.target != null && m.nearMoney);
  const context = tradable.filter((m) => !(m.target != null && m.nearMoney)).slice(0, 5);
  const divergent = strikes.filter((m) => m.divergence).length;

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHeader eyebrow="Forecasters vs history" title="Forecast Divergence" note="THE CROWD'S ODDS vs THE COIN'S OWN HISTORY · OUR MARKETS" />

      <div style={{ background: SURFACE, border: `1px solid ${BORDER}`, borderRadius: 2, padding: "14px 16px" }}>
        {loading ? (
          <div style={{ color: FAINT, fontSize: 11, fontFamily: "var(--nx-font-mono)" }}>Reading prediction markets…</div>
        ) : !tradable.length ? (
          <div style={{ color: DIM, fontSize: 12, fontFamily: "var(--nx-font-ui)", lineHeight: 1.6 }}>
            {failed ? "Couldn’t read the prediction markets right now. Try again in a few minutes." : "No forecasts on a market you can trade here right now. They’re sparse by design: mostly BTC and ETH price targets."}
          </div>
        ) : (
          <>
            <div style={{ color: FOG, fontFamily: "var(--nx-font-ui)", fontSize: 12.5, lineHeight: 1.55, marginBottom: 12 }}>
              Each price target next to how often the coin itself made that move in the time left, over its last year. A gap
              of 10+ points is a lean. {strikes.length ? (divergent ? `${divergent} of ${strikes.length} lean${divergent === 1 ? "s" : ""} against funding.` : `None of ${strikes.length} lean${strikes.length === 1 ? "s" : ""} against funding right now.`) : ""}
            </div>
            {strikes.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <ForecastCard key={strikes[0].id ?? strikes[0].question} m={strikes[0]} />
                {strikes.length > 1 && <div>{strikes.slice(1).map((m) => <ForecastRow key={m.id ?? m.question} m={m} />)}</div>}
              </div>
            ) : (
              <div style={{ color: DIM, fontSize: 12, fontFamily: "var(--nx-font-ui)", lineHeight: 1.6 }}>
                No near-money price targets on our markets right now. Other forecasts below.
              </div>
            )}

            {context.length > 0 && (
              <div style={{ marginTop: 14, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
                <div style={{ color: FAINT, fontSize: 9, fontFamily: "var(--nx-font-mono)", letterSpacing: "0.14em", marginBottom: 8 }}>ALSO FORECAST · far strikes and other questions</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {context.map((m) => (
                    <div key={m.id ?? m.question} style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 10, lineHeight: 1.4 }}>
                      <span style={{ color: BONE, fontWeight: 700, minWidth: 34 }}><CoinLink coin={m.coin} /></span>
                      <span style={{ color: BONE, minWidth: 40 }}>{Math.round(m.forecastProbPct)}%</span>
                      <span style={{ color: FOG, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
                      {m.history ? <span style={{ color: DIM, whiteSpace: "nowrap" }}>history {Math.round(m.history.pct)}%</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, color: FAINT, fontSize: 11, fontFamily: "var(--nx-font-ui)", lineHeight: 1.6 }}>
              Odds from Polymarket. History = how often the coin made that move (a touch for “reach / dip to”, a close for
              “above / below”) from each start day of its last year, on Orderly daily bars: overlapping windows, a base rate,
              not a fair value. Funding from Orderly. Not graded: a prompt to look closer, not a signal. Not advice.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ForecastDivergence;
