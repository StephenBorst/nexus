import { useEffect, useState } from "react";
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
// The plot's own ground. A chart drawn straight onto the amber DIVERGENT card turned every
// low-opacity tint olive; giving the plot Lab near-black keeps tints reading as tints.
const PLOT_BG = C.canvas;

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

// The floor on how much of the plot the PRICE series is guaranteed. The forecast target
// joins the y-domain only while the tape still owns at least this share of the height;
// past that it is pinned to the edge and labelled "off scale", so a distant strike can
// never squash the one mark the chart exists to show.
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

// ── THE FORECAST CHART — the Quotient "Silver" view on our tape ────────────────
// ONE primary chart per flagged market. The PRICE line is the hero (bone, the only
// weighted mark); the prediction market's TARGET is a recessive dashed threshold with a
// direct label; the gap between them — the implied move — is a whisper-tint over the
// chart's OWN near-black plot, with the move directly labelled in the gutter.
// ⚠️ It used to be a lean-coloured wash at 8% painted across the FULL plot on top of the
// card's amber surface — a saturated block spanning the plot, which reads as an olive
// wall, not a band. The fix is the plot's own C.canvas ground (so the tint sits on
// near-black, not on amber) + a tint low enough to whisper. Chroma is rationed to the
// target rule and the move label; every string wears a TEXT token, never the lean colour.
function ForecastChart({ coin, markPrice, target, forecastLean, distancePct }: {
  coin: string; markPrice: number | null; target: number | null; forecastLean: string | null; distancePct: number | null;
}) {
  const price = useOrderlyPrice(coin, 21);
  const pc = (price || []).filter((p) => Number.isFinite(p.c) && p.c > 0);
  if (pc.length < 2) return null;

  const VB_W = 440, padL = 3, gutterR = 62;
  const plotW = VB_W - padL - gutterR, plotR = padL + plotW;
  const top = 15, H = 152, plotBot = H - 20;
  const cs = pc.map((p) => p.c);
  const tgt = target != null && Number.isFinite(target) ? target : null;
  const mk = markPrice != null && Number.isFinite(markPrice) ? markPrice : cs[cs.length - 1];
  // ⚠️ The y-domain is the TAPE, never the target. Stretching the scale to reach a strike
  // 33% away flattened three weeks of price into a squiggle along the bottom edge — the
  // hero mark, destroyed to fit a single horizontal rule. A far target is pinned to the
  // plot edge and labelled "off scale" instead; the level and the implied move are both
  // still stated, and the tape keeps the full height.
  const vals = [...cs, mk];
  const lo = Math.min(...vals), hi = Math.max(...vals), sp = (hi - lo) || 1, pad = sp * 0.08;
  const pLo = lo - pad, pHi = hi + pad, pSpan = (pHi - pLo) || 1;
  // Widen the domain to include the target ONLY while the tape keeps most of the plot. A
  // near-money strike belongs on the chart (that is the whole card); a strike 33% away does
  // not, and forcing it in is what flattened three weeks of price into the bottom edge.
  const wLo = tgt != null ? Math.min(pLo, tgt) : pLo;
  const wHi = tgt != null ? Math.max(pHi, tgt) : pHi;
  const wSpan = (wHi - wLo) * 1.08; // the 4%-a-side breathing room the target rule needs
  const inScale = tgt != null && wSpan > 0 && pSpan / wSpan >= TAPE_MIN_SHARE;
  const dLo = inScale ? wLo - (wHi - wLo) * 0.04 : pLo;
  const dHi = inScale ? wHi + (wHi - wLo) * 0.04 : pHi;
  const py = (c: number) => plotBot - ((c - dLo) / (dHi - dLo)) * (plotBot - top);
  const t0 = pc[0].t, t1 = pc[pc.length - 1].t, tspan = (t1 - t0) || 1;
  const X = (t: number) => padL + ((t - t0) / tspan) * plotW;
  const line = pc.map((p) => `${X(p.t).toFixed(1)},${py(p.c).toFixed(1)}`).join(" ");
  const area = `${line} L${X(t1).toFixed(1)},${plotBot} L${X(t0).toFixed(1)},${plotBot} Z`;
  const lastY = py(cs[cs.length - 1]);
  const lc = leanColor(forecastLean);
  const above = tgt != null && tgt > dHi;
  const tgtY = tgt == null ? null : inScale ? py(tgt) : above ? top + 1 : plotBot - 1;
  // The implied-move band only exists when the target shares the plot. Off scale it would
  // be the ENTIRE plot — the saturated wall this rewrite exists to kill — so the gutter
  // label carries the move instead. Neutral bone, not the lean colour: the band is the
  // DISTANCE to a level, and painting it red made a downside forecast read as a loss.
  const bandH = inScale && tgtY != null ? Math.abs(tgtY - lastY) : 0;
  const moveLabel = distancePct != null && Number.isFinite(distancePct)
    ? `${distancePct > 0 ? "+" : ""}${distancePct}%` : null;
  const ticks = [0, 1, 2].map((i) => {
    const tt = t0 + (tspan * i) / 2;
    const anchor: "start" | "middle" | "end" = i === 0 ? "start" : i === 2 ? "end" : "middle";
    return { x: X(tt), label: new Date(tt).toLocaleDateString(undefined, { month: "short", day: "numeric" }), anchor };
  });
  const MF = "var(--nx-font-mono)";
  return (
    <svg viewBox={`0 0 ${VB_W} ${H}`} style={{ display: "block", width: "100%", height: "auto", margin: "2px 0 6px" }} role="img" aria-label={`${coin} price over 21 days against the ${fmtPrice(tgt)} forecast target${moveLabel ? `, an implied move of ${moveLabel}` : ""}.`}>
      {/* The plot's own ground — Lab near-black. Isolates the chart from the card's amber
          DIVERGENT surface so a low tint above reads as a tint and not as a wall. */}
      <rect x={padL} y={4} width={plotW} height={plotBot - 4} rx="2" fill={PLOT_BG} />
      {/* implied-move band: price now → forecast target, only while both share the plot. */}
      {bandH > 0 && tgtY != null && <rect x={padL} y={Math.min(lastY, tgtY)} width={plotW} height={bandH} fill={BONE} opacity="0.05" />}
      <path d={area} fill={BONE} opacity="0.05" />
      {/* HERO: the tape. The only weighted mark on the plot. */}
      <polyline points={line} fill="none" stroke={BONE} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      {tgtY != null && <>
        <line x1={padL} y1={tgtY} x2={plotR} y2={tgtY} stroke={lc} strokeWidth="1" strokeDasharray="4 3" opacity={inScale ? 0.75 : 0.5} />
        <text x={padL + 3} y={inScale || !above ? tgtY - 4 : tgtY + 9} fontFamily={MF} fontSize="7.5" letterSpacing="0.06em">
          <tspan fill={lc}>{inScale ? "" : above ? "▲ " : "▼ "}</tspan>
          <tspan fill={FAINT}>TARGET </tspan><tspan fill={BONE} fontWeight="700">{fmtPrice(tgt)}</tspan>
          {moveLabel ? <tspan fill={FOG}> {moveLabel}</tspan> : null}
          {inScale ? null : <tspan fill={FAINT}> · off scale</tspan>}
        </text>
        {moveLabel && bandH >= 16 ? (
          <text x={plotR - 4} y={(lastY + tgtY) / 2 + 2.6} textAnchor="end" fill={FOG} fontFamily={MF} fontSize="7.5">{moveLabel} implied</text>
        ) : null}
      </>}
      <circle cx={X(t1)} cy={lastY} r="2.5" fill={BONE} />
      {/* Chrome is a solid hairline — dashing here would read as a second threshold. */}
      <line x1={X(t1)} y1={lastY} x2={VB_W - gutterR} y2={lastY} stroke={BORDER_STRONG} strokeWidth="0.5" />
      <rect x={VB_W - gutterR} y={lastY - 8} width={gutterR - 6} height={16} rx="2" fill={SURFACE} stroke={BORDER_STRONG} />
      <text x={VB_W - gutterR + 4} y={lastY + 3.4} fill={BONE} fontFamily={MF} fontSize="8.5" fontWeight="700">{fmtPrice(cs[cs.length - 1])}</text>
      <line x1={padL} y1={plotBot + 4} x2={plotR} y2={plotBot + 4} stroke={BORDER} strokeWidth="0.75" />
      {ticks.map((tk, i) => <text key={i} x={Math.max(padL, Math.min(plotR, tk.x))} y={plotBot + 14} textAnchor={tk.anchor} fill={FAINT} fontFamily={MF} fontSize="7.5">{tk.label}</text>)}
    </svg>
  );
}

// ── FORECAST PROBABILITY — the crowd's conviction, demoted to a header chip ───
// Polymarket's YES series used to get a second full-size chart under the price chart,
// which made every flagged market a three-chart stack. The two numbers that actually
// carry the read — where YES sits now and which way it has moved over 30d — are chips,
// with the shape preserved as a micro-line beside them. Fail-soft: no history ⇒ the
// chip renders the live probability alone and the spark is simply absent.
function useForecastProb(token: string | null) {
  const [hist, setHist] = useState<{ t: number; p: number }[] | null>(null);
  useEffect(() => {
    if (!token) { setHist([]); return; }
    let live = true; setHist(null);
    fetch(`${AGENT_API}/intel/events/history?token=${encodeURIComponent(token)}`)
      .then((r) => r.json())
      .then((d) => { if (live) setHist(Array.isArray(d?.history) ? d.history.filter((x: { p: number }) => Number.isFinite(x.p)) : []); })
      .catch(() => { if (live) setHist([]); });
    return () => { live = false; };
  }, [token]);
  const h = (hist || []).filter((x) => Number.isFinite(x.p) && Number.isFinite(x.t));
  if (h.length < 4) return null;
  const ps = h.map((x) => x.p * 100);
  return { points: h, pct: ps, changePt: Math.round((ps[ps.length - 1] - ps[0]) * 10) / 10 };
}

// Micro-line for the YES chip — shape only, no axes, no labels (the chip carries both
// numbers). ~52×14 so it sits on the chip's baseline without changing its height.
function ProbSpark({ pct, color }: { pct: number[]; color: string }) {
  const W = 52, H = 14, lo = Math.min(...pct), hi = Math.max(...pct), sp = (hi - lo) || 1;
  const pts = pct.map((v, i) => `${((i / (pct.length - 1)) * W).toFixed(1)},${(H - 1.5 - ((v - lo) / sp) * (H - 3)).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: "block", opacity: 0.85 }} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// A header chip — the card's read expressed as discrete facts instead of chart chrome.
function Chip({ label, children, tone }: { label: string; children: React.ReactNode; tone?: string }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5, fontFamily: "var(--nx-font-mono)", fontSize: 10,
      border: `1px solid ${tone ? tone + "44" : BORDER_STRONG}`, borderRadius: 2, padding: "2px 7px", background: PLOT_BG,
    }}>
      <span style={{ color: FAINT, fontSize: 8.5, letterSpacing: "0.12em" }}>{label}</span>
      {children}
    </span>
  );
}

// One divergent market — the PRIMARY card. Only the top flagged market gets this
// treatment; the rest render as compact rows (DivergentRow) so the section reads as one
// chart plus a list, not a scroll of stacked charts.
function DivergentCard({ m, onDraft }: { m: ForecastMarket; onDraft: (m: ForecastMarket) => void }) {
  const prob = useForecastProb(m.clobTokenId);
  const lc = leanColor(m.forecastLean);
  return (
    <div style={{ border: `1px solid ${WARN}44`, background: "#1c1608", borderRadius: 2, padding: "10px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
        <span style={{ color: WARN, fontFamily: "var(--nx-font-mono)", fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", border: `1px solid ${WARN}55`, borderRadius: 2, padding: "1px 6px" }}>◆ DIVERGENT</span>
        <span style={{ color: BONE, fontFamily: "var(--nx-font-mono)", fontSize: 12, fontWeight: 700 }}>{m.coin}</span>
        <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)" }}>{fmtPrice(m.markPrice)}</span>
        {m.endDate ? <span style={{ color: FAINT, fontSize: 10, fontFamily: "var(--nx-font-mono)", marginLeft: "auto" }}>ends {fmtEnds(m.endDate)}</span> : null}
      </div>
      <div style={{ color: FOG, fontSize: 12, lineHeight: 1.45, marginBottom: 8 }}>{m.question}</div>

      {/* The read as chips — what the forecast says, where belief is trending, and which
          way the leveraged tape is leaning. Numbers live here; the chart carries shape. */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        <Chip label="YES" tone={lc}>
          <b style={{ color: BONE, fontWeight: 700 }}>{m.forecastProbPct}%</b>
          {prob ? <ProbSpark pct={prob.pct} color={lc} /> : null}
          {prob ? <span style={{ color: prob.changePt >= 0 ? POS : NEG }}>{prob.changePt >= 0 ? "+" : ""}{prob.changePt}pt<span style={{ color: FAINT }}> · 30d</span></span> : null}
        </Chip>
        <Chip label="LEAN" tone={lc}><b style={{ color: lc, fontWeight: 700 }}>{m.forecastLean ?? "—"}</b></Chip>
        <Chip label="TAPE"><b style={{ color: leanColor(m.fundingLean), fontWeight: 700 }}>{m.fundingLean ?? "—"}</b><span style={{ color: FAINT }}>funding</span></Chip>
        {m.target != null ? <Chip label="TARGET"><b style={{ color: BONE, fontWeight: 700 }}>{fmtPrice(m.target)}</b><span style={{ color: FOG }}>{m.distancePct != null ? `${m.distancePct > 0 ? "+" : ""}${m.distancePct}%` : ""}</span></Chip> : null}
      </div>

      <ForecastChart coin={m.coin} markPrice={m.markPrice} target={m.target} forecastLean={m.forecastLean} distancePct={m.distancePct} />
      {/* PROJECTION — the expected-move cone, a second independent forward lens next to the
          prediction-market forecast + the crypto tape. */}
      <div style={{ margin: "8px 0 0" }}>
        <ProjectionBand symbol={m.coin} height={196} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", fontFamily: "var(--nx-font-mono)", fontSize: 10, marginTop: 8 }}>
        <span style={{ color: FAINT }}>{fmtUsd(m.volumeUsd)} vol</span>
        <button type="button" onClick={() => onDraft(m)} className="nx-press"
          style={{ marginLeft: "auto", color: BONE, background: "transparent", border: `1px solid ${BORDER_STRONG}`, borderRadius: 2, padding: "3px 10px", fontFamily: "var(--nx-font-mono)", fontSize: 10, cursor: "pointer" }}
        >◆ draft thesis</button>
      </div>
    </div>
  );
}

// Divergent markets beyond the primary — a row, not another chart stack. Carries the
// same facts (lean vs tape, target, distance) and the same one-tap draft. Columns don't
// shrink (flexShrink:0) and the row wraps on a phone rather than clipping off the edge.
function DivergentRow({ m, onDraft }: { m: ForecastMarket; onDraft: (m: ForecastMarket) => void }) {
  const lc = leanColor(m.forecastLean);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontFamily: "var(--nx-font-mono)", fontSize: 10,
      border: `1px solid ${WARN}22`, borderRadius: 2, padding: "7px 10px", background: "rgba(251,191,36,0.03)",
    }}>
      <span style={{ color: WARN, fontSize: 9, flexShrink: 0 }}>◆</span>
      <span style={{ color: BONE, fontWeight: 700, flexShrink: 0, minWidth: 34 }}>{m.coin}</span>
      <span style={{ color: FAINT, flexShrink: 0 }}>{fmtPrice(m.markPrice)}</span>
      <span style={{ color: DIM, flexShrink: 0 }}>{m.forecastProbPct}% <b style={{ color: lc }}>{m.forecastLean}</b> vs tape <b style={{ color: leanColor(m.fundingLean) }}>{m.fundingLean}</b></span>
      {m.target != null ? <span style={{ color: FAINT, flexShrink: 0 }}>{fmtPrice(m.target)} target{m.distancePct != null ? ` (${m.distancePct > 0 ? "+" : ""}${m.distancePct}%)` : ""}</span> : null}
      <button type="button" onClick={() => onDraft(m)} className="nx-press"
        style={{ marginLeft: "auto", flexShrink: 0, color: FOG, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 2, padding: "2px 8px", fontFamily: "var(--nx-font-mono)", fontSize: 9.5, cursor: "pointer" }}
      >◆ draft</button>
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
  const divergent = tradable.filter((m) => m.divergence);
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
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {/* ONE primary chart. The top-ranked divergence gets the full card; every
                    other flagged market is a row carrying the same facts. A section that
                    stacked a three-chart card per market buried the read it exists to make. */}
                <DivergentCard key={divergent[0].id ?? divergent[0].question} m={divergent[0]} onDraft={draftFrom} />
                {divergent.slice(1).map((m) => (
                  <DivergentRow key={m.id ?? m.question} m={m} onDraft={draftFrom} />
                ))}
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
