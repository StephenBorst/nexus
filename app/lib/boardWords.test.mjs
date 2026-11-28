// The Board's phone rows in plain words (app/lib/boardWords.mjs). Run: node --test app/lib/boardWords.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fundingWords, otherReadsLine, sideRecordLine, trendWords, TREND_WINDOW } from "./boardWords.mjs";
import { REGIME } from "../../workers/nexus-lab-api/logic.mjs";

test("funding says who pays", () => {
  assert.equal(fundingWords(10.83), "longs pay 10.8%/yr");
  assert.equal(fundingWords(-4.12), "shorts pay 4.1%/yr");
  assert.equal(fundingWords(0.01), "funding flat");
  assert.equal(fundingWords(null), "—");
  assert.equal(fundingWords(NaN), "—");
});

test("the other reads are listed, never counted (no '3 of 4 agree', no confluence)", () => {
  assert.equal(otherReadsLine({ callers: "LONG", smart: "SHORT", catalyst: null, forecast: "SHORT" }), "callers long · smart money short · forecasts short");
  assert.equal(otherReadsLine({ callers: null, smart: null }), null);
  assert.equal(otherReadsLine(null), null);
});

test("your record on a side: a count, from 5 trades, never a verdict", () => {
  const t = (direction, pnl) => ({ direction, pnl });
  assert.equal(sideRecordLine([t("SHORT", 1), t("SHORT", -1), t("SHORT", 2), t("SHORT", 3)], "SHORT"), null, "4 trades is too few");
  assert.equal(sideRecordLine([t("SHORT", 1), t("SHORT", -1), t("SHORT", 2), t("SHORT", 3), t("SHORT", 0), t("LONG", 9)], "SHORT"), "your shorts: 3 of 5 won");
  assert.equal(sideRecordLine([], null), null);
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
  assert.match(src, /otherReadsLine\(r\.lens\)/);
  assert.doesNotMatch(src, /\bagree\b/, "no count of ungraded reads anywhere on the board");
  assert.doesNotMatch(src, /confluence/i);
  assert.doesNotMatch(src, /RISK-OFF|RISK-ON|computeTape/, "no risk-on / risk-off score");
  assert.doesNotMatch(src, /independent reads confirm/, "no machine claim written into a drafted call");
  assert.doesNotMatch(src, /d === "LONG" \? C\.pos : d === "SHORT" \? C\.neg/, "a side is not money");
  assert.match(src, /trendWords\(r\.trend, r\.trendMove\)/);
});

test("call side pickers are ink, not money colours (market table, Thesis Engine)", () => {
  const table = readFileSync(new URL("../pages/lab/MarketTable.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(table, /side === "LONG" \? C\.pos : C\.neg/);
  const thesis = readFileSync(new URL("../pages/lab/ThesisView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(thesis, /d === "LONG" \? "#3ecf8e" : "#f7525f"/);
  assert.doesNotMatch(thesis, /form\.direction === "LONG" \? "#3ecf8e" : "#f7525f"/);
});
