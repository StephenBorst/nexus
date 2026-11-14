// The market drawer: every lens on ONE coin, in plain words (2026-11-14, borst: "make our tools plug and play and
// mean something"). Shared by the lab-api route (GET /intel/market/:coin, which composes it server-side from the
// existing boards in one call) and the drawer UI. Pure, tested.
//
// House rule (CLAUDE.md, The Read / Briefing): show inputs, never a tally or crown of ungraded reads. So each lens
// gets its own line and no line adds them up into a verdict; the drawer says once that none of it is graded.

import { fundingWords } from "./boardWords.mjs";
import { forecastRead } from "./forecastRead.mjs";
import { CONSENSUS_RATIO } from "./smartConsensus.mjs";
import { lensGradeLine } from "./fadeGrade.mjs";

export const MARKET_READ_V = 1;

/** "PERP_ETH_USDC" | "eth" | "ETH" → "ETH"; anything else → "". */
export function marketCoin(s) {
  const m = /^PERP_([^_]+)_USDC/i.exec(String(s ?? "").trim());
  const c = (m ? m[1] : String(s ?? "").trim()).toUpperCase();
  return /^[A-Z0-9]{1,15}$/.test(c) ? c : "";
}

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const pct = (v, dp = 1) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(dp)}%`;
const ends = (iso) => {
  const d = new Date(iso);
  // Polymarket closes its markets at midnight New York time ("by December 31" ends 2027-01-01T04:59Z): name the day
  // the market itself names, not the UTC date.
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
};

/**
 * Compose the drawer from the boards' own payloads (any may be null: that lens is "unread", never invented).
 * @returns {{ coin, v, lenses: {id, label, line, detail?, tone}[], price: number|null, change24hPct: number|null }}
 */
export function composeMarket({ coin, mispriced, signals, smart, callers, forecasts, catalysts, pulse, scorecard } = {}) {
  const c = marketCoin(coin);
  const lenses = [];
  const add = (id, label, line, extra = {}) => lenses.push({ id, label, line, tone: "plain", ...extra });

  // Funding: who pays, and whether it is stretched against its own range.
  const mp = (mispriced?.markets ?? []).find((m) => marketCoin(m?.coin ?? m?.symbol) === c) ?? null;
  const sig = (signals?.signals ?? []).find((s) => marketCoin(s?.symbol) === c) ?? null;
  const fundAnnual = num(mp?.fundingAnnualPct) ?? num(sig?.funding_annual_pct);
  if (fundAnnual == null) add("funding", "Funding", "Unread right now.", { tone: "faint" });
  else {
    const stretched = mp?.stretched ?? sig?.stretched ?? false;
    const side = fundAnnual > 0 ? "short" : "long";
    add("funding", "Funding", stretched
      ? `${cap(fundingWords(fundAnnual))}, stretched past its own range. The fade (${side}) is a mechanical rule, not graded yet.`
      : `${cap(fundingWords(fundAnnual))}, within its own range.`,
    { tone: stretched ? "watch" : "plain" });
  }

  // Price + open interest (OI only from a fresh snapshot: delta_fresh).
  const ch = num(mp?.change24hPct);
  const oi = sig?.delta_fresh ? num(sig?.oi_change_pct) : null;
  if (ch != null || oi != null) {
    const parts = [];
    if (ch != null) parts.push(`Price ${pct(ch)} in 24h`);
    if (oi != null) parts.push(`open interest ${pct(oi)} since the last check`);
    add("tape", "Tape", `${parts.join(", ")}.`, { tone: "plain" });
  }

  // Smart money: both sides, and whether it clears the consensus bar.
  const sm = smart?.consensus?.[c] ?? null;
  if (sm && (num(sm.long) != null || num(sm.short) != null)) {
    const L = num(sm.long) ?? 0, S = num(sm.short) ?? 0;
    const lead = Math.max(L, S), other = Math.min(L, S);
    const clear = lead >= 2 && lead >= CONSENSUS_RATIO * other && lead > other;
    add("smart", "Smart money", clear
      ? `${S} short · ${L} long among tracked traders: they agree, ${S > L ? "short" : "long"}. Context, not a graded read.`
      : `${S} short · ${L} long among tracked traders: split, no clear agreement.`,
    { tone: clear ? "plain" : "faint" });
  } else add("smart", "Smart money", "No tracked trader holds it right now.", { tone: "faint" });

  // Graded callers' lean (merit-weighted from open positions + active public calls).
  const cl = callers?.consensus?.[c] ?? null;
  if (cl && num(cl.participants) > 0) {
    const n = cl.participants;
    add("callers", "Callers", `${n} graded ${n === 1 ? "caller leans" : "callers lean"} ${String(cl.side || "").toLowerCase() || "neither way"} (${cl.longCount ?? 0} long · ${cl.shortCount ?? 0} short).`);
  }

  // Forecasts: the most traded market on this coin, said plainly with its catch.
  const fm = [...(forecasts?.markets ?? [])].filter((m) => marketCoin(m?.coin ?? m?.symbol) === c)
    .sort((a, b) => Number(!!b.divergence) - Number(!!a.divergence) || (num(b.volumeUsd) ?? 0) - (num(a.volumeUsd) ?? 0))[0];
  if (fm) {
    const r = forecastRead({ coin: c, yesPct: fm.forecastProbPct, target: fm.target, targetDirection: fm.targetDirection, distancePct: fm.distancePct,
      forecastLean: fm.forecastLean, fundingLean: fm.fundingLean, divergence: !!fm.divergence, ends: fm.endDate ? ends(fm.endDate) : null });
    add("forecast", "Forecasts", r.read, { detail: r.caveat ?? undefined, tone: r.caveat ? "watch" : "plain" });
  }

  // Catalysts: world events the catalyst board maps onto this coin.
  const cats = (catalysts?.catalysts ?? []).filter((e) => (e?.impacts ?? []).some((i) => marketCoin(i?.coin ?? i?.market) === c));
  if (cats.length) {
    const top = [...cats].sort((a, b) => (num(b.volumeUsd) ?? 0) - (num(a.volumeUsd) ?? 0))[0];
    const imp = top.impacts.find((i) => marketCoin(i?.coin ?? i?.market) === c);
    add("catalysts", "Catalysts", `${cats.length} world ${cats.length === 1 ? "event maps" : "events map"} to ${c}. Biggest: "${top.question}" at ${Math.round(num(top.yesProbPct) ?? 0)}% YES${imp?.direction ? `, read as ${String(imp.direction).toLowerCase()} for ${c}` : ""}.`);
  }

  // Open calls on this coin: people and our engines counted apart (pulse rule).
  if (pulse) {
    const ppl = (pulse.openCalls ?? []).filter((x) => marketCoin(x?.symbol) === c).length;
    const eng = (pulse.engines?.openCalls ?? []).filter((x) => marketCoin(x?.symbol) === c).length;
    add("calls", "Open calls", ppl || eng
      ? `${ppl} by people · ${eng} by our engines, graded from public price.`
      : "No open call on it. Post one and it grades itself from public price.", { tone: ppl || eng ? "plain" : "faint" });
  }

  // Each lens's nearest graded relative from the scoreboard as served (fadeGrade.mjs lensGradeLine), or "not graded".
  for (const l of lenses) {
    const g = lensGradeLine(l.id, scorecard);
    if (g) l.graded = g;
  }
  return { coin: c, v: MARKET_READ_V, price: num(mp?.markPrice) ?? num(sig?.mark_price), change24hPct: ch, lenses };
}

function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/** The one line the drawer states once, under every lens. */
export const MARKET_READ_FOOTER = "Inputs, not a verdict. None of these is a graded signal on this coin.";
