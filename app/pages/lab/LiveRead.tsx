import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { fusePositioning } from "@/lib/positioning.mjs";
import { fetchDeribitTerm } from "@/lib/deribit.mjs";
import { Simulate } from "./Simulate";
import type { ProcessedTrade } from "./types";
import { C, SIGNAL } from "@/config/theme";

// ── THE READ — the pre-trade inputs panel ────────────────────────────────────
// The decision moment used to be intelligence-blind: the Thesis Engine showed funding cost and
// R:R but none of the Lab's reads. The instant you enter a symbol this pulls the SAME reads
// scattered across the Lab (positioning, the funding stretch, the graded-caller crowd, flow,
// liquidations, YOUR OWN record on this market) and lays them out where the decision happens,
// each with its own number and the side it points to.
//
// Inputs, not a verdict (2026-09-30). It used to count them ("3/4 independent reads align"),
// crown the count ("STRONG READ", "◆ ALIGNED SETUP") and tint the panel green. None of these
// reads is graded as an edge in the form shown here (the scoreboard grades its own rules on
// /proof), so a tally of them was a blended score with no grade behind it. Now: no tally, no
// conviction word, no green. Colour is left for caution (amber) and real danger (C.warn).
// It can warn. It can't endorse.

const AGENT_API = "https://og.nexustradinglabs.com";
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const BONE = "#ededf0", FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b";
const WATCH = SIGNAL.watch, BORDER = "#232327", INSET = C.surfaceAlt;

const bare = (s: string) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

type Fused = { coin: string; verdict: "CONFLUENCE" | "SPLIT" | "CROWD" | "SMART"; crowdFade: "LONG" | "SHORT" | null; smartSide: "LONG" | "SHORT" | null; fundingAnnualPct: number | null; smartTraders: number };
type Regime = { trend?: string; vol?: string; atrPct?: number };
type Warning = { text: string; severity?: string; kind?: string };
type Advice = { regime: Regime | null; alignment: string | null; warnings: Warning[]; plan: { flags?: string[] } | null; yourRecord: { trend?: { avgR: number; calls: number } | null; vol?: { avgR: number; calls: number } | null } | null } | null;
type Levels = { entryPrice: number; stopLoss: number; takeProfit1: number };

// ── MARKET BREADTH / BETA GATE — the tape a single-name read is posted INTO. A short on
// one alt can be right about the coin and wrong about the market: when the whole book's
// crowd is leaning the same way, systemic squeezes drag every name. We read the SAME
// mispriced board already fetched and tally how many markets the crowd is net-long vs
// net-short (funding sign per market). Broadly long funding = risk-on froth (a market-wide
// fade-SHORT backdrop); broadly negative = capitulation (a fade-LONG backdrop). Delivered
// as context: the backdrop, not a per-coin signal. Orthogonal to the single-coin funding fade
// and pure-client.
type Breadth = { crowdLong: number; crowdShort: number; total: number; lean: "LONG" | "SHORT" | null; sharePct: number };
type Momentum = { available: boolean; state: "BUILDING" | "UNWINDING" | "PEAKING" | "RESET" | "STABLE" | "FLAT"; windowHours: number; fundingChangePct: number; oiChangePct: number; headline: string };
function computeBreadth(markets: { fundingAnnualPct?: number }[]): Breadth | null {
  let crowdLong = 0, crowdShort = 0;
  for (const m of markets || []) {
    const f = Number(m.fundingAnnualPct);
    if (!Number.isFinite(f) || Math.abs(f) < 1) continue; // ignore near-flat funding (noise)
    if (f > 0) crowdLong++; else crowdShort++;            // +funding = crowd pays to be long
  }
  const total = crowdLong + crowdShort;
  if (total < 8) return null; // too few markets to call a backdrop
  const share = Math.max(crowdLong, crowdShort) / total;
  // ≥65% one-sided = a real broad tilt; the market-wide FADE lean is the contrarian side.
  const lean: "LONG" | "SHORT" | null = share >= 0.65 ? (crowdLong > crowdShort ? "SHORT" : "LONG") : null;
  return { crowdLong, crowdShort, total, lean, sharePct: Math.round(share * 100) };
}

type Magnet = { price: number; side: string; mag?: number };
type Magnets = { below: Magnet[]; above: Magnet[]; currentPrice: number };
type Beta = { available: boolean; beta: number; correlation: number; drivenPct: number; verdict: "BTC_DRIVEN" | "IDIOSYNCRATIC" | "MIXED" };

// ── LIQ-MAGNET PULL — the directional read from the liquidation heatmap. Long-liq
// clusters BELOW pull price down; short-liq clusters ABOVE pull it up. For your drafted
// direction one side is a TARGET (tailwind), the other a COUNTER (headwind). We score each
// magnet by strength ÷ distance (a near, heavy cluster pulls hardest) and compare the best
// tailwind to the best headwind. A clear tailwind = a natural target in your favor; a
// closer/heavier counter = price likely pulled against you first. Shown with the side it pulls.
function magnetPull(m: Magnets | null, direction: "LONG" | "SHORT"): { side: "LONG" | "SHORT"; targetPrice: number; distPct: number } | null {
  if (!m || !(m.currentPrice > 0)) return null;
  const px = m.currentPrice;
  const score = (mag: Magnet) => {
    const distPct = Math.abs(mag.price - px) / px * 100;
    if (!(distPct > 0.05)) return 0;
    return (Number(mag.mag) || 1) / distPct;
  };
  const best = (arr: Magnet[]) => arr.reduce((b, x) => (score(x) > score(b || x) ? x : (b || x)), null as Magnet | null);
  const tailArr = direction === "SHORT" ? m.below : m.above; // target side
  const headArr = direction === "SHORT" ? m.above : m.below; // counter side
  const tail = best(tailArr), head = best(headArr);
  const ts = tail ? score(tail) : 0, hs = head ? score(head) : 0;
  if (ts <= 0) return null;
  if (ts >= hs * 1.3 && tail) return { side: direction, targetPrice: tail.price, distPct: Math.round(Math.abs(tail.price - px) / px * 1000) / 10 };
  if (hs >= ts * 1.3 && head) return { side: direction === "SHORT" ? "LONG" : "SHORT", targetPrice: head.price, distPct: Math.round(Math.abs(head.price - px) / px * 1000) / 10 };
  return null; // no decisive gradient
}

const TREND_WORD: Record<string, string> = { TREND_UP: "uptrend", TREND_DOWN: "downtrend", CHOP: "chop" };
const VOL_WORD: Record<string, string> = { CALM: "calm", NORMAL: "normal vol", VOLATILE: "volatile" };

export function LiveRead({ symbol, direction, trades, levels, wallet, onWeakEdge, onBaseRate }: { symbol: string; direction: "LONG" | "SHORT"; trades?: ProcessedTrade[]; levels?: Levels; wallet?: string | null; onWeakEdge?: (w: { weak: boolean; histPct: number | null }) => void; onBaseRate?: (br: { revertedPct: number; samples: number; tier: string } | null) => void }) {
  const coin = bare(symbol);
  const [fused, setFused] = useState<Fused | null | undefined>(undefined); // undefined=loading, null=no read
  const [callers, setCallers] = useState<{ side: "LONG" | "SHORT"; participants: number } | null>(null);
  const [breadth, setBreadth] = useState<Breadth | null>(null);
  const [momentum, setMomentum] = useState<Momentum | null>(null);
  const [advice, setAdvice] = useState<Advice>(null);
  const [flush, setFlush] = useState<{ side: "UP" | "DOWN"; ratio: number } | null>(null);
  const [magnets, setMagnets] = useState<Magnets | null>(null);
  const [beta, setBeta] = useState<Beta | null>(null);

  // BTC beta — how much of this coin's move is just market beta (skip for BTC itself).
  useEffect(() => {
    if (!coin || coin === "BTC") { setBeta(null); return; }
    let off = false;
    fetch(`${AGENT_API}/intel/beta/${coin}`).then((r) => r.json())
      .then((d) => { if (!off) setBeta(d && d.available ? d : null); })
      .catch(() => { if (!off) setBeta(null); });
    return () => { off = true; };
  }, [coin]);

  // Pending liquidation magnets (estimated heatmap) — where leveraged positions will be
  // force-closed = where price tends to get pulled. Forward-looking; fail-soft. Cached.
  useEffect(() => {
    if (!coin) { setMagnets(null); return; }
    let off = false;
    fetch(`${AGENT_API}/intel/liqmap/${coin}`).then((r) => r.json())
      .then((d) => { if (!off) setMagnets(d && d.available ? { below: d.below || [], above: d.above || [], currentPrice: Number(d.currentPrice) || 0 } : null); })
      .catch(() => { if (!off) setMagnets(null); });
    return () => { off = true; };
  }, [coin]);
  const [basis, setBasis] = useState<{ side: "LONG" | "SHORT"; basisPct: number } | null>(null);
  const [ob, setOb] = useState<{ side: "LONG" | "SHORT"; imbalance: number } | null>(null);
  const [cvd, setCvd] = useState<{ side: "LONG" | "SHORT"; kind: string } | null>(null);
  const [rawBasis, setRawBasis] = useState<number | null>(null);
  const [term, setTerm] = useState<{ structure: string; ratio: number; frontIv: number; backIv: number } | null>(null);

  // Spot-perp basis + order-book imbalance + options skew (one fetch). Basis: perp premium
  // (>0) = froth → SHORT, discount → LONG. OB: bid-heavy = support → LONG, ask-heavy → SHORT.
  // Skew (BTC/ETH/SOL): more put-fear than usual = capitulation → LONG, more call-greed → SHORT.
  useEffect(() => {
    if (!coin) { setBasis(null); setOb(null); setCvd(null); setRawBasis(null); return; }
    let off = false;
    const sideOf = (s: { side?: string } | null | undefined) => (s && (s.side === "LONG" || s.side === "SHORT") ? s : null);
    fetch(`${AGENT_API}/intel/flow/${coin}`).then((r) => r.json())
      .then((d) => { if (off) return; setBasis((sideOf(d?.basisSignal) as typeof basis) ?? null); setOb((sideOf(d?.obSignal) as typeof ob) ?? null); setCvd((sideOf(d?.cvdSignal) as typeof cvd) ?? null); setRawBasis(typeof d?.basis?.basisPct === "number" ? d.basis.basisPct : null); })
      .catch(() => { if (!off) { setBasis(null); setOb(null); setCvd(null); setRawBasis(null); } });
    return () => { off = true; };
  }, [coin]);

  // Vol regime (DVOL term structure) — fetched CLIENT-SIDE: Deribit hard-blocks the worker's
  // datacenter IP but works from the browser (same as our GeckoTerminal fetch). BTC/ETH/SOL.
  useEffect(() => {
    if (!coin) { setTerm(null); return; }
    let off = false;
    fetchDeribitTerm(coin).then((t) => { if (!off) setTerm(t && t.structure ? t : null); }).catch(() => { if (!off) setTerm(null); });
    return () => { off = true; };
  }, [coin]);

  // Live liquidation flush (OKX feed) — a cascade of forced closes. DOWN = longs
  // capitulating (confirms a SHORT fade); UP = shorts squeezed (confirms a LONG).
  // Activates once ~12h of liq:hist has accrued; fail-soft/hidden until then.
  useEffect(() => {
    if (!coin) { setFlush(null); return; }
    let off = false;
    fetch(`${AGENT_API}/intel/liquidations/${coin}`).then((r) => r.json())
      .then((d) => { if (!off) setFlush(d && d.flush && (d.flush.side === "UP" || d.flush.side === "DOWN") ? d.flush : null); })
      .catch(() => { if (!off) setFlush(null); });
    return () => { off = true; };
  }, [coin]);

  // ── THE ONE HIST CLOCK (Grok) — the reversion / edgeQuality the GAPS card, ticket-verdict,
  // scanner AND this Quick Call all cite. /intel/positioning now returns the SAME object the
  // mispriced board computes (byte-identical fast-path, else its method), so every surface shows
  // ONE number — no more "SOL 80% on the card, 63% on Quick Call, 25% on the backtest." The
  // separate /intel/baserate backtest is NO LONGER cited on the live glass (kept only to FREEZE
  // the odds a published call was taken against — a past-tense record, not live conviction).
  const [reversion, setReversion] = useState<{ revertedPct: number; samples: number; tier: string } | null>(null);
  useEffect(() => {
    if (!coin) { setReversion(null); return; }
    let off = false;
    fetch(`${AGENT_API}/intel/positioning/${coin}`).then((r) => r.json())
      .then((d) => { if (!off) setReversion(d && d.reversion && d.reversion.samples ? { revertedPct: d.reversion.revertedPct, samples: d.reversion.samples, tier: (d.edgeQuality && d.edgeQuality.tier) || "" } : null); })
      .catch(() => { if (!off) setReversion(null); });
    return () => { off = true; };
  }, [coin]);

  // SETUP MOMENTUM (persistence / decay) — the one time-derivative: is the funding-fade
  // still building (early) or unwinding (late)? Server computes it from the recorded oi:hist.
  useEffect(() => {
    if (!coin) { setMomentum(null); return; }
    let off = false;
    fetch(`${AGENT_API}/intel/persistence/${coin}`).then((r) => r.json())
      .then((d) => { if (!off) setMomentum(d && d.available ? d : null); })
      .catch(() => { if (!off) setMomentum(null); });
    return () => { off = true; };
  }, [coin]);

  // Once the LEVELS are set, run the SAME grading the call will get later (/theses/advice):
  // the market regime, any plan defects (late entry, stop in noise, R:R mismatch…), and your
  // record IN that regime. The warnings match how it will actually be judged.
  const lv = levels && levels.entryPrice > 0 && levels.stopLoss > 0 && levels.takeProfit1 > 0 ? levels : null;
  useEffect(() => {
    if (!coin || !lv) { setAdvice(null); return; }
    let off = false;
    fetch(`${AGENT_API}/theses/advice`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wallet: wallet || undefined, symbol: coin, direction, entryPrice: lv.entryPrice, stopLoss: lv.stopLoss, takeProfit1: lv.takeProfit1 }),
    }).then((r) => r.json()).then((d) => { if (!off) setAdvice(d && !d.error ? d : null); }).catch(() => { if (!off) setAdvice(null); });
    return () => { off = true; };
  }, [coin, direction, lv?.entryPrice, lv?.stopLoss, lv?.takeProfit1, wallet]);

  useEffect(() => {
    if (!coin) { setFused(undefined); setCallers(null); return; }
    let off = false; setFused(undefined); setCallers(null);
    Promise.all([
      fetch(`${AGENT_API}/intel/mispriced`).then((r) => r.json()).catch(() => null),
      fetch(`${AGENT_API}/smart/board`).then((r) => r.json()).catch(() => null),
      fetch(`${AGENT_API}/theses/consensus`).then((r) => r.json()).catch(() => null),
    ]).then(([mp, sb, cons]) => {
      if (off) return;
      const rows = fusePositioning(mp?.markets ?? [], sb?.traders ?? []) as Fused[];
      setFused(rows.find((r) => r.coin === coin) ?? null);
      const l = cons?.consensus?.[coin];
      setCallers(l && (l.side === "LONG" || l.side === "SHORT") ? { side: l.side, participants: Number(l.participants) || 0 } : null);
      setBreadth(computeBreadth(mp?.markets ?? []));
    }).catch(() => { if (!off) setFused(null); });
    return () => { off = true; };
  }, [coin]);

  // Your realized record on THIS market (edge-aware, at the decision).
  const record = useMemo(() => {
    const ts = (trades || []).filter((t) => bare(t.symbol) === coin);
    if (!ts.length) return null;
    const wins = ts.filter((t) => t.pnl > 0).length;
    const net = ts.reduce((s, t) => s + t.pnl, 0);
    const sideTs = ts.filter((t) => (t.direction || t.side) === direction);
    const sideWins = sideTs.filter((t) => t.pnl > 0).length;
    return {
      n: ts.length, wr: Math.round((wins / ts.length) * 100), net: Math.round(net),
      side: sideTs.length >= 2 ? { n: sideTs.length, wr: Math.round((sideWins / sideTs.length) * 100), net: Math.round(sideTs.reduce((s, t) => s + t.pnl, 0)) } : null,
    };
  }, [trades, coin, direction]);

  // Hooks MUST run before the `!coin` early return — a hook after a conditional return changes the
  // hook count when the coin changes (React throws). Both depend only on `reversion` (state).
  const revPct = reversion ? reversion.revertedPct : null;
  const revWeak = reversion ? (reversion.tier === "TRAP" || (revPct != null && revPct <= 42)) : false;
  // The WATCH/arming gate is the reversion clock (one clock ticket↔read↔thesis, no fork).
  useEffect(() => { onWeakEdge?.({ weak: revWeak, histPct: revPct }); }, [revWeak, revPct, onWeakEdge]);
  // FREEZE the odds at the click from the ONE reversion clock the ticket shows (Grok's ruling):
  // a new publish stamps {revertedPct, samples, tier} onto the card, labeled "taken vs" — the same
  // book as the live HIST line, just past tense. Old cards stay frozen on their backtest number.
  useEffect(() => { onBaseRate?.(reversion ? { revertedPct: reversion.revertedPct, samples: reversion.samples, tier: reversion.tier } : null); }, [reversion, onBaseRate]);

  if (!coin) return null;

  // The side the positioning board favours (the fade side, or smart money's when that is the
  // stronger read). Shown as the positioning input's side and nothing more.
  const boardLean: "LONG" | "SHORT" | null = fused
    ? (fused.verdict === "SMART" ? fused.smartSide : fused.crowdFade)
    : null;

  // ── THE INPUTS — every read on this market with its own number and the side it points to.
  // No vote, no count, no colour: the thresholds here aren't the scoreboard's graded rules, so
  // none of these is presented as an edge, and adding them up would be a score with no grade
  // behind it. Your own record carries no side: it's your past, not the market's lean.
  // The reversion clock (HIST, below) is the ONE history book for the fade; the /intel/baserate
  // backtest is not shown here.
  const reads: { label: string; val: string; side: "LONG" | "SHORT" | null }[] = [];
  if (fused?.crowdFade) reads.push({ label: "funding fade", val: fused.fundingAnnualPct != null ? `${fused.fundingAnnualPct > 0 ? "+" : ""}${fused.fundingAnnualPct}%/yr` : "stretched", side: fused.crowdFade });
  if (fused?.smartSide) reads.push({ label: "smart money", val: `${fused.smartTraders} sharp`, side: fused.smartSide });
  if (fused && (fused.verdict === "CONFLUENCE" || fused.verdict === "SPLIT")) reads.push({ label: "positioning", val: fused.verdict === "CONFLUENCE" ? "fade + smart agree" : "fade vs smart", side: fused.verdict === "CONFLUENCE" ? boardLean : null });
  if (callers) reads.push({ label: "graded callers", val: `${callers.participants} calling`, side: callers.side });
  if (flush) reads.push({ label: "liq flush", val: `${flush.ratio}× ${flush.side === "DOWN" ? "longs out" : "shorts out"}`, side: flush.side === "DOWN" ? "SHORT" : "LONG" });
  if (basis) reads.push({ label: "spot-perp basis", val: `${basis.basisPct > 0 ? "+" : ""}${basis.basisPct}% ${basis.basisPct > 0 ? "premium" : "discount"}`, side: basis.side });
  // funding × basis divergence is derived from the two reads above, not a separate source.
  if (fused?.crowdFade && fused.fundingAnnualPct != null && rawBasis != null && Math.abs(fused.fundingAnnualPct) >= 10) {
    const crowdLong = fused.fundingAnnualPct > 0;
    if (crowdLong !== rawBasis > 0) reads.push({ label: "funding×basis", val: "premium fading", side: crowdLong ? "LONG" : "SHORT" });
  }
  if (cvd) reads.push({ label: "CVD flow", val: cvd.kind === "distribution" ? "sold into" : "bought up", side: cvd.side });
  const pull = magnetPull(magnets, direction);
  if (pull) reads.push({ label: "liq pull", val: `${pull.distPct}% away`, side: pull.side });
  if (ob) reads.push({ label: "order book", val: `${ob.imbalance > 0 ? "bid" : "ask"}-heavy`, side: ob.side });
  if (record?.side) reads.push({ label: `your ${direction.toLowerCase()}s · ${coin}`, val: `${record.side.net >= 0 ? "+" : "−"}$${Math.abs(record.side.net)} · ${record.side.n}t · ${record.side.wr}%`, side: null });
  else if (record) reads.push({ label: `your ${coin}`, val: `${record.net >= 0 ? "+" : "−"}$${Math.abs(record.net)} · ${record.n}t`, side: null });
  const marketReads = reads.filter((r) => r.side);

  const loading = fused === undefined;
  const nothing = fused === null && !callers && !record && !advice && !reversion && !flush && !basis && !ob && !magnets && !term;

  // What the pressure-test sim is told: the direction and the market inputs as they stand.
  // No verdict, and never your own P&L.
  const simNotes = [
    `${direction} ${coin}.`,
    marketReads.length ? `Inputs: ${marketReads.map((r) => `${r.label} ${r.val} (${r.side})`).join("; ")}.` : "",
    term ? `Options curve: ${term.structure}.` : "",
  ].filter(Boolean).join(" ");

  return (
    <div style={{ border: `1px solid ${BORDER}`, borderLeft: `2px solid ${FAINT}`, background: C.surfaceAlt, borderRadius: 8, padding: "12px 14px", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 6, height: 6, borderRadius: "50%", background: FAINT }} />
        <span style={{ fontFamily: MONO, fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", color: BONE }}>THE READ · {coin}</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: 8.5, color: FAINT }}>live · inputs, not a verdict</span>
      </div>

      {loading ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: FAINT }}>Reading {coin}…</div>
      ) : nothing ? (
        <div style={{ fontFamily: MONO, fontSize: 10.5, color: MUTED, lineHeight: 1.5 }}>No inputs on {coin} right now. No funding stretch, no smart-money position, no record here yet.</div>
      ) : (
        <>
          {/* THE INPUTS — one grid, every read with its number and the side it points to, all in
              the same ink. Your direction is stated once; the comparing is yours to do. */}
          {reads.length > 0 && (
            <>
              <div style={{ fontFamily: UI, fontSize: 12, color: FOG, lineHeight: 1.5, marginBottom: 8 }}>
                Drafting {direction}. {reads.length} {reads.length === 1 ? "input" : "inputs"}. → is the side an input points to.
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 6, marginBottom: 10 }}>
                {reads.map((r) => (
                  <div key={r.label} style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0, border: `1px solid ${BORDER}`, borderRadius: 5, padding: "6px 9px", background: INSET }}>
                    <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.1em", color: MUTED, textTransform: "uppercase" }}>{r.label}</span>
                    <span style={{ fontFamily: MONO, fontSize: 10.5, fontWeight: 700, color: BONE, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.val}</span>
                    {r.side && <span style={{ fontFamily: MONO, fontSize: 9, color: FOG }}>→ {r.side}</span>}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* SETUP MOMENTUM — persistence/decay: the ONLY time-derivative read. Is the crowded
              funding-fade still building (early) or already unwinding (late)? From oi:hist. */}
          {momentum && momentum.state !== "FLAT" && (() => {
            const s = momentum.state;
            const tag = s === "BUILDING" ? "▲ BUILDING" : s === "UNWINDING" ? "▼ UNWINDING" : s === "PEAKING" ? "◆ PEAKING" : s === "RESET" ? "↻ RESET" : "= STABLE";
            return (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={{ fontFamily: MONO, fontSize: 8.5, fontWeight: 700, letterSpacing: "0.08em", color: FOG, border: `1px solid ${BORDER}`, borderRadius: 3, padding: "1px 6px", flexShrink: 0 }}>{tag}</span>
                <span style={{ fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5, flex: 1, minWidth: 180 }}>
                  <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>SETUP MOMENTUM · </span>
                  {momentum.headline}
                  <span style={{ color: FAINT }}> {momentum.fundingChangePct >= 0 ? "+" : ""}{momentum.fundingChangePct}% funding / {momentum.oiChangePct >= 0 ? "+" : ""}{momentum.oiChangePct}% OI over {momentum.windowHours}h.</span>
                </span>
              </div>
            );
          })()}

          {/* HIST — the ONE reversion clock (the SAME series the card / ticket / scanner cite):
              how often fading this stretch has reverted here. A rate, so it's plain ink; amber only
              when it has bled (a caution, and the same test that arms WATCH). No "real edge" copy:
              the scoreboard grades the fade on /proof, this is one market's past. */}
          {reversion && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>HIST · </span>
              {revPct != null
                ? <>fading {coin} here has reverted <b style={{ color: revWeak ? WATCH : BONE }}>{revPct}%</b> of the last {reversion.samples} stretched-funding instances.{" "}
                    <span style={{ color: MUTED }}>{revWeak ? "This setup has bled here. Lean on your own thesis, not the fade." : "Past stretches on this market, not a forecast."}</span></>
                : <span style={{ color: MUTED }}>no reversion history for {coin} yet.</span>}
            </div>
          )}

          {/* LIQ MAGNETS — estimated pending liquidation clusters (heatmap-lite): where
              leveraged positions get force-closed = where price tends to get pulled. */}
          {magnets && (magnets.below.length > 0 || magnets.above.length > 0) && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>LIQ MAGNETS · </span>
              {magnets.below[0] && <>downside pull <b style={{ color: BONE }}>${magnets.below[0].price >= 1000 ? magnets.below[0].price.toLocaleString() : magnets.below[0].price}</b> <span style={{ color: FAINT }}>(long liqs)</span></>}
              {magnets.below[0] && magnets.above[0] ? " · " : ""}
              {magnets.above[0] && <>upside pull <b style={{ color: BONE }}>${magnets.above[0].price >= 1000 ? magnets.above[0].price.toLocaleString() : magnets.above[0].price}</b> <span style={{ color: FAINT }}>(short liqs)</span></>}
              <span style={{ color: MUTED }}>. Estimated, where cascades sit.</span>
            </div>
          )}

          {/* VOL REGIME — DVOL term structure (BTC/ETH/SOL). Stated as a fact about the options
              curve; which regime fades "work best in" is a claim no grade here backs. */}
          {term && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>VOL REGIME · </span>
              options are in <b style={{ color: BONE }}>{term.structure}</b> ({term.frontIv}v front / {term.backIv}v back).{" "}
              <span style={{ color: MUTED }}>{term.structure === "backwardation" ? "Front vol above back: near-term stress." : term.structure === "contango" ? "Back vol above front: a calm curve." : "A flat curve."}</span>
            </div>
          )}

          {/* MARKET BACKDROP — breadth/beta gate: the tape this single-name read is posted
              into. Broad one-sided funding = a market-wide fade lean that drags every name. */}
          {breadth && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>MARKET BACKDROP · </span>
              {breadth.crowdLong >= breadth.crowdShort ? breadth.crowdLong : breadth.crowdShort} of {breadth.total} markets have crowds leaning <b style={{ color: BONE }}>{breadth.crowdLong >= breadth.crowdShort ? "long" : "short"}</b>
              {breadth.lean
                ? <>. <b style={{ color: BONE }}>{breadth.lean === "SHORT" ? "Risk-on froth" : "Broad capitulation"}</b>, a market-wide fade-{breadth.lean.toLowerCase()} backdrop. <span style={{ color: MUTED }}>Your {direction.toLowerCase()} runs {breadth.lean === direction ? "with" : "against"} it.</span></>
                : <span style={{ color: MUTED }}>. Mixed, no broad tilt.</span>}
            </div>
          )}

          {/* BTC BETA — is this move the coin's own, or just market beta? Modulates how much
              the single-name reads mean; never votes a side. Skipped for BTC itself. */}
          {beta && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 11.5, color: FOG, lineHeight: 1.5 }}>
              <span style={{ fontFamily: MONO, fontSize: 8.5, letterSpacing: "0.1em", color: MUTED }}>BTC BETA · </span>
              {coin}’s move is <b style={{ color: BONE }}>{beta.drivenPct}% BTC-driven</b> (β {beta.beta}).{" "}
              <span style={{ color: MUTED }}>{beta.verdict === "BTC_DRIVEN"
                ? `A ${direction.toLowerCase()} here is largely a BTC bet. Check BTC first.`
                : beta.verdict === "IDIOSYNCRATIC"
                ? "Moving on its own, not with BTC."
                : "Part market beta, part its own move."}</span>
            </div>
          )}

          {/* GRADING PREVIEW — once levels are set, the SAME grading the call will get:
              regime it's posted into, your record there, and any plan defect. */}
          {advice && (advice.regime || (advice.warnings && advice.warnings.length > 0)) && (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}` }}>
              <div style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.12em", color: MUTED, marginBottom: 6 }}>GRADING PREVIEW · how this call will be judged</div>
              {advice.regime && (
                <div style={{ fontFamily: UI, fontSize: 12, color: FOG, lineHeight: 1.5 }}>
                  {(() => { const w = TREND_WORD[advice.regime.trend || ""] || (advice.regime.trend || "").toLowerCase(); return `${coin} is in ${/^[aeiou]/.test(w) ? "an" : "a"} ${w}`; })()} · {VOL_WORD[advice.regime.vol || ""] || (advice.regime.vol || "").toLowerCase()} tape
                  {advice.alignment === "AGAINST_TREND" ? <span>. Against the trend</span> : advice.alignment === "WITH_TREND" ? <span>. With the trend</span> : null}
                  {advice.yourRecord?.trend && advice.regime.trend ? <span style={{ color: FAINT }}> · your {TREND_WORD[advice.regime.trend] || ""} record {advice.yourRecord.trend.avgR >= 0 ? "+" : ""}{advice.yourRecord.trend.avgR}R/{advice.yourRecord.trend.calls}</span> : null}
                </div>
              )}
              {advice.warnings && advice.warnings.length > 0 ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 7 }}>
                  {advice.warnings.slice(0, 3).map((w, i) => (
                    <div key={i} style={{ fontFamily: UI, fontSize: 11.5, color: w.severity === "high" ? C.warn : WATCH, lineHeight: 1.45, display: "flex", gap: 6 }}><span>⚠</span><span>{w.text}</span></div>
                  ))}
                </div>
              ) : (
                <div style={{ fontFamily: MONO, fontSize: 10.5, color: FOG, marginTop: 7 }}>No plan defects found. It counts once price trades at your entry, then first touch of target vs stop.</div>
              )}
            </div>
          )}

          {/* PRESSURE-TEST — run the Miroshark sim on this exact trade: 25 agents react over
              10 rounds, surfacing the bull/bear case + where consensus lands. The decision-
              moment stress test, right in the read. */}
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: `1px solid ${BORDER}`, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <Simulate
                label="◆ Pressure-test this trade →"
                wallet={wallet}
                body={{ kind: "thesis", coin, direction, notes: simNotes }}
              />
            </div>
            {marketReads.length >= 2 && (() => {
              // Share the read: the market inputs as they stand, fact first, no verdict and never
              // your own P&L (the record input has no side, so it can't reach this text).
              const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
              const lines = marketReads.slice(0, 4).map((r) => `${cap(r.label)}: ${r.val}, ${r.side}.`);
              const text = [`The read on ${coin}.`, "", ...lines, "", "Inputs, not a verdict. Not advice."].join("\n");
              const xUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent("https://trade.nexustradinglabs.com/lab")}`;
              return (
                <a href={xUrl} target="_blank" rel="noopener noreferrer" title="Share this read on X" className="nx-press"
                  style={{ flexShrink: 0, fontFamily: "var(--nx-font-ui)", fontSize: 12, color: FOG, background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 3, padding: "5px 11px", textDecoration: "none", whiteSpace: "nowrap" }}>𝕏 Share the read</a>
              );
            })()}
          </div>

          <div style={{ fontFamily: MONO, fontSize: 8, color: FAINT, marginTop: 8, lineHeight: 1.5 }}>
            Inputs, not a verdict. None is graded as an edge in this form. Graded reads live on{" "}
            <Link to="/proof" style={{ fontFamily: UI, color: FOG }}>Proof</Link>.
          </div>
        </>
      )}
    </div>
  );
}

export default LiveRead;
