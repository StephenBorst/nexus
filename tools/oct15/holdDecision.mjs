// Oct-15 hold decision — 12h control vs 24h variant of the Basis × CVD Stack.
//
//   node tools/oct15/holdDecision.mjs          # reads the public endpoints, prints the call
//
// READ-ONLY. It changes nothing: no preset edit, no wallet write. It prints a decision the
// humans act on.
//
// PRE-REGISTERED (written 2026-09-26, before the Oct-15 data exists). The 24h hold was PICKED
// from the Sept-25 in-sample window, so in-sample grades flatter it and can't decide it. The
// call rests ONLY on evidence that did not exist when 24h was picked:
//   1. the scoreboard's OUT-OF-SAMPLE exit grades (`exit.oos` / `exit24h.oos`, trades entered
//      after 2026-09-25 04:00 UTC), and
//   2. the forward PAPER A/B (12h control vs 24h arm, identical config, clean start
//      2026-09-26T00:04:16Z).
// Thresholds live in RULES below. Don't tune them after reading the Oct-15 numbers — that turns
// a test into a fit. If they need to change, change them BEFORE the run and say so in the commit.

export const CLEAN_START_MS = Date.parse("2026-09-26T00:04:16Z");

export const RULES = Object.freeze({
  minOosTrades: 10,   // per hold, scoreboard out-of-sample exit trades
  minPaperTrades: 5,  // per wallet, closed paper trades since the clean start
  minEdgeBps: 10,     // 24h must beat 12h out-of-sample by at least this (net, per trade)
});

export const WALLETS = Object.freeze({
  control12h: "0x9A3012988d60D61b34660BE06a321F7BF7bCcB28",
  arm24h: "0xa77ca113f39405b50617c2cc9ba5d6e3ced4a9a7",
  nineMarket24h: "0x325Da3ed024f533764407524918a847bCb3f95DE",
});

// A wallet's paper record, or why it can't be used. `agg` = state.paper_agg.
export function paperArm(agg, resetAt = null) {
  // paper/reset clears paper_agg, so no aggregate = a clean ledger with 0 closed trades.
  if (!agg) return { usable: true, why: null, trades: 0, net: 0, perTrade: null };
  if (!Number.isFinite(agg.trades)) return { usable: false, why: "unreadable paper record", trades: 0, net: null };
  const first = agg.firstTradeAt ? Date.parse(agg.firstTradeAt) || Number(agg.firstTradeAt) : null;
  if (first != null && first < CLEAN_START_MS) {
    return { usable: false, why: `record starts ${new Date(first).toISOString()}, before the clean start — reset it`, trades: agg.trades, net: agg.net ?? null };
  }
  const reset = resetAt ? Date.parse(resetAt) || Number(resetAt) : null;
  return { usable: true, why: null, trades: agg.trades, net: Number(agg.net) || 0, perTrade: agg.trades ? (Number(agg.net) || 0) / agg.trades : null, resetAt: reset };
}

// The call. Inputs are plain numbers so the rule is testable without the network.
//   oos12 / oos24: { samples, netBps } from the scoreboard exit grades
//   paper12 / paper24: paperArm(...) results for the control and the 24h arm
export function decideHold({ oos12, oos24, paper12, paper24 }, rules = RULES) {
  const reasons = [];
  const oosReady = (oos12?.samples ?? 0) >= rules.minOosTrades && (oos24?.samples ?? 0) >= rules.minOosTrades;
  if (!oosReady) reasons.push(`out-of-sample exits: 12h n=${oos12?.samples ?? 0}, 24h n=${oos24?.samples ?? 0} (need ${rules.minOosTrades} each)`);
  const paperReady = !!(paper12?.usable && paper24?.usable && paper12.trades >= rules.minPaperTrades && paper24.trades >= rules.minPaperTrades);
  if (!paperReady) {
    const d = (p, name) => (!p?.usable ? `${name}: ${p?.why || "unusable"}` : `${name}: ${p.trades} trades`);
    reasons.push(`paper A/B: ${d(paper12, "12h")}, ${d(paper24, "24h")} (need ${rules.minPaperTrades} each)`);
  }
  if (!oosReady || !paperReady) {
    return { decision: "INSUFFICIENT", action: "Keep 12h. Let the window grow and re-run; don't decide on this sample.", reasons };
  }

  const oosEdge = oos24.netBps - oos12.netBps;
  const paperEdge = (paper24.perTrade ?? 0) - (paper12.perTrade ?? 0);
  const oosFor24 = oosEdge >= rules.minEdgeBps;
  const oosFor12 = oosEdge <= -rules.minEdgeBps;
  reasons.push(`out-of-sample net/trade: 24h ${oos24.netBps}bps vs 12h ${oos12.netBps}bps (edge ${oosEdge.toFixed(1)}bps, bar ${rules.minEdgeBps})`);
  reasons.push(`paper net/trade: 24h $${(paper24.perTrade ?? 0).toFixed(2)} vs 12h $${(paper12.perTrade ?? 0).toFixed(2)}`);

  if (oosFor24 && paperEdge > 0) return { decision: "SWITCH_TO_24H", action: "Both independent reads favour 24h. Change the preset's maxHoldHours 12 → 24 (one line in strategyPresets.ts + AXIS_EXITS).", reasons };
  if (oosFor12 && paperEdge < 0) return { decision: "KEEP_12H", action: "Both independent reads favour 12h. Keep the preset as is.", reasons };
  return { decision: "KEEP_12H", action: "The reads disagree or the gap is inside the bar. Keep the control (12h); no change without both reads agreeing.", reasons };
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const API = "https://og.nexustradinglabs.com";
async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json();
}

async function main() {
  const sc = await getJson(`${API}/intel/axis-backtest`);
  const ax = (sc.axes || []).find((a) => a.name === "basis_x_cvd");
  if (!ax) throw new Error("basis_x_cvd missing from the scoreboard");
  const oos12 = ax.exit?.oos ?? null, oos24 = ax.exit24h?.oos ?? null;
  const agents = {};
  for (const [k, addr] of Object.entries(WALLETS)) {
    const a = await getJson(`${API}/agent/${addr}`);
    agents[k] = { cfg: a.config || {}, arm: paperArm(a.state?.paper_agg, a.state?.paper_reset_at) };
  }
  const ev = {};
  for (const h of [12, 24]) { try { ev[h] = await getJson(`${API}/intel/evidence?axis=basis_x_cvd&hold=${h}`); } catch { ev[h] = null; } }

  const out = decideHold({ oos12, oos24, paper12: agents.control12h.arm, paper24: agents.arm24h.arm });
  const line = (s = "") => console.log(s);
  line(`Oct-15 hold decision · Basis × CVD Stack · scoreboard as of ${sc.asOf}`);
  line();
  line(`DECISION: ${out.decision}`);
  line(`  ${out.action}`);
  for (const r of out.reasons) line(`  · ${r}`);
  line();
  line("Context (NOT used for the call; 24h was picked from this in-sample data):");
  line(`  in-sample exit 12h: ${ax.exit?.verdict} ${ax.exit?.netBps}bps n${ax.exit?.samples} · 24h: ${ax.exit24h?.verdict} ${ax.exit24h?.netBps}bps n${ax.exit24h?.samples}`);
  for (const h of [12, 24]) {
    const e = ev[h];
    line(e ? `  evidence ${h}h: ${e.trades}T · ${e.winRate}% · $${e.netUsd} · PF ${e.profitFactor} · vs random ${e.baseline?.pctBeaten}% (${e.baseline?.verdict})` : `  evidence ${h}h: unavailable`);
  }
  const n9 = agents.nineMarket24h.arm;
  line(`  nine-market 24h arm: ${n9.usable ? `${n9.trades}T · $${(n9.net ?? 0).toFixed(2)}` : n9.why} (breadth check, not an A/B arm)`);
  for (const [k, { cfg }] of Object.entries(agents)) {
    if (cfg.takeProfits && cfg.takeProfits.length) line(`  ⚠ ${k} has a takeProfits scale-out set: it trades a different exit than the graded contract`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(`holdDecision: ${e.message}`); process.exit(1); });
}
