// ── Strategy validation + OI-history loading ──
// Shared infrastructure (migration rules in shared.mjs): loadOiHistForBacktest feeds
// the backtest/sweep routes still in index.js, and revalidateStrategy is driven both
// by the publish toggle there and by the self-heal pass in routes-agents.mjs. Neither
// belongs to a single route family, so it lives here rather than being duplicated.
//
// ⚠️ Pure move — logic byte-identical to what shipped.
import { walkForwardValidate, oiSeriesInfo, histSeriesInfo } from "./backtest.mjs";

// ── OI-history loader for backtests ───────────────────────────────────────────
// CONFLUENCE / OI_ONLY need the brain's recorded oi:hist:{symbol} series (Orderly has no
// OI history endpoint). This reads it for the given symbols and reports, PER SYMBOL,
// whether coverage is deep enough to trust an OI backtest.
//
// ⚠️ Maturity is per-symbol ON PURPOSE. It used to be min(days)/min(samples) across every
// requested symbol, which meant ONE never-recorded symbol zeroed the whole gate: the brain
// only logs oi:hist for core BTC/ETH/SOL + whatever users watchlist, so /agent/validate's
// fixed 6-symbol universe (which includes BNB/XRP/LINK) reported "0/14d · still maturing"
// while /agent/backtest reported the SAME config testable over 81d off the config's own
// symbols. Same session, same wallet, two verdicts. Now each symbol clears the bar on its
// own coverage and callers run the mature subset instead of failing the whole run.
export const OI_BACKTEST_MIN_DAYS = 14, OI_BACKTEST_MIN_SAMPLES = 200;

// One symbol's own coverage verdict.
export function oiSymbolMature(info) {
  return !!info && info.days >= OI_BACKTEST_MIN_DAYS && info.samples >= OI_BACKTEST_MIN_SAMPLES;
}

// "BTC 81d/1943 · BNB 0d/0" — the per-symbol truth behind a gate verdict, so a user can
// see WHICH market is short rather than a bare "0/14d".
export const shortSymbol = (s) => String(s).replace("PERP_", "").replace("_USDC", "");
export function oiCoverageText(infos) {
  return (infos || []).map((i) => `${shortSymbol(i.symbol)} ${i.days}d/${i.samples}`).join(" · ");
}
export const shortSymbols = (arr) => (arr || []).map(shortSymbol).join(", ");

export async function loadOiHistForBacktest(symbols, env) {
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  const oiHistBySymbol = {};
  const perSymbol = [];
  for (const s of symbols) {
    let rows = [];
    try { const raw = await AGENT_KV.get(`oi:hist:${s}`); rows = raw ? JSON.parse(raw) : []; } catch { /* absent → thin */ }
    oiHistBySymbol[s] = rows;
    const info = { symbol: s, ...oiSeriesInfo(rows) };
    perSymbol.push({ ...info, mature: oiSymbolMature(info) });
  }
  const matureSymbols = perSymbol.filter((i) => i.mature).map((i) => i.symbol);
  const staleSymbols = perSymbol.filter((i) => !i.mature).map((i) => i.symbol);
  // Hand the ENGINE only the mature series, so a symbol we never recorded can't slip in
  // as a thin/─empty series and read like a real (but silent) OI history.
  const oiHistMature = {};
  for (const s of matureSymbols) oiHistMature[s] = oiHistBySymbol[s];
  const minDays = perSymbol.length ? Math.min(...perSymbol.map((i) => i.days)) : 0;
  const minSamples = perSymbol.length ? Math.min(...perSymbol.map((i) => i.samples)) : 0;
  const maxDays = perSymbol.length ? Math.max(...perSymbol.map((i) => i.days)) : 0;
  return {
    oiHistBySymbol, oiHistMature, perSymbol, matureSymbols, staleSymbols,
    anyMature: matureSymbols.length > 0,
    // The shallowest window among the symbols we will actually run — the honest
    // "tested over Nd" number (never the deepest symbol's, never a stale symbol's 0).
    matureMinDays: matureSymbols.length ? Math.min(...perSymbol.filter((i) => i.mature).map((i) => i.days)) : 0,
    // STRICT (every requested symbol mature) — kept for callers that need all-or-nothing.
    oiMature: perSymbol.length > 0 && staleSymbols.length === 0,
    gate: { minDays, minSamples, maxDays, perSymbol },
  };
}

// Walk-forward validate a PUBLISHED strategy and stamp the verdict onto its record —
// the community board's trust badge. Run in the background (ctx.waitUntil) at publish
// so the toggle stays snappy. Server-computed (never client-supplied) since it's a
// trust signal. CONFLUENCE/OI_ONLY stay "pending_oi" until recorded OI matures.
export const VALIDATE_UNIVERSE = ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC", "PERP_BNB_USDC", "PERP_XRP_USDC", "PERP_LINK_USDC"];
// Cross-market breadth is the POINT of a walk-forward — a config that only works on one
// market is exactly what this is built to fail. So an OI run needs at least two mature
// markets; with one, robustnessVerdict would hand out "ROBUST" off a single symbol.
export const MIN_VALIDATE_SYMBOLS = 2;
export async function revalidateStrategy(address, stratId, config, env) {
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  let validation;
  try {
    if (config.signalMode === "BASIS_FADE") {
      // Basis replays off recorded basis (+ confirm) history — validate the mature markets
      // over the window that history covers; too few markets ⇒ pending, never a fake verdict.
      const flow = await loadFlowHistForBacktest(VALIDATE_UNIVERSE, env, { needCvd: config.basisConfirm === "CVD", needSmart: config.basisConfirm === "SMART", needLiq: config.basisConfirm === "LIQ" });
      if (flow.matureSymbols.length < MIN_VALIDATE_SYMBOLS) {
        validation = { status: "pending_basis", note: `awaiting basis history (${flow.matureSymbols.length}/${MIN_VALIDATE_SYMBOLS} markets with ${BASIS_BACKTEST_MIN_DAYS}d+ recorded)`, checkedAt: Date.now() };
      } else {
        const r = await walkForwardValidate(config, { symbols: flow.matureSymbols, days: Math.max(14, Math.min(60, flow.windowDays)), folds: 4 }, {}, flow.flowBySymbol);
        validation = { status: "done", verdict: r.verdict, posSymbols: r.posSymbols, totalSymbols: r.totalSymbols, foldConsistency: r.foldConsistency, totalNet: r.totalNet, validatedAt: Date.now() };
      }
    } else {
      const needsOi = ["CONFLUENCE", "OI_ONLY"].includes(config.signalMode);
      const oi = needsOi ? await loadOiHistForBacktest(VALIDATE_UNIVERSE, env) : null;
      // Run the symbols that actually HAVE mature recorded OI, not the whole fixed universe
      // (BNB/XRP/LINK are only logged when a user watchlists them, and a single unrecorded
      // symbol used to pin every published CONFLUENCE strategy at "pending_oi" forever).
      const runSymbols = needsOi ? oi.matureSymbols : VALIDATE_UNIVERSE;
      if (needsOi && runSymbols.length < MIN_VALIDATE_SYMBOLS) {
        validation = { status: "pending_oi", note: `awaiting OI history (${runSymbols.length}/${MIN_VALIDATE_SYMBOLS} markets with ${OI_BACKTEST_MIN_DAYS}d+ recorded OI)`, checkedAt: Date.now() };
      } else {
        const r = await walkForwardValidate(config, { symbols: runSymbols, days: 60, folds: 4 }, needsOi ? oi.oiHistMature : {});
        validation = { status: "done", verdict: r.verdict, posSymbols: r.posSymbols, totalSymbols: r.totalSymbols, foldConsistency: r.foldConsistency, totalNet: r.totalNet, validatedAt: Date.now() };
      }
    }
  } catch { validation = { status: "error", checkedAt: Date.now() }; }
  // Re-read latest before patching so a concurrent save/publish isn't clobbered.
  const key = `agent:strategies:${address}`;
  const raw = await AGENT_KV.get(key);
  if (!raw) return;
  let list; try { list = JSON.parse(raw); } catch { return; }
  const s = list.find((x) => x.id === stratId);
  if (!s) return;
  s.validation = validation;
  await AGENT_KV.put(key, JSON.stringify(list));
}

// ── Basis-stack history loader for backtests ─────────────────────────────────
// BASIS_FADE replays off RECORDED series only (Orderly has no basis/CVD/smart-money
// history): basis:hist:{BARE} + (CVD confirm) cvd:hist:{BARE} + oi:hist:{PERP} price
// spine + (SMART confirm) sm:hist:{BARE} — all in the NEXUS_AGENT namespace the
// scoreboard and the brain read. Maturity is per-symbol, like OI: the basis series must
// clear the bar, and so must the confirm series the config actually uses. A market that
// doesn't qualify is excluded and NAMED, never run as a silent zero. `windowDays` = the
// shallowest mature coverage, so callers can size the replay to data that exists (folds
// over empty pre-history would read as losing folds).
export const BASIS_BACKTEST_MIN_DAYS = 14, BASIS_BACKTEST_MIN_SAMPLES = 200;
export function flowSymbolMature(info) {
  return !!info && info.days >= BASIS_BACKTEST_MIN_DAYS && info.samples >= BASIS_BACKTEST_MIN_SAMPLES;
}
export async function loadFlowHistForBacktest(symbols, env, { needCvd = false, needSmart = false, needLiq = false } = {}) {
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;
  const read = async (key) => { try { const r = await AGENT_KV.get(key); return r ? JSON.parse(r) : []; } catch { return []; } };
  const flowBySymbol = {}, perSymbol = [];
  for (const s of symbols) {
    const bare = shortSymbol(s);
    const [basisHist, cvdHist, oiHist, smHist, liqHist] = await Promise.all([
      read(`basis:hist:${bare}`),
      needCvd ? read(`cvd:hist:${bare}`) : [],
      needCvd ? read(`oi:hist:${s}`) : [],
      needSmart ? read(`sm:hist:${bare}`) : [],
      needLiq ? read(`liq:hist:${bare}`) : [],
    ]);
    const basis = histSeriesInfo(basisHist);
    // The binding constraint is the thinnest series this config needs.
    const infos = [basis, ...(needCvd ? [histSeriesInfo(cvdHist)] : []), ...(needSmart ? [histSeriesInfo(smHist)] : []), ...(needLiq ? [histSeriesInfo(liqHist)] : [])];
    const days = Math.min(...infos.map((i) => i.days)), samples = Math.min(...infos.map((i) => i.samples));
    const mature = infos.every(flowSymbolMature);
    perSymbol.push({ symbol: s, days, samples, mature, basisDays: basis.days });
    if (mature) flowBySymbol[s] = { basisHist, cvdHist, oiHist, smHist, liqHist };
  }
  const matureSymbols = perSymbol.filter((i) => i.mature).map((i) => i.symbol);
  return {
    flowBySymbol, perSymbol, matureSymbols,
    staleSymbols: perSymbol.filter((i) => !i.mature).map((i) => i.symbol),
    anyMature: matureSymbols.length > 0,
    windowDays: matureSymbols.length ? Math.min(...perSymbol.filter((i) => i.mature).map((i) => i.days)) : 0,
  };
}
export function flowCoverageText(perSymbol) {
  return (perSymbol || []).map((i) => `${shortSymbol(i.symbol)} ${i.days}d/${i.samples}`).join(" · ");
}
