// The recorded-universe candidate ranking (read-only report; changes nothing recorded).
// Run: node --test workers/nexus-lab-api/universe.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { rankUniverse, RECORDED_COINS, HOLDOUT_COINS, UNIVERSE_RULES } from "./universe.mjs";

const ob = (coin, vol, oiBase, mark) => ({ symbol: `PERP_${coin}_USDC`, "24h_amount": vol, open_interest: oiBase, mark_price: mark });
const sp = (coin, quoteVol) => ({ instId: `${coin}-USDT`, volCcy24h: String(quoteVol) });
const sw = (coin, baseVol, last) => ({ instId: `${coin}-USDT-SWAP`, volCcy24h: String(baseVol), last: String(last) });

test("USD conversions: OKX perp volume is base × last, Orderly OI is base × mark", () => {
  const r = rankUniverse({
    orderlyRows: [ob("AAA", 2e6, 1000, 1000)],
    okxSpot: [sp("AAA", 6e6)],
    okxSwap: [sw("AAA", 30000, 1000)],
    recorded: [],
  });
  const a = r.rows[0];
  assert.equal(a.okxSwapVolUsd, 30_000_000);
  assert.equal(a.orderlyOiUsd, 1_000_000);
  assert.equal(a.okxSpotVolUsd, 6_000_000);
  assert.equal(a.pass, true);
  assert.deepEqual(r.newPassing, ["AAA"]);
});

test("every leg must clear its floor, and the failing legs are named", () => {
  const r = rankUniverse({
    orderlyRows: [ob("THIN", 30_000, 10, 1), ob("OK", 5e6, 1e6, 1)],
    okxSpot: [sp("THIN", 1e6), sp("OK", 1e7)],
    okxSwap: [sw("THIN", 1e6, 1), sw("OK", 5e7, 1)],
    recorded: [],
  });
  const thin = r.rows.find((x) => x.coin === "THIN");
  assert.equal(thin.pass, false);
  assert.deepEqual(thin.fails, ["OKX spot volume", "OKX perp volume", "Orderly volume", "Orderly open interest"]);
  assert.deepEqual(r.passing, ["OK"]);
});

test("a coin missing on either OKX market is unmatched, never guessed", () => {
  const r = rankUniverse({
    orderlyRows: [ob("1000PEPE", 1e8, 1e9, 0.01), ob("NOSPOT", 1e8, 1e9, 1)],
    okxSpot: [sp("PEPE", 1e9)],
    okxSwap: [sw("PEPE", 1e12, 1e-5), sw("NOSPOT", 1e9, 1)],
    recorded: [],
  });
  assert.equal(r.rows.length, 0);
  assert.deepEqual(r.unmatched, ["1000PEPE (no OKX spot or perp)", "NOSPOT (no OKX spot)"]);
});

test("ordered by the weakest leg; already-recorded coins are flagged, not counted as new", () => {
  const r = rankUniverse({
    orderlyRows: [ob("BTC", 5e8, 1e4, 1e5), ob("MID", 2e6, 1e6, 1), ob("BIG", 2e7, 1e7, 1)],
    okxSpot: [sp("BTC", 1e9), sp("MID", 1e7), sp("BIG", 1e8)],
    okxSwap: [sw("BTC", 1e5, 1e5), sw("MID", 4e7, 1), sw("BIG", 4e8, 1)],
  });
  assert.deepEqual(r.rows.map((x) => x.coin), ["BTC", "BIG", "MID"]);
  assert.equal(r.rows[0].recorded, true);
  assert.deepEqual(r.newPassing, ["BIG", "MID"]);
  assert.ok(r.rows.every((x) => typeof x.weakestLegX === "number"));
});

test("non-USDC and malformed rows are ignored", () => {
  const r = rankUniverse({ orderlyRows: [{ symbol: "SPOT_BTC_USDC" }, { symbol: null }, {}], okxSpot: [], okxSwap: [] });
  assert.deepEqual(r.rows, []);
});

test("the recorded list is the recorder's nine, and the floors are the signed-off ones", () => {
  assert.deepEqual([...RECORDED_COINS], ["BTC", "ETH", "SOL", "BNB", "XRP", "LINK", "DOGE", "AVAX", "HYPE"]);
  assert.deepEqual({ ...UNIVERSE_RULES }, { minOkxSpotUsd: 5e6, minOkxSwapUsd: 2e7, minOrderlyVolUsd: 4e4, minOrderlyOiUsd: 3e4, maxPriceGapPct: 2 });
});

test("same ticker, different price → unmatched, never guessed", () => {
  const r = rankUniverse({
    orderlyRows: [ob("SAME", 5e6, 1e6, 1.01), ob("DIFF", 5e6, 1e6, 1)],
    okxSpot: [sp("SAME", 1e7), sp("DIFF", 1e7)],
    okxSwap: [sw("SAME", 5e7, 1), sw("DIFF", 5e7, 0.5)],
    recorded: [],
  });
  assert.deepEqual(r.rows.map((x) => x.coin), ["SAME"]);
  assert.equal(r.rows[0].priceGapPct, 1);
  assert.deepEqual(r.unmatched, ["DIFF (price gap 100.0% vs OKX)"]);
});

test("holdout coins are flagged, never counted as new, and named when they drop under a floor", () => {
  const r = rankUniverse({
    orderlyRows: [ob("ZEC", 3e5, 3e5, 1), ob("ZRO", 20_000, 3e4, 1)],
    okxSpot: [sp("ZEC", 8e7), sp("ZRO", 7e6)],
    okxSwap: [sw("ZEC", 1e9, 1), sw("ZRO", 3e7, 1)],
  });
  assert.deepEqual(r.newPassing, []);
  assert.ok(r.rows.every((x) => x.holdout === true));
  assert.deepEqual(r.holdoutFailing, HOLDOUT_COINS.filter((c) => c !== "ZEC"), "ZRO under a floor; the rest absent from this tape");
  assert.ok(HOLDOUT_COINS.includes("ZEC"));
});
