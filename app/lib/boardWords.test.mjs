// The Board's phone rows in plain words (app/lib/boardWords.mjs). Run: node --test app/lib/boardWords.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fundingWords, agreeWords, trendWords, TREND_WINDOW } from "./boardWords.mjs";
import { REGIME } from "../../workers/nexus-lab-api/logic.mjs";

test("funding says who pays", () => {
  assert.equal(fundingWords(10.83), "longs pay 10.8%/yr");
  assert.equal(fundingWords(-4.12), "shorts pay 4.1%/yr");
  assert.equal(fundingWords(0.01), "funding flat");
  assert.equal(fundingWords(null), "—");
  assert.equal(fundingWords(NaN), "—");
});

test("'1/4' becomes a sentence", () => {
  assert.equal(agreeWords(1, true), "1 of 4 reads agree".replace("reads agree", "read agrees"));
  assert.equal(agreeWords(3, true), "3 of 4 reads agree");
  assert.equal(agreeWords(0, true), "0 of 4 reads agree");
  assert.equal(agreeWords(9, true), "4 of 4 reads agree");
  assert.equal(agreeWords(2, false), "no play");
});

test("the trend names its window, and the window is the server's", () => {
  assert.deepEqual(trendWords("TREND_DOWN", -7.24), { text: "↓ down 7.2% over 2 days", tone: "neg" });
  assert.deepEqual(trendWords("TREND_UP", 3), { text: "↑ up 3.0% over 2 days", tone: "pos" });
  assert.deepEqual(trendWords("CHOP", 1.1), { text: "no clear trend over 2 days", tone: "faint" });
  assert.equal(REGIME.LOOKBACK, 48, "1h candles: 48 = 2 days");
  assert.equal(TREND_WINDOW, "2 days");
});

test("the Board's phone rows use the plain words", () => {
  const src = readFileSync(new URL("../pages/lab/DecisionBoard.tsx", import.meta.url), "utf8");
  assert.match(src, /fundingWords\(r\.fundingAnnual\)/);
  assert.match(src, /agreeWords\(r\.agree, !!r\.play\.dir\)/);
  assert.match(src, /trendWords\(r\.trend, r\.trendMove\)/);
});
