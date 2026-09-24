import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { THESIS_DRAFT_KEY } from "@/config/assistantTools";
import { C } from "@/config/theme";
import { ProjectionBand } from "@/components/ProjectionBand";
import { SectionHeader } from "./components";

// ── Forecast Divergence card (the prediction-market lens) ────────────────────
// Quotient-informed sibling of the Mispriced Board: reads the FORECASTING crowd
// (Polymarket) instead of the funding crowd, joins it to our tape, and — on
// near-money price-target markets — flags where the forecast lean disagrees with
// leveraged positioning. We never claim a fair probability; a divergence is a
// prompt to INVESTIGATE and to stake a GRADED thesis on the gap. Fail-soft:
// renders a quiet "no linked forecasts" line when the feed is sparse (by design).

const AGENT_API = "https://og.nexustradinglabs.com";
// Palette repointed to the canonical design tokens (app/config/theme.ts) — collapses
// the local-hex drift so this corner matches the Mispriced Board + the rest of the Lab.
const BONE = C.text.bright, DIM = C.text.muted, FAINT = C.text.faint;
const WARN = C.warn, POS = C.pos, NEG = C.neg;
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

// Lean → chip color: the FORECAST lean sides with the prediction crowd; UP/DOWN
// gets profit/loss chroma only as directional data (consistent with the P&L rule).
const leanColor = (l: string | null) => (l === "UP" ? POS : l === "DOWN" ? NEG : DIM);

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
  const yLo = lo - pad, yHi = hi + pad;
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
  const lc = leanColor(forecastLean);
  const ticks = [0, 1, 2].map((i) => {
    const tt = t0 + (tspan * i) / 2;
    const anchor: "start" | "middle" | "end" = i === 0 ? "start" : i === 2 ? "end" : "middle";
    return { x: X(tt), label: new Date(tt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), anchor };
  });
  const MF = "var(--nx-font-mono)";
  const tgtLabel = tgt == null ? "" : `${tgtOff === "above" ? "↑ " : tgtOff === "below" ? "↓ " : ""}TARGET ${fmtPrice(tgt)}${tgtDist != null ? ` · ${tgtDist >= 0 ? "+" : ""}${tgtDist.toFixed(1)}%` : ""}`;
  // Label sits on the inside of the plot so an edge-pinned target never clips.
  const tgtLabelY = tgtY == null ? 0 : tgtOff === "below" ? tgtY - 3.5 : tgtOff === "above" ? tgtY + 9 : (tgtY - 3.5 < top + 6 ? tgtY + 9 : tgtY - 3.5);
  return (
    <svg viewBox={`0 0 ${VB_W} ${H}`} style={{ display: "block", width: "100%", height: "auto", margin: "2px 0 8px", background: C.canvas, borderRadius: 2 }} role="img" aria-label={`${coin} price over 21 days with the forecast target ${fmtPrice(tgt)}.`}>
      {/* faint implied-move wash: last price → target (clipped to the plot), never a wall */}
      {tgtY != null && <rect x={padL} y={Math.min(lastY, tgtY)} width={plotW - padL} height={Math.max(1, Math.abs(tgtY - lastY))} fill={lc} opacity="0.08" />}
      {tgtY != null && <>
        <line x1={padL} y1={tgtY} x2={plotW} y2={tgtY} stroke={lc} strokeWidth="1" strokeDasharray="4 3" opacity="0.85" />
        <text x={padL + 2} y={tgtLabelY} fill={lc} fontFamily={MF} fontSize="7.5" opacity="0.95">{tgtLabel}</text>
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

  const c = leanColor(lean);
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
      <polyline points={line} fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" strokeLinecap="round" opacity="0.9" />
      <circle cx={X(t1)} cy={lastY} r="2.2" fill={c} />
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

// The PRIMARY divergence — the one full chart. Lab surface (not the old olive/brown
// #1c1608), a hairline warn border as the only flag tint, YES % + pt-change as header chips.
function DivergentCard({ m, onDraft }: { m: ForecastMarket; onDraft: (m: ForecastMarket) => void }) {
  const hist = useProbHistory(m.clobTokenId);
  const chg = probChange(hist);
  const yes = hist && hist.length >= 4 ? Math.round(hist[hist.length - 1].p * 100) : m.forecastProbPct;
  return (
    <div style={{ border: `1px solid ${WARN}33`, background: SURFACE, borderRadius: 2, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={chip(WARN, `${WARN}55`)}>◆ DIVERGENT</span>
        <span style={{ color: BONE, fontFamily: "var(--nx-font-mono)", fontSize: 12, fontWeight: 700 }}>{m.coin}</span>
        <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)" }}>{fmtPrice(m.markPrice)}</span>
        <span style={chip(BONE, BORDER_STRONG)}>YES {yes}%</span>
        {chg != null ? <span style={chip(chg >= 0 ? POS : NEG, BORDER_STRONG)}>{chg >= 0 ? "+" : ""}{chg}pt · 30d</span> : null}
        {m.endDate ? <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)", marginLeft: "auto" }}>ends {fmtEnds(m.endDate)}</span> : null}
      </div>
      <div style={{ color: FOG, fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{m.question}</div>
      <ForecastChart coin={m.coin} markPrice={m.markPrice} target={m.target} forecastLean={m.forecastLean} />
      <ForecastProbLine hist={hist} lean={m.forecastLean} question={m.question} />
      {/* PROJECTION — the expected-move cone, a third independent forward lens next to the
          prediction-market forecast + the crypto tape. */}
      <div style={{ margin: "8px 0" }}>
        <ProjectionBand symbol={m.coin} height={196} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontFamily: "var(--nx-font-mono)", fontSize: 10 }}>
        <span style={{ color: DIM }}>forecast lean <b style={{ color: leanColor(m.forecastLean) }}>{m.forecastLean}</b></span>
        <span style={{ color: DIM }}>tape (funding) <b style={{ color: leanColor(m.fundingLean) }}>{m.fundingLean}</b></span>
        {m.target != null ? <span style={{ color: DIM }}>{fmtPrice(m.target)} target ({m.distancePct}%)</span> : null}
        <span style={{ color: FAINT }}>{fmtUsd(m.volumeUsd)} vol</span>
        <button type="button" onClick={() => onDraft(m)} className="nx-press"
          style={{ marginLeft: "auto", color: BONE, background: "transparent", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "3px 10px", fontFamily: "var(--nx-font-mono)", fontSize: 10, cursor: "pointer" }}
        >◆ draft thesis</button>
      </div>
    </div>
  );
}

// Every OTHER divergence — a list row, not a second full chart (one hero per section).
function DivergentRow({ m, onDraft }: { m: ForecastMarket; onDraft: (m: ForecastMarket) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 10, lineHeight: 1.4, padding: "6px 0", borderTop: `1px solid ${BORDER}` }}>
      <span style={{ color: WARN, fontSize: 9 }}>◆</span>
      <span style={{ color: BONE, fontWeight: 700, minWidth: 34 }}>{m.coin}</span>
      <span style={{ color: BONE, minWidth: 40 }}>{m.forecastProbPct}%</span>
      <span style={{ color: FOG, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
      <span style={{ color: DIM, whiteSpace: "nowrap" }}>lean <b style={{ color: leanColor(m.forecastLean) }}>{m.forecastLean}</b> · tape <b style={{ color: leanColor(m.fundingLean) }}>{m.fundingLean}</b></span>
      <button type="button" onClick={() => onDraft(m)} className="nx-press" aria-label={`Draft a thesis on ${m.coin}`}
        style={{ flexShrink: 0, color: BONE, background: "transparent", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "2px 8px", fontFamily: "var(--nx-font-mono)", fontSize: 10, cursor: "pointer" }}
      >◆</button>
    </div>
  );
}

export function ForecastDivergence() {
  const [markets, setMarkets] = useState<ForecastMarket[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch(`${AGENT_API}/intel/forecasts`);
        const d = await r.json();
        if (!cancelled) setMarkets(Array.isArray(d?.markets) ? d.markets : []);
      } catch { if (!cancelled) setMarkets([]); }
      finally { if (!cancelled) setLoading(false); }
    };
    load();
    const iv = setInterval(load, 120_000); // 2-min poll (endpoint is KV-cached 5-min)
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Turn a divergence into a graded thesis: side with the forecasting crowd against
  // the offside tape. Pre-fills symbol/direction/entry/notes; the user sets risk.
  const draftFrom = (m: ForecastMarket) => {
    const dir = m.forecastLean === "UP" ? "LONG" : "SHORT";
    const draft = {
      symbol: m.coin,
      direction: dir,
      entryPrice: m.markPrice != null ? String(m.markPrice) : "",
      stopLoss: "",
      takeProfit1: "",
      notes: `Forecast divergence — Polymarket crowd leans ${m.forecastLean} (${m.forecastProbPct}% on "${m.question}") while funding leans ${m.fundingLean}. Thesis: the forecasters are right and the leveraged tape is offside.`,
      catalyst: "prediction-market divergence",
      targetWindow: m.endDate ? `by ${fmtEnds(m.endDate)}` : undefined,
    };
    try { window.localStorage.setItem(THESIS_DRAFT_KEY, JSON.stringify(draft)); } catch { /* ignore */ }
    navigate(`/lab?tab=thesis`);
    try {
      window.dispatchEvent(new CustomEvent("nexus:lab-tab", { detail: { tab: "thesis" } }));
      window.dispatchEvent(new CustomEvent("nexus:thesis-draft"));
    } catch { /* SSR — ignore */ }
  };

  // OUR MARKETS ONLY (until the Quotient feed lands): a forecast is only shown when it
  // maps to a market you can actually trade on Nexus — i.e. Orderly returned a live mark
  // (markPrice) for it. Keeps borst's "if you can't trade it here, it isn't in the UI"
  // rule; a prediction on an unlisted coin is noise until we list it.
  const tradable = markets.filter((m) => m.markPrice != null && m.symbol);
  // Deepest-volume divergence first — it gets the one full chart; the rest are list rows.
  const divergent = tradable.filter((m) => m.divergence).sort((a, b) => (b.volumeUsd || 0) - (a.volumeUsd || 0));
  const nearOther = tradable.filter((m) => m.nearMoney && !m.divergence).slice(0, 4);
  const context = tradable.filter((m) => !m.nearMoney).slice(0, 5);

  return (
    <div style={{ marginTop: 20 }}>
      <SectionHeader eyebrow="Forecasters vs the tape" title="Forecast Divergence" note="PREDICTION CROWD vs FUNDING · OUR MARKETS" />

      <div style={{
        background: "#141416", border: `1px solid ${BORDER}`, borderRadius: 2, padding: "14px 16px",
      }}>
        {loading ? (
          <div style={{ color: FAINT, fontSize: 11, fontFamily: "var(--nx-font-mono)" }}>Reading prediction markets…</div>
        ) : !tradable.length ? (
          <div style={{ color: DIM, fontSize: 11, fontFamily: "var(--nx-font-mono)", lineHeight: 1.6 }}>
            No linked forecasts on a tradable market right now — sparse by design (near-money strikes on the coins listed here, mostly BTC / ETH).
          </div>
        ) : (
          <>
            {/* Flagged near-money divergences — the signal */}
            {divergent.length > 0 ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <DivergentCard key={divergent[0].id ?? divergent[0].question} m={divergent[0]} onDraft={draftFrom} />
                {divergent.length > 1 && (
                  <div>
                    {divergent.slice(1).map((m) => <DivergentRow key={m.id ?? m.question} m={m} onDraft={draftFrom} />)}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ color: DIM, fontSize: 11, fontFamily: "var(--nx-font-mono)", lineHeight: 1.6 }}>
                No forecast divergences right now — the forecasting crowd and the leveraged tape agree on the near-money strikes. Context below.
              </div>
            )}

            {/* Near-money agreements + far context — surfaced, not flagged */}
            {(nearOther.length > 0 || context.length > 0) && (
              <div style={{ marginTop: divergent.length ? 14 : 12, borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 10 }}>
                <div style={{ color: FAINT, fontSize: 9, fontFamily: "var(--nx-font-mono)", letterSpacing: "0.14em", marginBottom: 8 }}>CONTEXT · what the crowd is forecasting</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[...nearOther, ...context].slice(0, 6).map((m) => (
                    <div key={m.id ?? m.question} style={{ display: "flex", alignItems: "baseline", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 10, lineHeight: 1.4 }}>
                      <span style={{ color: BONE, fontWeight: 700, minWidth: 34 }}>{m.coin}</span>
                      <span style={{ color: BONE, minWidth: 40 }}>{m.forecastProbPct}%</span>
                      <span style={{ color: FOG, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.question}</span>
                      {m.alignment === "ALIGNED" ? <span style={{ color: POS, fontSize: 9 }}>aligned</span> : null}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, color: FAINT, fontSize: 9, fontFamily: "var(--nx-font-mono)", lineHeight: 1.6 }}>
              Forecasts from Polymarket, joined to Orderly funding. A divergence = the forecasting crowd and leveraged positioning
              disagree on a near-money strike — a prompt to investigate, not a signal. Not a fair-value oracle. Not advice.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default ForecastDivergence;
