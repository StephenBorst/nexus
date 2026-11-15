// The Lab's tape strip (MarketTape.tsx): the market-wide inputs, side by side, never a score.
// See the component's header for what it replaced.

/** 24h % change from Orderly's open/close; a bad tick (> 50%) or a missing price reads 0. */
export function change24h(open, close) {
  const o = parseFloat(String(open ?? 0)); const c = parseFloat(String(close ?? 0));
  if (!o || !c) return 0;
  const p = ((c - o) / o) * 100;
  return Math.abs(p) > 50 ? 0 : p;
}

/**
 * rows = Orderly /v1/public/futures rows. Returns null with nothing to read, else
 * { markets, up, btcChg, fundPos, fundN }: counts and one price move. No score, no label.
 */
export function tapeInputs(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const changes = rows.map((m) => change24h(m["24h_open"], m["24h_close"]));
  const btc = rows.find((m) => m.symbol === "PERP_BTC_USDC");
  const fundings = rows.map((m) => parseFloat(String(m.last_funding_rate ?? ""))).filter((f) => Number.isFinite(f));
  return {
    markets: rows.length,
    up: changes.filter((c) => c > 0).length,
    btcChg: btc ? change24h(btc["24h_open"], btc["24h_close"]) : 0,
    fundPos: fundings.filter((f) => f > 0).length,
    fundN: fundings.length,
  };
}

/** What the strip's "ask" sends the copilot: the inputs, and a request not to turn them into a call. */
export function tapeAskPrompt(t) {
  const btc = `${t.btcChg >= 0 ? "+" : ""}${t.btcChg.toFixed(2)}%`;
  return `The tape right now: ${t.up} of ${t.markets} Orderly markets are up on 24h, BTC ${btc}, longs pay funding on ${t.fundPos} of ${t.fundN}. ` +
    "Explain what each of these does and doesn't tell me, and which of our reads are actually graded. Don't add them up into a call.";
}
