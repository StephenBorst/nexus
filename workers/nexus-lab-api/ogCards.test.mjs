// The brand rule, enforced on every share card (docs/brand.md):
//   black surfaces · bone type · a bone accent mark · green/red ONLY on money.
// Each card is rendered with fixtures that exercise its branches; any colour outside
// app/lib/brand.mjs fails, a card without the bone top rule fails, and green/red on a
// card that shows no money figure fails. Three cards drifted back to the retired neon
// palette because nothing checked them — this is the check.
// Run: node --test workers/nexus-lab-api/ogCards.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND, moneyColor } from "../../app/lib/brand.mjs";
import { buildBoardOgSvg, buildReadOgSvg, buildIdentitySvg, buildThesisOgSvg } from "./ogCards.mjs";
import { buildXrayCardSvg } from "./routes-xrayshare.mjs";

const ALLOWED = new Set(Object.values(BRAND).map((c) => c.toLowerCase()));
const colours = (svg) => [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());
const W = "0x9a3012988d60d61b34660be06a321f7bf7bccb28";

const board = (klass, dir, agree, lens) => ({ coin: "BTC", play: { klass, dir, label: klass === "FADE" ? `FADE ${dir}` : "WATCH", strong: klass === "FADE" }, agree, lens });
const CARDS = {
  "board · rows": buildBoardOgSvg([
    board("FADE", "LONG", 3, { smart: "LONG", catalyst: "LONG", forecast: "LONG" }),
    board("FADE", "SHORT", 1, { smart: "SHORT", catalyst: null, forecast: "LONG" }),
    board("WATCH", null, 0, { smart: null, catalyst: null, forecast: null }),
  ], "2026-09-28 18:41 UTC"),
  "board · empty": buildBoardOgSvg([], ""),
  "read · FADE with smart money": buildReadOgSvg({ coin: "BTC", markPrice: "83,803", verdict: "FADE", direction: "SHORT", fundingAnnualPct: 31.2, hist: { pct: 97, n: 400 }, smartMoney: { side: "SHORT", count: 3 } }),
  "read · WATCH against": buildReadOgSvg({ coin: "ETH", markPrice: "2,410", verdict: "WATCH", direction: "LONG", fundingAnnualPct: -8.1, hist: null, smartMoney: { side: "SHORT", count: 1 } }),
  "identity · cold start": buildIdentitySvg({ profile: { tier: "UNKNOWN", archetype: null, meritRank: null, gradedCalls: 0, reads: [], headline: [] }, record: { calls: 0 }, wallet: W, displayName: "mfer" }),
  "identity · cold start with a record": buildIdentitySvg({ profile: { tier: "UNKNOWN", archetype: null, meritRank: null, gradedCalls: 3, reads: [], headline: [] }, record: { calls: 3, hitRate: 33.3, avgR: -0.2 }, wallet: W, displayName: "mfer" }),
  "identity · established": buildIdentitySvg({ profile: { tier: "ESTABLISHED", archetype: { label: "Trend follower" }, meritRank: { glyph: "◆", title: "Sharp" }, gradedCalls: 33, reads: [{ kind: "REGIME", text: "your edge is real in trends" }], headline: [
    { key: "expectancy", label: "Expectancy", value: "+0.4R", tone: "pos", sub: "per call" },
    { key: "profitFactor", label: "Profit factor", value: "0.8", tone: "neg", sub: "" },
    { key: "plan", label: "Plan quality", value: "71", tone: null, sub: "" },
  ] }, record: { calls: 33, hitRate: 52, avgR: 0.4 }, wallet: W, displayName: "mfer" }),
  "thesis · active long": buildThesisOgSvg({ displayName: "Nexus Signals", wallet: W, ticker: "LINK", direction: "LONG", entryPrice: 15.42, stopLoss: 14.96, takeProfit1: 16.04, riskReward: 1.33, status: "ACTIVE", notes: "funding stretched" }),
  "thesis · won": buildThesisOgSvg({ displayName: "x", wallet: W, ticker: "BTC", direction: "SHORT", entryPrice: 100, stopLoss: 102, takeProfit1: 96, riskReward: 2, status: "HIT_TP", gradedR: 2 }),
  "thesis · lost, invalidated chart layout": buildThesisOgSvg({ displayName: "x", wallet: W, ticker: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 98, takeProfit1: 104, riskReward: 2, status: "STOPPED_OUT", gradedR: -1, chartDataUri: "data:image/png;base64,AA==" }),
  "thesis · invalidated": buildThesisOgSvg({ displayName: "x", wallet: W, ticker: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 98, takeProfit1: 104, riskReward: 2, status: "INVALIDATED" }),
  "xray · graded": buildXrayCardSvg({ status: "GRADED", kind: "HL", who: "0x9a30…cb28", headline: "+$1,204 IN 30D", headlineTone: "pos", context: "Hyperliquid", stats: [
    { label: "NET 30D", value: "+$1,204", tone: "pos" }, { label: "TRADES", value: "41", tone: null }, { label: "WIN RATE", value: "58%", tone: null }, { label: "PF", value: "1.4", tone: null },
  ], partialNote: "tape partial before Aug 2", stamp: "Sep 28 · 18:41 UTC" }),
  "xray · accruing": buildXrayCardSvg({ status: "ACCRUING", kind: "WATCHED", who: "0x9a30…cb28", headline: "WATCHED · ACCRUING", headlineTone: null, context: "Orderly", stats: [
    { label: "NET REALIZED", value: "+$0.00", tone: null }, { label: "GRADED DAYS", value: "0/20", tone: null }, { label: "GREEN DAYS", value: "—", tone: null }, { label: "MAX DRAWDOWN", value: "$0.00", tone: null },
  ], partialNote: null, stamp: "Sep 28 · 18:41 UTC" }),
};

for (const [name, svg] of Object.entries(CARDS)) {
  test(`${name}: only brand colours`, () => {
    const off = [...new Set(colours(svg))].filter((c) => !ALLOWED.has(c));
    assert.deepEqual(off, [], `off-brand colours: ${off.join(", ")}`);
  });
  test(`${name}: carries the bone accent mark (the 3px top rule)`, () => {
    // Bone is also the type colour, so "the card contains bone" proves nothing: check the rule itself.
    const rule = svg.match(/<rect\b[^>]*\bheight="3"[^>]*\bfill="(#[0-9a-fA-F]{6})"/);
    assert.ok(rule, "no 3px top rule");
    assert.equal(rule[1].toLowerCase(), BRAND.brand.toLowerCase(), "top rule is not the brand mark");
  });
}

// Cards that show no money figure must not paint green or red anywhere.
const moneyFree = ["board · rows", "board · empty", "read · FADE with smart money", "read · WATCH against", "identity · cold start", "thesis · active long", "thesis · invalidated", "xray · accruing"];
for (const name of moneyFree) {
  test(`${name}: no green/red (it shows no money)`, () => {
    const c = colours(CARDS[name]);
    assert.ok(!c.includes(BRAND.win) && !c.includes(BRAND.loss), "green/red used on a non-money element");
  });
}

test("green/red land on the money when there is money", () => {
  assert.ok(colours(CARDS["thesis · won"]).includes(BRAND.win));
  assert.ok(colours(CARDS["thesis · lost, invalidated chart layout"]).includes(BRAND.loss));
  assert.ok(colours(CARDS["xray · graded"]).includes(BRAND.win));
  // The identity card's average R is money: red when below zero; the call count is not.
  const id = CARDS["identity · cold start with a record"];
  assert.match(id, new RegExp(`fill="${BRAND.loss}"[^>]*>−0\\.20R<`));
  assert.doesNotMatch(id, new RegExp(`fill="(${BRAND.win}|${BRAND.loss})"[^>]*>3<`));
});

test("a thesis level or a direction is never coloured (only the graded outcome is)", () => {
  const svg = CARDS["thesis · active long"];
  assert.doesNotMatch(svg, new RegExp(`fill="${BRAND.win}"[^>]*>↑ LONG`));
  assert.doesNotMatch(svg, new RegExp(`fill="${BRAND.loss}"[^>]*>\\$14\\.96`));
});

test("moneyColor: green above zero, red below, bone at zero / unknown", () => {
  assert.equal(moneyColor(5), BRAND.win);
  assert.equal(moneyColor(-0.01), BRAND.loss);
  assert.equal(moneyColor(0), BRAND.bright);
  assert.equal(moneyColor("n/a"), BRAND.bright);
});

// brand.mjs is the worker's copy of the brand; theme.ts is the app's. Pin them together.
test("brand.mjs matches app/config/theme.ts value for value", () => {
  const theme = readFileSync(new URL("../../app/config/theme.ts", import.meta.url), "utf8");
  const tok = (re) => { const m = theme.match(re); assert.ok(m, `theme.ts token missing: ${re}`); return m[1].toLowerCase(); };
  const pairs = {
    canvas: /canvas:\s*"(#[0-9a-f]{6})"/i, surface: /\bsurface:\s*"(#[0-9a-f]{6})"/i, panel: /surfaceAlt:\s*"(#[0-9a-f]{6})"/i,
    border: /\bborder:\s*"(#[0-9a-f]{6})"/i, borderStrong: /borderStrong:\s*"(#[0-9a-f]{6})"/i,
    bright: /bright:\s*"(#[0-9a-f]{6})"/i, bone: /\baccent:\s*"(#[0-9a-f]{6})"/i, fog: /\bfog:\s*"(#[0-9a-f]{6})"/i,
    muted: /\bmuted:\s*"(#[0-9a-f]{6})"/i, faint: /\bfaint:\s*"(#[0-9a-f]{6})"/i, brand: /\bbrand:\s*"(#[0-9a-f]{6})"/i,
    win: /\bpos:\s*"(#[0-9a-f]{6})"/i, loss: /\bneg:\s*"(#[0-9a-f]{6})"/i,
  };
  for (const [k, re] of Object.entries(pairs)) assert.equal(BRAND[k].toLowerCase(), tok(re), `BRAND.${k}`);
  // The accent mark is not the warning colour (2026-09-29: amber reads as caution, so the brand
  // left it to C.warn). A mark that looks like a warning would put a caution sign on every card.
  assert.notEqual(BRAND.brand.toLowerCase(), tok(/\bwarn:\s*"(#[0-9a-f]{6})"/i), "brand mark must not be C.warn");
});

// A rank chip is drawn only for a rank the grader gave (borst: no badge is better than a made-up one).
test("identity: no rank, no chip; the record is in parts; third person", () => {
  const cold = CARDS["identity · cold start with a record"];
  assert.ok(!/BUILDING/.test(cold.replace("BUILDING A GRADED RECORD", "")), "placeholder chip text");
  assert.ok(!/stroke="#ededf0" stroke-width="1.5"/i.test(cold), "a chip frame was drawn without a rank");
  assert.match(cold, /3 graded calls · 33% hit · −0.20R avg/);
  assert.match(cold, /graded calls to the caller board/);
  const est = CARDS["identity · established"];
  assert.match(est, /◆ SHARP/);
  assert.match(est, /Their edge is real in trends/);
  assert.ok(!/[Yy]our edge/.test(est));
});
