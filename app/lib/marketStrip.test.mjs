// app/lib/marketStrip.mjs + the drawer's facts. Run: node --test app/lib/marketStrip.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { marketStrip } from "./marketStrip.mjs";
import { composeMarket } from "./marketRead.mjs";

test("the drawer's answer carries the inputs as numbers (facts), the same ones its lines say", () => {
  const m = composeMarket({
    coin: "ETH",
    mispriced: { markets: [{ coin: "ETH", fundingAnnualPct: 21.01, stretched: true, change24hPct: -5.86, markPrice: 1836 }] },
    signals: { signals: [{ symbol: "PERP_ETH_USDC", oi_change_pct: -0.04, delta_fresh: true }] },
    smart: { consensus: { ETH: { long: 5, short: 12 } } },
  });
  assert.deepEqual(m.facts, { fundAnnual: 21.01, stretched: true, smartLong: 5, smartShort: 12, smartClear: "SHORT", oiChangePct: -0.04 });
  assert.deepEqual(marketStrip(m), [
    { label: "Funding", text: "longs pay 21.0%/yr, stretched", tone: "watch" },
    { label: "Smart money", text: "12 short · 5 long, agree short", tone: "plain" },
    { label: "Tape", text: "−5.9% 24h · OI flat", tone: "plain" },
  ]);
});

test("a split, an unread board, a quiet market", () => {
  const split = marketStrip({ facts: { fundAnnual: -4, stretched: false, smartLong: 7, smartShort: 10, smartClear: "NONE", oiChangePct: null }, change24hPct: null });
  assert.deepEqual(split.map((x) => x.text), ["shorts pay 4.0%/yr", "10 short · 7 long"]);
  assert.deepEqual(marketStrip({ facts: { fundAnnual: null, stretched: null, smartLong: null, smartShort: null, smartClear: null, oiChangePct: null } }), []);
  assert.deepEqual(marketStrip(null), []);
  for (const s of split) assert.doesNotMatch(s.text, /edge|buy|sell|signal/i);
});

test("the trade page mounts it under the LAB strip and opens the drawer from it", () => {
  const layout = readFileSync(new URL("../pages/perp/Layout.tsx", import.meta.url), "utf8");
  assert.match(layout, /<MarketStripBar \/>/);
  const bar = readFileSync(new URL("../components/MarketStripBar.tsx", import.meta.url), "utf8");
  assert.match(bar, /\/intel\/market\//);
  assert.match(bar, /openMarket\(coin\)/);
});
