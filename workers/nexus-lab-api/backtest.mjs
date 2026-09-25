// ── Strategy backtest engine (canonical) ─────────────────────────────────────
// Replays a config over historical candles using the REAL deployed logic —
// deriveSignal (brain) for entries, evaluateExit (exec) for exits — so a backtest
// reflects how the live agent would actually behave. Imported by lab-api (the
// "Test my strategy" endpoint) AND the dev runner in tools/backtest, so there is
// ONE engine and it can't drift from production.
//
// Data reality (Orderly): price OHLC + funding-rate history exist; there is NO OI-history
// ENDPOINT. So the OI series is fed from the brain's own recorded oi:hist:{symbol} (via
// makeOiChangeAt / oiHistBySymbol) once it has matured past the coverage gate — which is
// what makes CONFLUENCE / OI_ONLY testable. Until a bar has a recorded OI delta, oiChange
// is null → CONFLUENCE / OI_ONLY simply don't fire there (no fabricated divergence).
// MOMENTUM / MEAN_REVERSION / FUNDING_ONLY + the full exit toolkit are always backtestable.
import { deriveSignal } from "../nexus-agent-brain/logic.mjs";
import { computePnl, evaluateExit, breakevenArmed, volScaledLevels, dailyCapBlocked, shouldResetDaily } from "../nexus-agent-exec/logic.mjs";
import { percentileRank } from "./logic.mjs";
import { basisFadeFromHistory } from "../../app/lib/basisFade.mjs";
import { basisCvdConfirm, basisSmartConfirm, basisLiqConfirm } from "../../app/lib/basisStack.mjs";

// Rolling ATR% at candle index i, from the `periods` candles BEFORE i (no lookahead).
// Mirrors the exec's live fetchAtrPct (ATR as a % of price) so a vol-scaled-stops
// backtest matches how the agent actually sets its stop at entry. Returns null when
// there isn't enough history yet → caller falls back to the fixed config stop.
export function atrPctAt(candles, i, periods = 14) {
  const start = Math.max(1, i - periods);
  if (i - start < 3) return null;
  let trSum = 0, cnt = 0;
  for (let k = start; k < i; k++) {
    const tr = Math.max(candles[k].h - candles[k].l, Math.abs(candles[k].h - candles[k - 1].c), Math.abs(candles[k].l - candles[k - 1].c));
    if (Number.isFinite(tr)) { trSum += tr; cnt++; }
  }
  const lastClose = candles[i - 1].c;
  return cnt && lastClose > 0 ? (trSum / cnt / lastClose) * 100 : null;
}

// Build a NO-LOOKAHEAD funding-percentile lookup from raw funding rows
// ([{ts(ms), rate}]). At candle time t it ranks the current rate against only the
// funding history that existed at/before t — so a backtest can test the adaptive
// funding-percentile filter honestly (no peeking at the future).
export function makeFundingPctAt(rows) {
  const sorted = [...(rows || [])].sort((a, b) => a.ts - b.ts);
  return (tsSec, rate) => {
    const cutoff = tsSec * 1000;
    const past = [];
    for (const r of sorted) { if (r.ts <= cutoff) past.push(r.rate); else break; }
    return percentileRank(past, rate);
  };
}

// Build a NO-LOOKAHEAD OI-change lookup from the brain's recorded oi:hist series
// ([{ t(ms), price, oi, funding }], hourly). At candle time t it returns the
// FRACTIONAL OI change (decimal, e.g. 0.02 = +2%) from the previous recorded
// sample to the sample at/before t — the hourly OI delta, matching the hourly
// priceChange the engine already uses (both over the same bar). Returns null when
// fewer than two samples exist at/before t (→ engine treats OI as absent, so
// CONFLUENCE/OI_ONLY simply don't fire there — honest, no fabricated divergence).
// This is what unlocks CONFLUENCE/OI_ONLY backtests once oi:hist has matured.
export function makeOiChangeAt(rows) {
  const sorted = [...(rows || [])].filter((r) => Number.isFinite(r?.oi) && r.oi > 0).sort((a, b) => a.t - b.t);
  return (tsSec) => {
    const cutoff = tsSec * 1000;
    let prev = null, cur = null;
    for (const r of sorted) {
      if (r.t <= cutoff) { prev = cur; cur = r; } else break;
    }
    if (!cur || !prev || !(prev.oi > 0)) return null;
    return (cur.oi - prev.oi) / prev.oi;
  };
}

// Coverage summary of an oi:hist series — how many samples and how many days it
// spans. The backtest maturity-gate uses this to decide whether CONFLUENCE/OI_ONLY
// are testable yet (they need enough recorded OI history; funding+price come from
// Orderly and are always rich).
export function oiSeriesInfo(rows) {
  const s = (rows || []).filter((r) => Number.isFinite(r?.oi) && r.oi > 0).sort((a, b) => a.t - b.t);
  if (s.length < 2) return { samples: s.length, days: 0 };
  return { samples: s.length, days: Math.round((s[s.length - 1].t - s[0].t) / 86400000) };
}

// ── BASIS replay: the basis stack, evaluated exactly as the live brain would ──────
// Recorded series (lab-api's hourly flow crons + the brain's oi:hist): basisHist
// [{t, basisPct}], cvdHist [{t, cvd, buy, sell}], smHist [{t, side}], oiHist [{t, price}].
// At time `nowMs` the brain can only see rows ALREADY WRITTEN (t <= nowMs) — so each lookup
// filters every series to that prefix before calling the SAME shared functions the brain
// calls (basisFadeFromHistory → basisCvdConfirm / basisSmartConfirm). No row from after the
// decision can reach it: no lookahead, and no second implementation to drift.
// Returns the raw fields deriveSignal reads (basisSide/basisReason + the confirm fields).
function prefixByTime(rows) {
  const sorted = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  return (nowMs) => {
    let lo = 0, hi = sorted.length; // first index with t > nowMs
    while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid].t <= nowMs) lo = mid + 1; else hi = mid; }
    return sorted.slice(0, lo);
  };
}
export function makeBasisAt({ basisHist, cvdHist, smHist, oiHist, liqHist } = {}, { needCvd = false, needSmart = false, needLiq = false } = {}) {
  const basisUpTo = prefixByTime(basisHist);
  const cvdUpTo = needCvd ? prefixByTime(cvdHist) : null;
  const oiUpTo = needCvd ? prefixByTime(oiHist) : null;
  const smUpTo = needSmart ? prefixByTime(smHist) : null;
  const liqUpTo = needLiq ? prefixByTime(liqHist) : null;
  // Memoized per bar: the verdict at a given close doesn't depend on exits/sizing, so a
  // sweep or walk-forward reusing this lookup computes each bar once, not once per config.
  const memo = new Map();
  return (nowMs) => {
    if (memo.has(nowMs)) return memo.get(nowMs);
    const b = basisFadeFromHistory(basisUpTo(nowMs), { now: nowMs });
    const out = { basisSide: b.side, basisPct: b.basisPct, basisThr: b.thr, basisReason: b.reason };
    if (b.side && cvdUpTo) {
      const c = basisCvdConfirm({ basisT: b.t, side: b.side, cvdHist: cvdUpTo(nowMs), oiHist: oiUpTo(nowMs) });
      Object.assign(out, { basisCvdConfirmed: c.confirmed, basisCvdSide: c.cvdSide, basisCvdReason: c.reason });
    }
    if (b.side && smUpTo) {
      const m = basisSmartConfirm({ basisT: b.t, side: b.side, smHist: smUpTo(nowMs) });
      Object.assign(out, { basisSmartConfirmed: m.confirmed, basisSmartSide: m.smartSide, basisSmartReason: m.reason });
    }
    if (b.side && liqUpTo) {
      const l = basisLiqConfirm({ basisT: b.t, side: b.side, liqHist: liqUpTo(nowMs) });
      Object.assign(out, { basisLiqConfirmed: l.confirmed, basisLiqSide: l.liqSide, basisLiqReason: l.reason });
    }
    memo.set(nowMs, out);
    return out;
  };
}

// Coverage of a recorded hourly series ([{t,…}]) — samples + days spanned.
export function histSeriesInfo(rows) {
  const s = (Array.isArray(rows) ? rows : []).filter((r) => r && Number.isFinite(r.t)).sort((a, b) => a.t - b.t);
  if (s.length < 2) return { samples: s.length, days: 0, firstT: s[0]?.t ?? null };
  return { samples: s.length, days: Math.round((s[s.length - 1].t - s[0].t) / 86400000), firstT: s[0].t };
}

// Build the per-symbol basis lookup a BASIS_FADE config needs (null for any other mode).
export function basisAtForConfig(config, flow) {
  if (config?.signalMode !== "BASIS_FADE" || !flow) return null;
  return makeBasisAt(flow, { needCvd: config.basisConfirm === "CVD", needSmart: config.basisConfirm === "SMART", needLiq: config.basisConfirm === "LIQ" });
}

// ── The exit path, ONE implementation ─────────────────────────────────────────
// A held position walked bar by bar through the exec's own evaluateExit. Exported so the
// scoreboard's exit-matched grade (axisbt gradeEventExit) replays a preset's TP/SL/timeout
// with the SAME code the backtest uses — so a graded read and a backtested preset can't
// disagree about how a trade ends.
// Vol-scaled stops (opt-in) override the single tp/sl per-position; an explicit
// takeProfits ladder still takes over TP — exactly matching the live exec, which
// vol-scales the SL + single-TP fallback but passes config.takeProfits through.
export function openPosition(config, direction, price, t, lvl = null) {
  return {
    direction, entry: price, entryT: t, remaining: 1, realized: 0,
    state: {
      tpPercent: lvl ? lvl.tpPercent : config.tpPercent,
      slPercent: lvl ? lvl.slPercent : config.slPercent,
      takeProfits: config.takeProfits, tp_hits: [], peak_pnl_pct: 0,
    },
  };
}
// Realized % of a position closed at `exitPrice` (scale-out slices included).
export function closedPnlPct(pos, exitPrice) {
  const { pnlPct } = computePnl(pos.direction, pos.entry, exitPrice, 1);
  return pos.realized + pnlPct * pos.remaining;
}
// One bar of exit management. Intrabar order is conservative: the ADVERSE extreme first,
// then the favourable one, then the close (so a bar that touches both stop and target
// stops out). Mutates pos (trail / scale-out state); returns { px, reason } when the
// position is fully closed on this bar, else null.
export function stepExit(pos, c, holdMs, config) {
  const adv = pos.direction === "LONG" ? c.l : c.h;
  const fav = pos.direction === "LONG" ? c.h : c.l;
  for (const px of [adv, fav, c.c]) {
    const { pnlPct } = computePnl(pos.direction, pos.entry, px, 1);
    pos.state.be_armed = breakevenArmed(pos.state, pnlPct, config.breakevenTriggerPct);
    const action = evaluateExit(pos.state, pnlPct, holdMs, config);
    if (!action) continue;
    if (action.type === "TRAIL_UPDATE") {
      pos.state.peak_pnl_pct = action.peak; pos.state.trail_stop = action.trailStop;
    } else if (action.type === "PARTIAL_TP") {
      pos.realized += pnlPct * (action.sizePct / 100);
      pos.remaining -= action.sizePct / 100;
      pos.state.tp_hits = [...pos.state.tp_hits, action.level];
      if (pos.remaining <= 1e-9) return { px, reason: "TP" };
    } else if (action.type === "FULL_CLOSE") {
      return { px, reason: action.reason };
    }
  }
  return null;
}

// ── The entry decision at bar i, ONE implementation ────────────────────────────
// What the brain would have decided when bar i closed: the raw inputs (price/OI/funding deltas,
// session hour, ATR, basis stack) → deriveSignal → optional research entryFilter → vol-scaled
// levels. Shared by runBacktest (one market) and runPortfolioBacktest (the agent's whole
// watchlist), so the two replays cannot disagree about WHEN a signal fires — only about which
// signals the agent is free to take. Returns { direction, confidence, lvl } or null.
export function entryAt(candles, i, { fundingAt, fundingPctAt = null, oiChangeAt = null, entryFilter = null, basisAt = null }, config) {
  const c = candles[i], prev = candles[i - 1];
  if (!c || !prev) return null;
  const priceChange = (c.c - prev.c) / prev.c;
  // OI change from the recorded series when available (null → 0, so the OI
  // rule / CONFLUENCE stays inert exactly where we have no history).
  const oiChange = oiChangeAt ? (oiChangeAt(c.t) ?? 0) : 0;
  const raw = { priceChange, oiChange, fundingRate: fundingAt(c.t) || 0, hasPrev: true };
  if (fundingPctAt && (config.fundingPercentileMin || 0) > 0) raw.fundingPct = fundingPctAt(c.t, raw.fundingRate);
  // Regime-conditioning inputs (opt-in gates in deriveSignal read these) — computed
  // with NO lookahead so sim matches the live brain: session from the bar's UTC hour,
  // ATR% from bars strictly before i.
  raw.hourUtc = new Date(c.t * 1000).getUTCHours();
  const atr = atrPctAt(candles, i);
  if (Number.isFinite(atr)) raw.atrPct = atr;
  // Basis stack: what the brain would have seen when this bar closed (the entry fills
  // at c.c). Candles are hourly; the close is the next bar's open (or +1h on the last).
  if (basisAt) Object.assign(raw, basisAt(((candles[i + 1]?.t) ?? (c.t + 3600)) * 1000));
  const sig = deriveSignal(raw, config);
  if (!sig.direction || sig.direction === "NONE" || (sig.confidence ?? 0) < 50) return null;
  if (entryFilter && !entryFilter(candles, i, sig, config)) return null;
  // Vol-scaled stops: size the stop to recent ATR at entry (no lookahead),
  // preserving the configured reward:risk. Falls back to fixed when ATR unavailable.
  let lvl = null;
  if (config.volScaledStops && Number.isFinite(atr) && atr > 0) lvl = volScaledLevels(atr, config);
  return { direction: sig.direction, confidence: sig.confidence ?? 0, lvl };
}

// candles: [{ t(sec), o, h, l, c }] ascending. fundingAt(tsSec) → funding rate
// (decimal) at/before ts. oiChangeAt(tsSec) → fractional OI change (or null) —
// pass it to make CONFLUENCE/OI_ONLY testable; omit for funding/price-only modes.
// config: an agent config. Returns aggregate + trade list.
// entryFilter (optional): (candles, i, sig, config) => boolean. A no-lookahead gate
// applied AFTER deriveSignal fires — returns false to SUPPRESS an otherwise-valid
// entry. This is the conditioning hook: it lets research test "the signal only works
// in <regime/session/vol>" without changing the signal itself. Default null = no gate,
// so every existing caller (lab-api endpoints) is byte-for-byte unchanged.
// basisAt (optional): (nowMs) → basis raw fields (see makeBasisAt). Evaluated at the bar's
// CLOSE — the moment the entry fills at c.c — so the brain's view and the fill price line up.
export function runBacktest(candles, fundingAt, config, fundingPctAt = null, oiChangeAt = null, entryFilter = null, basisAt = null) {
  const trades = [];
  let pos = null;
  let lastExitIdx = -Infinity;
  const cooldownBars = Number.isFinite(config.cooldownBars) ? config.cooldownBars : 1;

  const openTrade = (direction, price, t, lvl = null) => openPosition(config, direction, price, t, lvl);
  const record = (p, exitPrice, reason, exitT) => {
    trades.push({ direction: p.direction, entry: p.entry, exit: exitPrice, reason, pnlPct: closedPnlPct(p, exitPrice), holdH: (exitT - p.entryT) / 3600, entryT: p.entryT });
  };

  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], prev = candles[i - 1];
    if (pos) {
      const hit = stepExit(pos, c, (c.t - pos.entryT) * 1000, config);
      if (hit) { record(pos, hit.px, hit.reason, c.t); pos = null; lastExitIdx = i; }
      continue;
    }
    if (!pos && (i - lastExitIdx) > cooldownBars) {
      const e = entryAt(candles, i, { fundingAt, fundingPctAt, oiChangeAt, entryFilter, basisAt }, config);
      if (e) pos = openTrade(e.direction, c.c, c.t, e.lvl);
    }
  }
  // Attach the per-trade detail (entryT + %) so a walk-forward validator can bucket
  // REAL trades by entry time — no fold-boundary artifacts. Additive; existing callers
  // read the summary fields and ignore _trades.
  return { ...aggregate(trades, config), _trades: trades };
}

// ── PORTFOLIO replay — the backtest of what the AGENT actually does ─────────────
// runBacktest replays each market on its own, as if the agent could hold BTC, ETH and SOL at
// once. It can't: the exec holds ONE position at a time across the whole watchlist, the brain
// hands each wallet only its single best signal per tick (highest confidence; ties go to the
// first symbol in config.symbols), and the daily trade/loss caps gate every entry. This walks
// every market on ONE merged hourly timeline under exactly those rules — entries from the
// shared entryAt, exits from the shared stepExit, caps from the exec's own dailyCapBlocked /
// shouldResetDaily — so the number printed is the number the agent could have made.
// markets: [{ symbol, candles, feeds }] (feeds as entryAt takes them). Returns aggregate() +
// perSymbol + `blocked` (signals the per-market replay would take that the agent can't).
export function runPortfolioBacktest(markets, config) {
  const order = (config.symbols && config.symbols.length ? config.symbols : markets.map((m) => m.symbol));
  const mk = markets
    .filter((m) => Array.isArray(m.candles) && m.candles.length > 1)
    .map((m) => ({ ...m, idx: new Map(m.candles.map((c, i) => [c.t, i])), rank: order.indexOf(m.symbol) < 0 ? 999 : order.indexOf(m.symbol) }))
    .sort((a, b) => a.rank - b.rank);
  const times = [...new Set(mk.flatMap((m) => m.candles.map((c) => c.t)))].sort((a, b) => a - b);
  const cooldownBars = Number.isFinite(config.cooldownBars) ? config.cooldownBars : 1;
  const notional = (config.capitalPerTrade || 50) * (config.leverage || 1);
  const feePct = ((config.feeBps || 0) / 100) * 2;
  const trades = [];
  const blocked = { busy: 0, otherMarket: 0, dailyCap: 0, cooldown: 0 };
  let pos = null, lastExitT = -Infinity;
  const day = { trades_today: 0, daily_pnl: 0, last_reset: times.length ? times[0] * 1000 : 0 };

  for (const t of times) {
    if (shouldResetDaily(day.last_reset, t * 1000)) { day.trades_today = 0; day.daily_pnl = 0; day.last_reset = t * 1000; }
    if (pos) {
      const i = pos.m.idx.get(t);
      if (i != null) {
        const hit = stepExit(pos, pos.m.candles[i], (t - pos.entryT) * 1000, config);
        if (hit) {
          const pnlPct = closedPnlPct(pos, hit.px);
          trades.push({ symbol: pos.m.symbol, direction: pos.direction, entry: pos.entry, exit: hit.px, reason: hit.reason, pnlPct, holdH: (t - pos.entryT) / 3600, entryT: pos.entryT });
          day.daily_pnl += ((pnlPct - feePct) / 100) * notional;
          pos = null; lastExitT = t;
          continue; // no re-entry on the exit bar (same as runBacktest)
        }
      }
    }
    // Every market's signal at this bar, in watchlist order.
    const sigs = [];
    for (const m of mk) {
      const i = m.idx.get(t);
      if (i == null || i < 1) continue;
      const e = entryAt(m.candles, i, m.feeds || {}, config);
      if (e) sigs.push({ m, i, e });
    }
    if (!sigs.length) continue;
    if (pos) { blocked.busy += sigs.length; continue; }
    if ((t - lastExitT) <= cooldownBars * 3600) { blocked.cooldown += sigs.length; continue; }
    if (dailyCapBlocked(day, config).blocked) { blocked.dailyCap += sigs.length; continue; }
    // The brain's pick: highest confidence, first-listed wins a tie.
    let best = sigs[0];
    for (const x of sigs) if (x.e.confidence > best.e.confidence) best = x;
    blocked.otherMarket += sigs.length - 1;
    const c = best.m.candles[best.i];
    pos = openPosition(config, best.e.direction, c.c, c.t, best.e.lvl);
    pos.m = best.m;
    day.trades_today += 1;
  }

  const perSymbol = mk.map((m) => {
    const ts = trades.filter((x) => x.symbol === m.symbol);
    return { symbol: m.symbol, ...aggregate(ts, config) };
  });
  return { ...aggregate(trades, config), perSymbol, blocked, _trades: trades };
}

export function aggregate(trades, config = {}) {
  const n = trades.length;
  const notional = (config.capitalPerTrade || 50) * (config.leverage || 1);
  // Optional cost model: a taker fee per side (config.feeBps, e.g. 3 = 0.03%).
  // A round trip = entry + exit ≈ 2× → deducted from each trade's % return so the
  // net reflects real trading costs. (Conservative: ignores funding RECEIVED while
  // fading, which is a tailwind for this strategy — so real edge ≥ this.)
  const feePct = ((config.feeBps || 0) / 100) * 2;
  let net = 0, grossWin = 0, grossLoss = 0, wins = 0;
  for (const t of trades) {
    const usd = ((t.pnlPct - feePct) / 100) * notional;
    net += usd;
    if (usd > 0) { grossWin += usd; wins++; } else { grossLoss += Math.abs(usd); }
  }
  return {
    trades: n,
    winRate: n ? Math.round((wins / n) * 1000) / 10 : 0,
    netUsd: Math.round(net * 100) / 100,
    profitFactor: grossLoss > 0 ? Math.round(Math.min(grossWin / grossLoss, 99) * 100) / 100 : (grossWin > 0 ? 99 : 0),
    avgPnlPct: n ? Math.round((trades.reduce((s, t) => s + t.pnlPct, 0) / n) * 1000) / 1000 : 0,
  };
}

// ── Data loading (Cloudflare-Worker + node compatible via global fetch) ──────
const ORDERLY = "https://api-evm.orderly.org";

export async function fetchCandles(symbol, days) {
  const now = Math.floor(Date.now() / 1000);
  const from = now - days * 86400;
  const out = [];
  let cursor = from;
  const step = 20 * 86400;
  while (cursor < now) {
    const to = Math.min(cursor + step, now);
    const r = await fetch(`${ORDERLY}/tv/history?symbol=${symbol}&resolution=60&from=${cursor}&to=${to}`);
    const d = await r.json();
    if (d && d.s === "ok" && Array.isArray(d.t)) for (let i = 0; i < d.t.length; i++) out.push({ t: d.t[i], o: d.o[i], h: d.h[i], l: d.l[i], c: d.c[i] });
    cursor = to;
  }
  const seen = new Set();
  return out.filter((c) => (seen.has(c.t) ? false : seen.add(c.t))).sort((a, b) => a.t - b.t);
}

export async function fetchFundingAt(symbol) {
  const rows = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(`${ORDERLY}/v1/public/funding_rate_history?symbol=${symbol}&page=${page}&size=100`);
    const d = await r.json();
    const rs = d?.data?.rows || [];
    rows.push(...rs.map((x) => ({ ts: x.funding_rate_timestamp, rate: x.funding_rate })));
    if (rs.length < 100) break;
  }
  rows.sort((a, b) => a.ts - b.ts);
  const at = (tsSec) => { const ms = tsSec * 1000; let rate = 0; for (const row of rows) { if (row.ts <= ms) rate = row.rate; else break; } return rate; };
  return { at, rows };
}

// Realistic taker fee (bps/side) applied to every user-facing backtest so results
// are honest by default. Verified the Proven-Edge config survives it with margin.
export const DEFAULT_FEE_BPS = 3;

// Sweep: fetch each symbol's data ONCE, then run a grid of backtestable configs
// (mode × threshold × exit style) reusing that data, ranked by net P&L. This is the
// terminal sweep, in-app. Bounded (~36 configs) to stay within a request's budget.
// The agent's daily risk caps, carried from the user's config into every replay variant so a
// sweep row is graded under the same caps the agent would run with.
function agentCaps(base) {
  const out = {};
  if (Number(base?.maxTradesPerDay) > 0) out.maxTradesPerDay = Number(base.maxTradesPerDay);
  if (Number(base?.maxDailyLossUsdc) > 0) out.maxDailyLossUsdc = Number(base.maxDailyLossUsdc);
  return out;
}

// Bucket a portfolio's trades into `folds` equal time windows over [t0, tN] by ENTRY time.
export function portfolioFolds(trades, t0, tN, config, folds) {
  const span = (tN - t0) / folds || 1;
  const notional = (config.capitalPerTrade || 50) * (config.leverage || 1);
  const feePct = ((config.feeBps || 0) / 100) * 2;
  const net = new Array(folds).fill(0), cnt = new Array(folds).fill(0);
  for (const t of trades || []) {
    const k = Math.min(folds - 1, Math.max(0, Math.floor((t.entryT - t0) / span)));
    net[k] += ((t.pnlPct - feePct) / 100) * notional; cnt[k]++;
  }
  return { net: net.map((n) => Math.round(n * 100) / 100), cnt };
}

export async function runSweep(base, { symbols, days }, oiHistBySymbol = {}) {
  const data = {};
  for (const s of symbols) {
    const [candles, funding] = await Promise.all([fetchCandles(s, days), fetchFundingAt(s)]);
    const oiRows = oiHistBySymbol[s];
    data[s] = {
      candles, fundingAt: funding.at, fundingPctAt: makeFundingPctAt(funding.rows),
      oiChangeAt: oiRows && oiRows.length >= 2 ? makeOiChangeAt(oiRows) : null,
    };
  }
  const EXITS = {
    "fixed tp1.5/sl0.75": { tpPercent: 1.5, slPercent: 0.75 },
    "scale-out 1/2.5": { tpPercent: 1, slPercent: 1, takeProfits: [{ pct: 1, sizePct: 50 }, { pct: 2.5, sizePct: 50 }] },
    "trail 0.5": { tpPercent: 1.5, slPercent: 0.75, trailingStopPct: 0.5 },
  };
  const common = { leverage: base.leverage || 5, capitalPerTrade: base.capitalPerTrade || 50, maxHoldHours: base.maxHoldHours || 4, oiChangeThreshold: 0, feeBps: DEFAULT_FEE_BPS, ...agentCaps(base) };
  const markets = symbols.map((s) => ({ symbol: s, candles: data[s].candles, feeds: { fundingAt: data[s].fundingAt, fundingPctAt: data[s].fundingPctAt, oiChangeAt: data[s].oiChangeAt } }));
  // Only fold the OI-driven modes (CONFLUENCE / OI_ONLY) into the grid when EVERY
  // symbol has usable recorded OI — otherwise they'd contribute empty rows. The
  // endpoint only passes oiHistBySymbol once it's judged mature, so this lights up
  // the flagship CONFLUENCE in discovery exactly when the data can back it.
  const oiReady = symbols.length > 0 && symbols.every((s) => data[s].oiChangeAt);
  const configs = [];
  for (const [exName, ex] of Object.entries(EXITS)) {
    for (const p of [0.3, 0.5, 0.8]) for (const mode of ["MOMENTUM", "MEAN_REVERSION"]) configs.push({ name: `${mode} · p${p} · ${exName}`, config: { ...common, ...ex, signalMode: mode, priceChangeThreshold: p } });
    for (const f of [0.005, 0.01, 0.02]) configs.push({ name: `FUNDING_ONLY · f${f} · ${exName}`, config: { ...common, ...ex, signalMode: "FUNDING_ONLY", fundingThreshold: f } });
    // The adaptive funding-PERCENTILE filter — the only net-positive family found.
    for (const pctMin of [90, 95]) configs.push({ name: `FUNDING · f0.01 · pct${pctMin} · ${exName}`, config: { ...common, ...ex, signalMode: "FUNDING_ONLY", fundingThreshold: 0.01, fundingPercentileMin: pctMin } });
    if (oiReady) {
      configs.push({ name: `CONFLUENCE · f0.01 · ${exName}`, config: { ...common, ...ex, signalMode: "CONFLUENCE", fundingThreshold: 0.01 } });
      configs.push({ name: `OI_ONLY · ${exName}`, config: { ...common, ...ex, signalMode: "OI_ONLY" } });
    }
  }
  const results = configs.map(({ name, config }) => {
    // Ranked AS THE AGENT TRADES IT (one position across the watchlist, best signal per tick,
    // daily caps). Ranking by the per-market sum rewarded overlap — long holds on several
    // markets at once that the agent can never take — so it biased the grid toward them.
    let indepNet = 0, indepTrades = 0;
    for (const s of symbols) {
      const r = runBacktest(data[s].candles, data[s].fundingAt, config, data[s].fundingPctAt, data[s].oiChangeAt);
      indepNet += r.netUsd; indepTrades += r.trades;
    }
    const pf = runPortfolioBacktest(markets, { ...config, symbols });
    // Include the strategy-defining params so the UI can one-click APPLY a winner.
    const applied = {
      signalMode: config.signalMode, priceChangeThreshold: config.priceChangeThreshold,
      fundingThreshold: config.fundingThreshold, fundingPercentileMin: config.fundingPercentileMin || 0,
      oiChangeThreshold: config.oiChangeThreshold || 0,
      tpPercent: config.tpPercent, slPercent: config.slPercent,
      takeProfits: config.takeProfits || null, trailingStopPct: config.trailingStopPct || 0,
    };
    return { name, trades: pf.trades, winRate: pf.winRate, netUsd: pf.netUsd, indepNetUsd: Math.round(indepNet * 100) / 100, indepTrades, config: applied };
  }).sort((a, b) => b.netUsd - a.netUsd);
  return { days, symbols, notional: common.capitalPerTrade * common.leverage, rankedBy: "portfolio", results };
}

// ── BASIS sweep: the exits × confirm grid for the basis stack ─────────────────
// The scoreboard grades the READ (forward move after an extreme). This grades the
// STRATEGY around it: which confirm (none / CVD / smart money) and which exits survive
// fees across markets. Each (symbol × confirm) basis lookup is built ONCE and shared by
// every exit variant (memoized per bar). A confirm whose series isn't recorded for every
// symbol is left out of the grid rather than run as a silent zero.
export const BASIS_SWEEP_EXITS = {
  "tp1.5/sl1": { tpPercent: 1.5, slPercent: 1 },
  "tp2.5/sl2": { tpPercent: 2.5, slPercent: 2 },
  "tp3/sl1.5": { tpPercent: 3, slPercent: 1.5 },
  "scale-out 1.5/3 · sl1.5": { tpPercent: 1.5, slPercent: 1.5, takeProfits: [{ pct: 1.5, sizePct: 50 }, { pct: 3, sizePct: 50 }] },
};
export const BASIS_SWEEP_HOLDS = [4, 12, 24]; // the scoreboard's graded horizons
export async function runBasisSweep(base, { symbols, days }, flowBySymbol = {}, { confirms = [null, "CVD", "SMART"] } = {}) {
  const data = {};
  for (const s of symbols) {
    const [candles, funding] = await Promise.all([fetchCandles(s, days), fetchFundingAt(s)]);
    data[s] = { candles, fundingAt: funding.at, basisAt: {} };
    for (const cf of confirms) {
      const f = flowBySymbol[s];
      if (!f) continue;
      if (cf === "CVD" && !(f.cvdHist?.length && f.oiHist?.length)) continue;
      if (cf === "SMART" && !f.smHist?.length) continue;
      data[s].basisAt[String(cf)] = makeBasisAt(f, { needCvd: cf === "CVD", needSmart: cf === "SMART" });
    }
  }
  const liveConfirms = confirms.filter((cf) => symbols.every((s) => data[s].basisAt[String(cf)]));
  const common = { signalMode: "BASIS_FADE", leverage: base.leverage || 5, capitalPerTrade: base.capitalPerTrade || 50, feeBps: DEFAULT_FEE_BPS, ...agentCaps(base) };
  const label = (cf) => (cf === "CVD" ? "Basis × CVD" : cf === "SMART" ? "Basis × Smart" : "Basis Extreme");
  const results = [];
  for (const cf of liveConfirms) {
    for (const [exName, ex] of Object.entries(BASIS_SWEEP_EXITS)) {
      for (const hold of BASIS_SWEEP_HOLDS) {
        const config = { ...common, ...ex, maxHoldHours: hold, ...(cf ? { basisConfirm: cf } : {}) };
        // Breadth stays per-market (does the edge exist on each market on its own?); the P&L,
        // trades and win rate — and the RANK — are the portfolio stream the agent can take.
        let indepNet = 0, indepTrades = 0, posSymbols = 0;
        for (const s of symbols) {
          const r = runBacktest(data[s].candles, data[s].fundingAt, config, null, null, null, data[s].basisAt[String(cf)]);
          indepNet += r.netUsd; indepTrades += r.trades;
          if (r.netUsd > 0) posSymbols++;
        }
        const pf = runPortfolioBacktest(symbols.map((s) => ({ symbol: s, candles: data[s].candles, feeds: { fundingAt: data[s].fundingAt, basisAt: data[s].basisAt[String(cf)] } })), { ...config, symbols });
        results.push({
          name: `${label(cf)} · ${exName} · ${hold}h`, trades: pf.trades, posSymbols, totalSymbols: symbols.length,
          winRate: pf.winRate, netUsd: pf.netUsd, indepNetUsd: Math.round(indepNet * 100) / 100, indepTrades,
          config: {
            signalMode: "BASIS_FADE", basisConfirm: cf || null, tpPercent: ex.tpPercent, slPercent: ex.slPercent,
            takeProfits: ex.takeProfits || null, trailingStopPct: 0, maxHoldHours: hold,
          },
        });
      }
    }
  }
  results.sort((a, b) => b.netUsd - a.netUsd);
  return { days, symbols, notional: common.capitalPerTrade * common.leverage, rankedBy: "portfolio", results, confirmsTested: liveConfirms.map((c) => c || "NONE") };
}

// Orchestrator: run one config across symbols, return per-symbol + combined stats.
// oiHistBySymbol (optional) = { symbol: [{t(ms),price,oi,funding}] } from the brain's
// recorded oi:hist — pass it to make CONFLUENCE/OI_ONLY testable (the endpoint reads
// it from KV and gates on maturity first).
export async function backtestConfig(config, { symbols, days }, oiHistBySymbol = {}, flowBySymbol = {}) {
  const perSymbol = [], markets = [];
  let net = 0, trades = 0, wins = 0;
  const cfg = { feeBps: DEFAULT_FEE_BPS, ...config };
  for (const symbol of symbols) {
    const [candles, funding] = await Promise.all([fetchCandles(symbol, days), fetchFundingAt(symbol)]);
    const oiRows = oiHistBySymbol[symbol];
    const oiChangeAt = oiRows && oiRows.length >= 2 ? makeOiChangeAt(oiRows) : null;
    const fundingPctAt = makeFundingPctAt(funding.rows);
    const basisAt = basisAtForConfig(config, flowBySymbol[symbol]);
    const r = runBacktest(candles, funding.at, cfg, fundingPctAt, oiChangeAt, null, basisAt);
    const { _trades, ...summary } = r; // don't leak the full trade list into the API response
    perSymbol.push({ symbol, candles: candles.length, ...summary });
    net += r.netUsd; trades += r.trades; wins += Math.round((r.winRate / 100) * r.trades);
    markets.push({ symbol, candles, feeds: { fundingAt: funding.at, fundingPctAt, oiChangeAt, basisAt } });
  }
  // The same markets under the agent's real constraints (one position, best signal per tick,
  // daily caps) — `combined` above is each market replayed on its own.
  const { _trades: _pt, ...portfolio } = runPortfolioBacktest(markets, { ...cfg, symbols });
  return {
    days, symbols,
    combined: { trades, winRate: trades ? Math.round((wins / trades) * 1000) / 10 : 0, netUsd: Math.round(net * 100) / 100 },
    portfolio,
    perSymbol,
  };
}

// Bucket a backtest's REAL closed trades into `folds` sequential windows by ENTRY time
// (no boundary artifacts) and return per-fold net$ + counts. Fees applied here.
export function foldsByEntry(res, candles, config, folds) {
  const t0 = candles[0]?.t ?? 0, tN = candles[candles.length - 1]?.t ?? 0, span = (tN - t0) / folds || 1;
  const notional = (config.capitalPerTrade || 50) * (config.leverage || 1);
  const feePct = ((config.feeBps || 0) / 100) * 2;
  const net = new Array(folds).fill(0), cnt = new Array(folds).fill(0);
  for (const t of res._trades || []) {
    const k = Math.min(folds - 1, Math.max(0, Math.floor((t.entryT - t0) / span)));
    net[k] += ((t.pnlPct - feePct) / 100) * notional; cnt[k]++;
  }
  return { net: net.map((n) => Math.round(n * 100) / 100), cnt };
}

// Assign a robustness verdict from cross-market + cross-time consistency. An edge is
// only ROBUST if it's net-positive on a majority of symbols AND in a majority of folds
// — that's what separates a real edge from a single-window overfit.
export function robustnessVerdict(posSymbols, totalSymbols, foldConsistencyPct) {
  if (posSymbols >= Math.ceil(totalSymbols / 2) && foldConsistencyPct >= 55) return "ROBUST";
  if (posSymbols >= 2 && foldConsistencyPct >= 45) return "FRAGILE";
  return "NOT_ROBUST";
}

// Walk-forward validator (the honest layer over backtestConfig): runs ONE backtest per
// symbol over `days`, buckets real trades into `folds`, and returns a cross-market +
// cross-time verdict. oiHistBySymbol makes CONFLUENCE/OI_ONLY testable (endpoint gates
// maturity). Kept lean on symbol count so it fits a Worker's subrequest budget.
export async function walkForwardValidate(config, { symbols, days, folds = 4 }, oiHistBySymbol = {}, flowBySymbol = {}) {
  const cfg = { feeBps: DEFAULT_FEE_BPS, ...config };
  const perSymbol = [];
  let posSymbols = 0, foldPos = 0, foldTotal = 0, totNet = 0, totTrades = 0;
  const markets = [];
  for (const symbol of symbols) {
    const [candles, funding] = await Promise.all([fetchCandles(symbol, days), fetchFundingAt(symbol)]);
    const oiRows = oiHistBySymbol[symbol];
    const oiChangeAt = oiRows && oiRows.length >= 2 ? makeOiChangeAt(oiRows) : null;
    const fundingPctAt = makeFundingPctAt(funding.rows);
    const basisAt = basisAtForConfig(cfg, flowBySymbol[symbol]);
    const res = runBacktest(candles, funding.at, cfg, fundingPctAt, oiChangeAt, null, basisAt);
    markets.push({ symbol, candles, feeds: { fundingAt: funding.at, fundingPctAt, oiChangeAt, basisAt } });
    const { net, cnt } = foldsByEntry(res, candles, cfg, folds);
    const symNet = Math.round(net.reduce((a, b) => a + b, 0) * 100) / 100;
    const symTrades = cnt.reduce((a, b) => a + b, 0);
    const foldsPos = net.filter((n) => n > 0).length;
    if (symNet > 0) posSymbols++;
    for (const n of net) { foldTotal++; if (n > 0) foldPos++; }
    totNet += symNet; totTrades += symTrades;
    perSymbol.push({ symbol, net: symNet, trades: symTrades, foldsPositive: foldsPos, folds: net });
  }
  const foldConsistency = foldTotal ? Math.round((foldPos / foldTotal) * 100) : 0;
  // The verdict stays PER-MARKET breadth × time (unchanged, comparable with earlier baselines):
  // "does the edge exist on each market on its own" is a per-market question. What the agent can
  // actually book is a different number — its own watchlist, one position at a time, daily caps —
  // so that stream is replayed too and bucketed into the same time folds.
  const own = (Array.isArray(config.symbols) ? config.symbols : []).filter((s) => markets.some((m) => m.symbol === s));
  const watch = own.length ? own : symbols;
  const wm = markets.filter((m) => watch.includes(m.symbol));
  const pf = runPortfolioBacktest(wm, { ...cfg, symbols: watch });
  const t0 = Math.min(...wm.map((m) => m.candles[0]?.t ?? Infinity));
  const tN = Math.max(...wm.map((m) => m.candles[m.candles.length - 1]?.t ?? -Infinity));
  const pfFolds = portfolioFolds(pf._trades, t0, tN, cfg, folds);
  return {
    days, folds, symbols,
    verdict: robustnessVerdict(posSymbols, symbols.length, foldConsistency),
    posSymbols, totalSymbols: symbols.length, foldConsistency,
    totalNet: Math.round(totNet * 100) / 100, totalTrades: totTrades,
    perSymbol,
    portfolio: {
      watchlist: watch, netUsd: pf.netUsd, trades: pf.trades, winRate: pf.winRate, profitFactor: pf.profitFactor,
      folds: pfFolds.net, foldTrades: pfFolds.cnt, foldsPositive: pfFolds.net.filter((n) => n > 0).length, blocked: pf.blocked,
    },
  };
}
