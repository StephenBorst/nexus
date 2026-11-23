// Market alerts on change (2026-11-14, borst: alerts that mean something). For coins a device watches (picked in the
// market drawer), the */5 cron compares a small snapshot per coin with the last one and says only what CHANGED:
//   FUNDING_STRETCH   funding moved past the coin's own range (it wasn't stretched last look)
//   CONSENSUS_FORMED  tracked traders now clearly agree on a side (CONSENSUS_RATIO), or the agreed side FLIPPED
//   FORECAST_SWING    the coin's most traded forecast moved ≥ FORECAST_SWING_PT points from the last alerted level
//   UNUSUAL_MOVE      the coin's 4-hour move passed its own 10/90 line over 90 days (unusualMove.mjs; runner-built)
// The first look at a coin only records a baseline (switching alerts on never replays old moves). An unread board keeps
// the previous values and fires nothing. Pure, tested; the worker runner is lab-api marketWatch.mjs.
import { marketCoin } from "./marketRead.mjs";
import { CONSENSUS_RATIO } from "./smartConsensus.mjs";
import { moveMessage } from "./unusualMove.mjs";

export const FORECAST_SWING_PT = 15;
export const MARKET_WATCH_COINS_MAX = 10; // per device
export const MARKET_WATCH_UNIVERSE_MAX = 40; // distinct coins the cron reads per run

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Coins from a device's request: clean tickers, unique, capped. */
export function normCoins(list) {
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const k = marketCoin(c);
    if (k && !out.includes(k)) out.push(k);
    if (out.length >= MARKET_WATCH_COINS_MAX) break;
  }
  return out;
}

/** What we compare per coin. A field the boards didn't give is null (unread), never a guess. */
export function marketSnapshot(coin, { mispriced, smart, forecasts } = {}) {
  const c = marketCoin(coin);
  const mp = mispriced ? (mispriced.markets ?? []).find((m) => marketCoin(m?.coin ?? m?.symbol) === c) ?? null : undefined;
  const sm = smart ? smart.consensus?.[c] ?? null : undefined;
  let side = null;
  if (sm) {
    const L = num(sm.long) ?? 0, S = num(sm.short) ?? 0;
    const lead = Math.max(L, S), other = Math.min(L, S);
    side = lead >= 2 && lead > other && lead >= CONSENSUS_RATIO * other ? (S > L ? "SHORT" : "LONG") : "NONE";
  }
  const fm = forecasts
    ? [...(forecasts.markets ?? [])].filter((m) => marketCoin(m?.coin ?? m?.symbol) === c).sort((a, b) => (num(b.volumeUsd) ?? 0) - (num(a.volumeUsd) ?? 0))[0] ?? null
    : undefined;
  return {
    stretched: mp === undefined ? null : mp ? !!mp.stretched : false,
    fundAnnual: mp ? num(mp.fundingAnnualPct) : null,
    smartSide: sm === undefined ? null : side ?? "NONE",
    smartL: sm ? num(sm.long) : null,
    smartS: sm ? num(sm.short) : null,
    fcId: fm === undefined ? null : fm ? String(fm.id ?? fm.question ?? "") : "",
    fcYes: fm ? num(fm.forecastProbPct) : null,
    fcQ: fm ? String(fm.question ?? "") : null,
  };
}

/**
 * Compare with the last snapshot. Returns { seen, events }: `seen` is what to store (unread fields keep the old
 * values; the forecast baseline `fcBase` only moves when a swing is announced or the market changes).
 */
export function marketTransitions(coin, prev, next) {
  const c = marketCoin(coin);
  const keep = (k) => (next[k] === null || next[k] === undefined ? prev?.[k] ?? null : next[k]);
  const seen = {
    stretched: keep("stretched"), fundAnnual: next.stretched === null ? prev?.fundAnnual ?? null : next.fundAnnual,
    smartSide: keep("smartSide"), smartL: next.smartSide === null ? prev?.smartL ?? null : next.smartL,
    smartS: next.smartSide === null ? prev?.smartS ?? null : next.smartS,
    fcId: keep("fcId"), fcQ: next.fcId === null ? prev?.fcQ ?? null : next.fcQ,
    fcBase: prev?.fcBase ?? null,
  };
  const events = [];
  if (!prev) {
    seen.fcBase = num(next.fcYes);
    return { seen, events };
  }
  if (next.stretched === true && prev.stretched === false) {
    events.push({ kind: "FUNDING_STRETCH", coin: c, fundAnnual: next.fundAnnual });
  }
  if (next.smartSide && next.smartSide !== "NONE" && prev.smartSide && next.smartSide !== prev.smartSide) {
    events.push({ kind: prev.smartSide === "NONE" ? "CONSENSUS_FORMED" : "CONSENSUS_FLIPPED", coin: c, side: next.smartSide, long: next.smartL, short: next.smartS });
  }
  if (next.fcId !== null) {
    if (next.fcId !== prev.fcId) seen.fcBase = num(next.fcYes);
    else if (num(next.fcYes) != null && num(prev.fcBase) != null && Math.abs(next.fcYes - prev.fcBase) >= FORECAST_SWING_PT) {
      events.push({ kind: "FORECAST_SWING", coin: c, from: prev.fcBase, to: next.fcYes, question: next.fcQ });
      seen.fcBase = next.fcYes;
    } else if (num(prev.fcBase) == null) seen.fcBase = num(next.fcYes);
  }
  return { seen, events };
}

/** The alert's text: what changed, in plain words; never a buy/sell, never "edge". */
export function marketAlertMessage(ev) {
  const c = ev.coin;
  if (ev.kind === "FUNDING_STRETCH") {
    const f = num(ev.fundAnnual);
    const who = f == null ? "funding" : f > 0 ? `longs pay ${Math.abs(f).toFixed(1)}%/yr` : `shorts pay ${Math.abs(f).toFixed(1)}%/yr`;
    return `${c}: funding stretched past its own range (${who}). The fade is a mechanical rule, not graded.`;
  }
  if (ev.kind === "CONSENSUS_FORMED" || ev.kind === "CONSENSUS_FLIPPED") {
    const verb = ev.kind === "CONSENSUS_FORMED" ? "now agree" : "flipped, now agree";
    return `${c}: tracked traders ${verb} ${String(ev.side).toLowerCase()} (${ev.short ?? 0} short · ${ev.long ?? 0} long). Context, not a graded read.`;
  }
  if (ev.kind === "FORECAST_SWING") {
    const up = ev.to > ev.from;
    return `${c}: forecast ${up ? "up" : "down"} ${Math.abs(Math.round(ev.to - ev.from))} pts to ${Math.round(ev.to)}% YES. "${String(ev.question ?? "").slice(0, 90)}"`;
  }
  if (ev.kind === "UNUSUAL_MOVE" && ev.move) return moveMessage(c, ev.move);
  return `${c}: something changed.`;
}

/** Where the alert opens: Lab home with this coin's drawer up (MarketDrawer reads ?market=). */
export const marketAlertUrl = (coin) => `/lab?tab=intel&market=${marketCoin(coin)}`;
