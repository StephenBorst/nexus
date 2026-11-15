import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  marketFlag, flagLabel, flagLine, flaggedMarkets, lsWords, fundingBreadth, positionUpnl, fundingSide,
} from "./intelTape.mjs";
import { tapeInputs, tapeAskPrompt, change24h } from "./marketTape.mjs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");

test("marketFlag: a stated line, and how far past it", () => {
  assert.deepEqual(marketFlag({ funding: 0.16, oi: 1, volume: 1e6 }).kind, "CROWDED_LONGS");
  assert.equal(marketFlag({ funding: 0.16, oi: 1, volume: 1e6 }).past, 2);
  assert.equal(marketFlag({ funding: -0.06, oi: 1, volume: 1e6 }).kind, "CROWDED_SHORTS");
  assert.equal(marketFlag({ funding: 0.01, oi: 2e6, volume: 1e6 }).kind, "HIGH_CONCENTRATION");
  assert.equal(marketFlag({ funding: 0.01, oi: 1e6, volume: 1e6 }).kind, "ELEVATED_OI");
  assert.equal(marketFlag({ funding: 0.01, oi: 9e5, volume: 5e4 }).kind, "NONE", "a ratio on a dead market is noise");
  assert.equal(marketFlag(null).kind, "NONE");
  assert.equal(flagLabel("nope"), "Nothing stretched");
});

test("flaggedMarkets: furthest past its line first, nothing un-flagged", () => {
  const list = [
    { name: "A", funding: 0.09, oi: 1, volume: 1e6 },   // 1.125× its line
    { name: "B", funding: 0.01, oi: 4.5e6, volume: 1e6 }, // 3× its line
    { name: "C", funding: 0.01, oi: 1, volume: 1e6 },
  ];
  assert.deepEqual(flaggedMarkets(list).map((a) => a.name), ["B", "A"]);
});

test("flagLine states the fact and the line, never advice", () => {
  const lines = [
    flagLine("ETH", { funding: 0.12, oi: 1, volume: 1e6 }),
    flagLine("ETH", { funding: -0.05, oi: 1, volume: 1e6 }),
    flagLine("ETH", { funding: 0, oi: 3e6, volume: 1e6 }),
    flagLine("ETH", { funding: 0, oi: 1e6, volume: 1e6 }),
  ];
  assert.match(lines[0], /Longs pay \+0\.1200% per 8h on ETH, above the 0\.08% line/);
  assert.match(lines[1], /Shorts pay \+0\.0500% per 8h/);
  assert.match(lines[2], /3\.0× the last 24h of volume/);
  for (const l of lines) assert.doesNotMatch(l, /size down|trail|careful|squeeze|watch for|tighten|should/i, l);
});

test("lsWords: what the ratio is, never an event", () => {
  assert.equal(lsWords(1.5), "MORE ACCOUNTS LONG");
  assert.equal(lsWords(0.5), "MORE ACCOUNTS SHORT");
  assert.equal(lsWords(1), "BALANCED");
  assert.equal(lsWords(null), "—");
});

test("fundingBreadth, positionUpnl, fundingSide", () => {
  assert.deepEqual(fundingBreadth([{ funding: 0.01 }, { funding: -0.01 }, { funding: 0 }]), { positive: 1, total: 3 });
  assert.equal(positionUpnl({ position_qty: 2, mark_price: 110, average_open_price: 100 }), 20);
  assert.equal(positionUpnl({ position_qty: -2, mark_price: 110, average_open_price: 100 }), -20);
  assert.equal(positionUpnl({ position_qty: 2, mark_price: 110, unsettled_pnl: 999 }), null, "never the unsettled field");
  assert.equal(fundingSide(1, 0.01), "pays");
  assert.equal(fundingSide(-1, 0.01), "receives");
  assert.equal(fundingSide(-1, -0.01), "pays");
  assert.equal(fundingSide(0, 0.01), null);
});

test("tape: counts and one move, no score; the ask asks not to add them up", () => {
  const rows = [
    { symbol: "PERP_BTC_USDC", "24h_open": 100, "24h_close": 102, last_funding_rate: "0.0001" },
    { symbol: "PERP_ETH_USDC", "24h_open": 100, "24h_close": 99, last_funding_rate: "-0.0001" },
    { symbol: "PERP_X_USDC", "24h_open": 100, "24h_close": 300, last_funding_rate: "x" },
  ];
  const t = tapeInputs(rows);
  assert.deepEqual(t, { markets: 3, up: 1, btcChg: 2, fundPos: 1, fundN: 2 });
  assert.equal(change24h(100, 300), 0, "a bad tick reads 0");
  assert.equal(tapeInputs([]), null);
  assert.match(tapeAskPrompt(t), /Don't add them up into a call/);
  assert.doesNotMatch(JSON.stringify(t), /score|label|RISK/);
});

test("the Intel page and the tape strip carry no score, confidence, made-up liquidations or advice", () => {
  const intel = read("../pages/intel/index.tsx");
  for (const gone of [/computeRegime/, /confidence:/, /CONF:/, /LIQUIDATIONS 24H/, /liqRate/, /LONG FLUSH/, /SHORT SQUEEZE/,
    /Tighten stops/, /Size down/, /unsettled_pnl \?\?/, /The wind is behind longs/, /\(HL\)/, /"CONFIDENCE"|>CONFIDENCE</]) {
    assert.doesNotMatch(intel, gone, String(gone));
  }
  assert.match(intel, /THE TAPE · INPUTS, NOT A VERDICT/);
  assert.match(intel, /positionUpnl\(p\)/);
  assert.match(intel, /flaggedMarkets\(hlAssets/);
  const strip = read("../pages/lab/MarketTape.tsx");
  for (const gone of [/RISK-ON/, /RISK-OFF/, /score/i, /presets favored/, /agent size/]) {
    const code = strip.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.doesNotMatch(code, gone, String(gone));
  }
});

test("/intel and /arena open without the connect-wallet wall", () => {
  const app = read("../App.tsx");
  const m = /const PUBLIC_ROUTES = (\[[^\]]*\])/.exec(app);
  const routes = JSON.parse(m[1]);
  for (const r of ["/token", "/feed", "/proof", "/analyze", "/intel", "/arena"]) assert.ok(routes.includes(r), r);
});
