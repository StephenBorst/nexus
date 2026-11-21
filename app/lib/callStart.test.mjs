// callStart.mjs: starting points carry no side; the pre-post facts state their lines.
// Run: node --test app/lib/callStart.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { startingPoints, prePostFacts, fundingPast } from "./callStart.mjs";

test("starting points: watchlist, past a funding line (by how far), callers on it; listed only; no side", () => {
  const g = startingPoints({
    watch: ["eth", "PERP_SOL_USDC", "NOTLISTED"],
    markets: [
      { coin: "RAY", funding8hPct: -0.016 },            // inside both lines
      { coin: "DOGE", funding8hPct: 0.12 },             // 1.5× past
      { coin: "WIF", funding8hPct: -0.09 },             // 3× past
      { coin: "BTC", funding8hPct: null },
    ],
    openCalls: [{ symbol: "BTC" }, { symbol: "BTC", engine: true }, { symbol: "ZEC", engine: true }, { symbol: "HYPE" }],
    listed: ["ETH", "SOL", "RAY", "DOGE", "WIF", "BTC", "ZEC", "HYPE"],
  });
  assert.deepEqual(g.map((x) => x.key), ["yours", "funding", "callers"]);
  assert.deepEqual(g[0].chips.map((c) => c.coin), ["ETH", "SOL"]);
  assert.deepEqual(g[1].chips.map((c) => c.coin), ["WIF", "DOGE"]);
  assert.equal(g[1].chips[0].fact, "shorts pay −0.090% / 8h");
  assert.equal(g[2].chips[0].coin, "BTC");
  assert.equal(g[2].chips[0].fact, "1 person · 1 engine open");
  const text = JSON.stringify(g);
  assert.doesNotMatch(text, /\b(LONG|SHORT|buy|sell|fade)\b/i, "a chip never names a side");
  assert.deepEqual(startingPoints({}), []);
  assert.equal(fundingPast(0.05), null);
});

test("pre-post: stop vs ATR with its stated lines", () => {
  const tight = prePostFacts({ direction: "LONG", entry: 100, stop: 99.5, atrPct: 1 });
  assert.match(tight[0].text, /0\.5× the H4 ATR \(1\.00%\): inside one ordinary 4h bar/);
  assert.equal(tight[0].watch, true);
  assert.equal(prePostFacts({ direction: "LONG", entry: 100, stop: 98.8, atrPct: 1 })[0].watch, false);
  assert.equal(prePostFacts({ direction: "LONG", entry: 100, stop: 95, atrPct: 1 })[0].watch, true);
});

test("pre-post: filled at the post vs resting, the grader's 0.3% rule", () => {
  const at = prePostFacts({ direction: "LONG", entry: 100.2, stop: 98, mark: 100 }).find((f) => f.key === "fill");
  assert.match(at.text, /counts as filled when you post/);
  const brk = prePostFacts({ direction: "LONG", entry: 101, stop: 98, mark: 100 }).find((f) => f.key === "fill");
  assert.match(brk.text, /1\.00% above the mark, a breakout entry/);
  const lim = prePostFacts({ direction: "SHORT", entry: 101, stop: 103, mark: 100 }).find((f) => f.key === "fill");
  assert.match(lim.text, /a resting limit/);
});

test("pre-post: margin at the stated leverage; the trader's own record on the coin", () => {
  const f = prePostFacts({ direction: "LONG", entry: 100, stop: 96, leverage: 20, symbol: "eth", myCalls: [
    { symbol: "ETH", gradedOutcome: "WIN", gradedR: 1.5 }, { symbol: "ETH", gradedOutcome: "LOSS", gradedR: -1 }, { symbol: "ETH" }, { symbol: "BTC", gradedOutcome: "WIN", gradedR: 2 },
  ] });
  const m = f.find((x) => x.key === "margin");
  assert.equal(m.text, "At 20× the stop costs 80% of the margin.");
  assert.equal(m.watch, true);
  assert.equal(f.find((x) => x.key === "record").text, "Your graded ETH calls: 2 · 1 won · +0.50R net.");
  assert.match(prePostFacts({ direction: "LONG", entry: 1, stop: 0.9, symbol: "SOL" }).find((x) => x.key === "record").text, /No graded SOL calls/);
  assert.deepEqual(prePostFacts({ direction: "LONG", entry: 0, stop: 1 }), []);
});

test("no advice words in either rule", () => {
  const src = readFileSync(new URL("./callStart.mjs", import.meta.url), "utf8").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\b(should|recommend|proven|edge|good trade|bad trade)\b/i);
});
