import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { rankConviction, leanWord, FADE_FUNDING_FLOOR_PCT_YR } from "./conviction.mjs";

test("rankConviction drops sub-floor funding — a trivial band is not a fade candidate", () => {
  const markets = [
    { coin: "HYPE", direction: "LONG", fundingAnnualPct: -27 },  // real fade
    { coin: "ZEC", direction: "LONG", fundingAnnualPct: -0.66 }, // trivial → filtered
    { coin: "SOL", direction: "LONG", fundingAnnualPct: -4.86 }, // under 10% → filtered
  ];
  const coins = rankConviction(markets, {}, {}).map((r) => r.coin);
  assert.ok(coins.includes("HYPE"));
  assert.ok(!coins.includes("ZEC"));
  assert.ok(!coins.includes("SOL"));
  assert.equal(FADE_FUNDING_FLOOR_PCT_YR, 10);
});

test("ordered by how stretched funding is, never by how many inputs agree; each input keeps its own side", () => {
  const markets = [
    { coin: "PERP_BTC_USDC", direction: "SHORT", fundingAnnualPct: 40 },
    { coin: "ETH", direction: "SHORT", fundingAnnualPct: 80 },
    { coin: "SOL", direction: "LONG", fundingAnnualPct: -30, edgeQuality: { revertedPct: 38, samples: 13, tier: "TRAP" } },
  ];
  const sm = { BTC: { side: "SHORT" }, SOL: { side: "SHORT" } };
  const callers = { BTC: { side: "SHORT" } };
  const ranked = rankConviction(markets, sm, callers);
  assert.deepEqual(ranked.map((r) => r.coin), ["ETH", "BTC", "SOL"], "funding first, BTC's two agreeing inputs don't lift it");
  assert.equal(ranked[1].extra, 2);
  const sol = ranked.find((r) => r.coin === "SOL");
  assert.equal(sol.against, 1);
  assert.equal(sol.revertedPct, 38);
  assert.equal(sol.samples, 13);
  assert.equal(leanWord(sol.reads[1]), "Smart money short");
});

test("the scanner shows inputs and the fade's own grade, no conviction word, no tally", () => {
  const src = readFileSync(new URL("../pages/lab/ConvictionScanner.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /convictionLevel|HIGH|MODERATE|CONFLICTED|UNPROVEN|✓|✗|Ranked by how many/);
  assert.match(src, /useFadeFamilyGrade/);
  assert.match(src, /openMarket\(r\.coin\)/);
});
