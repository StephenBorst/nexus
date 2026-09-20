// ── Strategy identity + what a BACKTEST can actually simulate ─────────────────
// A preset is a COMPOSITION, not just a signalMode: "Regime-Gated Invert" is
// signalMode CONFLUENCE + invertSignal + vol/session conditioning. Naming a run by
// signalMode alone is worse than vague — an INVERTED config takes the OPPOSITE trade,
// so labelling it "CONFLUENCE" describes the trade we are not making. One helper,
// imported by BOTH the worker (backtest/validate notes) and the Lab card, so the label
// can never drift between server and UI.
//
// ⚠️ Pure + dependency-free (app/lib is the shared home workers already import from).

// True when a config layers conditioning gates on top of its raw signal.
function hasGates(config) {
  return !!(config.respectRegime || config.respectSmartMoney
    || (config.minVolAtrPct ?? 0) > 0 || (config.maxVolAtrPct ?? 0) > 0
    || (Array.isArray(config.tradeSessions) && config.tradeSessions.length > 0));
}

// The human name for what this config actually trades.
export function strategyLabel(config = {}) {
  const mode = config.signalMode || "CONFLUENCE";
  if (config.invertSignal) return hasGates(config) ? "Regime-Gated Invert" : `Inverted ${mode}`;
  return hasGates(config) ? `Gated ${mode}` : mode;
}

// Which conditioning gates the SIM honours, and which it silently ignores.
// runBacktest supplies raw.hourUtc + raw.atrPct, so SESSION and VOLATILITY gates run
// exactly as they do live. It does NOT supply a regime or a smart-money consensus
// (we have no historical series for either) and deriveSignal skips those gates when the
// argument is absent — so backtesting a respectRegime config silently tests the
// UN-gated version. maxSignalAgeSec is an exec-latency guard with no meaning in a sim.
// Surface this instead of letting a green number imply a gate that never ran.
export function backtestGateSupport(config = {}) {
  const applied = [], skipped = [];
  if (config.invertSignal) applied.push("invert");
  if (Array.isArray(config.tradeSessions) && config.tradeSessions.length > 0) applied.push("session");
  if ((config.minVolAtrPct ?? 0) > 0 || (config.maxVolAtrPct ?? 0) > 0) applied.push("volatility");
  if ((config.fundingPercentileMin ?? 0) > 0) applied.push("funding-percentile");
  if (config.respectRegime) skipped.push("regime (RISK_ON/RISK_OFF tape)");
  if (config.respectSmartMoney) skipped.push("smart-money consensus");
  if ((config.maxSignalAgeSec ?? 0) > 0) skipped.push("signal-age (live latency guard)");
  return { applied, skipped };
}
