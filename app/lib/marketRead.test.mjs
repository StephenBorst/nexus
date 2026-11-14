// The market drawer's plain read (app/lib/marketRead.mjs). Run: node --test app/lib/marketRead.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { composeMarket, marketCoin, MARKET_READ_FOOTER } from "./marketRead.mjs";

const boards = {
  mispriced: { markets: [{ symbol: "PERP_ETH_USDC", coin: "ETH", markPrice: 1852.3, fundingAnnualPct: 10.97, change24hPct: -5.5, stretched: false, status: "PRICED_FAIR" }] },
  signals: { signals: [{ symbol: "PERP_ETH_USDC", mark_price: 1852, funding_annual_pct: 10.9, oi_change_pct: 2.34, delta_fresh: true }] },
  smart: { consensus: { ETH: { side: "SHORT", count: 10, long: 7, short: 10 }, BTC: { long: 2, short: 12 } } },
  callers: { consensus: { ETH: { side: "SHORT", participants: 1, longCount: 0, shortCount: 1 } } },
  forecasts: { markets: [{ coin: "ETH", forecastProbPct: 30, target: 1500, targetDirection: "DOWN", distancePct: -19, forecastLean: "DOWN", fundingLean: "UP", divergence: true, endDate: "2026-12-31T12:00:00Z", volumeUsd: 1e6 }] },
  catalysts: { catalysts: [{ question: "Will the Fed cut in December?", yesProbPct: 61.2, volumeUsd: 5e6, impacts: [{ coin: "ETH", direction: "LONG" }] }] },
  pulse: { openCalls: [{ symbol: "PERP_ETH_USDC" }], engines: { openCalls: [{ symbol: "ETH" }, { symbol: "BTC" }] } },
};

test("coin names normalize; junk is refused", () => {
  assert.equal(marketCoin("PERP_ETH_USDC"), "ETH");
  assert.equal(marketCoin("eth"), "ETH");
  assert.equal(marketCoin("../etc"), "");
  assert.equal(marketCoin(null), "");
});

test("every lens in plain words, none adds up to a verdict", () => {
  const m = composeMarket({ coin: "eth", ...boards });
  assert.equal(m.coin, "ETH");
  assert.equal(m.price, 1852.3);
  const line = (id) => m.lenses.find((l) => l.id === id)?.line;
  assert.equal(line("funding"), "Longs pay 11.0%/yr, within its own range.");
  assert.equal(line("tape"), "Price −5.5% in 24h, open interest +2.3% since the last check.");
  assert.equal(line("smart"), "10 short · 7 long among tracked traders: split, no clear agreement.");
  assert.equal(line("callers"), "1 graded caller leans short (0 long · 1 short).");
  assert.match(line("forecast"), /^Forecasters give 30% that ETH dips to \$1,500 by Dec 31\. Funding leans up: longs are paying to hold\. The two disagree\.$/);
  assert.equal(line("catalysts"), "1 world event maps to ETH. Biggest: \"Will the Fed cut in December?\" at 61% YES, read as long for ETH.");
  assert.equal(line("calls"), "1 by people · 1 by our engines, graded from public price.");
  for (const l of m.lenses) assert.doesNotMatch(l.line, /edge|proven|buy now|sell now|strong (buy|sell)/i, l.id);
  assert.match(MARKET_READ_FOOTER, /not a verdict/);
});

test("clear smart-money agreement says so, still as context", () => {
  const m = composeMarket({ coin: "BTC", ...boards });
  assert.equal(m.lenses.find((l) => l.id === "smart").line, "12 short · 2 long among tracked traders: they agree, short. Context, not a graded read.");
});

test("a stretched market names the fade as an ungraded rule", () => {
  const m = composeMarket({ coin: "NVDA", mispriced: { markets: [{ coin: "NVDA", fundingAnnualPct: 21.01, stretched: true }] } });
  const f = m.lenses.find((l) => l.id === "funding");
  assert.equal(f.line, "Longs pay 21.0%/yr, stretched past its own range. The fade (short) is a mechanical rule, not graded yet.");
  assert.equal(f.tone, "watch");
});

test("a forecast's end date is the day the market names (New York close), not the UTC date", () => {
  const m = composeMarket({ coin: "BTC", forecasts: { markets: [{ coin: "BTC", forecastProbPct: 71, target: 65000, targetDirection: "DOWN", distancePct: -3, forecastLean: "DOWN", fundingLean: "UP", divergence: true, endDate: "2027-01-01T04:59:00Z", volumeUsd: 1 }] } });
  assert.match(m.lenses.find((l) => l.id === "forecast").line, /by Dec 31\./);
});

test("a move that rounds to zero reads flat, never −0.0%", () => {
  const m = composeMarket({ coin: "ETH", mispriced: { markets: [{ coin: "ETH", change24hPct: -6.2, fundingAnnualPct: 5 }] }, signals: { signals: [{ symbol: "PERP_ETH_USDC", oi_change_pct: -0.04, delta_fresh: true }] } });
  assert.equal(m.lenses.find((l) => l.id === "tape").line, "Price −6.2% in 24h, open interest flat since the last check.");
});

test("missing boards read as unread or absent, never invented", () => {
  const m = composeMarket({ coin: "SOL" });
  assert.deepEqual(m.lenses.map((l) => l.id), ["funding", "smart"]);
  assert.equal(m.lenses[0].line, "Unread right now.");
  assert.equal(m.price, null);
  // OI from a stale snapshot is left out.
  const stale = composeMarket({ coin: "ETH", signals: { signals: [{ symbol: "PERP_ETH_USDC", oi_change_pct: 9, delta_fresh: false }] } });
  assert.ok(!stale.lenses.some((l) => l.id === "tape"));
});
