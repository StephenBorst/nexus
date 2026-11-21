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
  // The strip says it once (visual pass 2026-11-21; was the "THE TAPE · INPUTS, NOT A VERDICT" card).
  assert.match(read("../pages/intel/IntelVisuals.tsx"), /Public inputs\. Nothing graded here\./);
  assert.match(intel, /<IntelStrip /);
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

// ── Visual-first pass (borst 2026-11-21): marks against stated lines, colour = state, nothing summed ──────────
test("percentileState: the stated 85th / 15th lines; unread stays null", async () => {
  const { percentileState, PCT_HIGH, PCT_LOW } = await import("./intelTape.mjs");
  assert.deepEqual([PCT_HIGH, PCT_LOW], [85, 15]);
  assert.deepEqual([85, 84, 50, 16, 15, 0].map(percentileState), ["high", "normal", "normal", "normal", "low", "low"]);
  assert.equal(percentileState(null), null);
  assert.equal(percentileState("x"), null);
});

test("fearGreedMark: a dot on 0–100, 'extreme' only in the source's own words", async () => {
  const { fearGreedMark } = await import("./intelTape.mjs");
  assert.deepEqual(fearGreedMark({ value: 18, label: "Extreme Fear" }), { pos: 18, value: 18, label: "Extreme Fear", extreme: true });
  assert.equal(fearGreedMark({ value: 55, label: "Greed" }).extreme, false);
  assert.equal(fearGreedMark(null), null, "unread is unread, never 0");
});

test("stretchedCount: every market past a line (uncapped), split funding vs OI; breadthMarks one per market", async () => {
  const { stretchedCount, breadthMarks, flaggedMarkets } = await import("./intelTape.mjs");
  const assets = [
    ...Array.from({ length: 10 }, (_, i) => ({ name: `L${i}`, funding: 0.1 + i / 100, oi: 1e6, volume: 5e6 })),
    { name: "S", funding: -0.05, oi: 1e6, volume: 5e6 },
    { name: "OI", funding: 0.01, oi: 4e6, volume: 2e6 },
    { name: "Q", funding: 0.01, oi: 1e6, volume: 5e6 },
  ];
  assert.deepEqual(stretchedCount(assets), { funding: 11, oi: 1, total: 12 });
  assert.equal(flaggedMarkets(assets).length, 8, "the card list stays capped; the count doesn't");
  assert.deepEqual(breadthMarks(assets).filter((m) => m.longsPay).length, 12);
  assert.deepEqual(stretchedCount(null), { funding: 0, oi: 0, total: 0 });
});

test("lineTrack: the number against the line that flagged it, on a fixed 0 → 3×-line track", async () => {
  const { lineTrack, FUNDING_LONGS_PCT } = await import("./intelTape.mjs");
  const long = lineTrack({ funding: 0.2, oi: 1e6, volume: 5e6 });
  assert.deepEqual([long.kind, long.line, long.times, long.side, long.beyond], ["CROWDED_LONGS", FUNDING_LONGS_PCT, 2.5, "longs pay", false]);
  assert.ok(Math.abs(long.nowPos - 83.333) < 0.01 && Math.abs(long.linePos - 33.333) < 0.01);
  const short = lineTrack({ funding: -0.06, oi: 1e6, volume: 5e6 });
  assert.deepEqual([short.kind, short.value, short.line, short.side], ["CROWDED_SHORTS", 0.06, 0.03, "shorts pay"]);
  const far = lineTrack({ funding: 0.5, oi: 1e6, volume: 5e6 });
  assert.deepEqual([far.nowPos, far.beyond], [100, true], "past the end of the track says so, never rescales");
  const oi = lineTrack({ funding: 0.01, oi: 4e6, volume: 2e6 });
  assert.deepEqual([oi.kind, oi.funding, oi.value, oi.line, oi.side], ["HIGH_CONCENTRATION", false, 2, 1.5, null]);
  assert.equal(lineTrack({ funding: 0.01, oi: 1e6, volume: 5e6 }), null);
});

test("ratioMark + fundingPast: the table's OI ÷ volume dot with both lines as ticks; funding coloured only past its line", async () => {
  const { ratioMark, fundingPast } = await import("./intelTape.mjs");
  assert.deepEqual(ratioMark(1.2), { pos: 40, beyond: false, ticks: [30, 50] });
  assert.deepEqual(ratioMark(4).pos, 100);
  assert.equal(ratioMark(4).beyond, true);
  assert.equal(ratioMark(-1), null);
  assert.equal(fundingPast({ funding: 0.09, oi: 1, volume: 1 }), true);
  assert.equal(fundingPast({ funding: 0.01, oi: 4e6, volume: 2e6 }), false, "an OI flag doesn't colour the funding number");
});

test("the visual pass: no green/red on the market inputs, no progress fill, funding beside its percentile, nothing summed", () => {
  const vis = read("../pages/intel/IntelVisuals.tsx");
  const page = read("../pages/intel/index.tsx");
  assert.doesNotMatch(vis, /C\.pos|C\.neg|POS\b|NEG\b/, "the visuals carry no money colours");
  assert.doesNotMatch(vis, /width: `\$\{/, "marks are dots and ticks, never a bar that fills");
  // Green/red only on the viewer's own unrealised P&L (an outcome).
  const greenRed = page.split("\n").filter((l) => /\bGREEN\b|\bRED\b/.test(l) && !l.trim().startsWith("//") && !/^const (GREEN|RED)/.test(l.trim()));
  assert.ok(greenRed.length === 1 && /upnl/.test(greenRed[0]), `green/red only on your P&L: ${greenRed.join(" | ")}`);
  // Each major's funding number sits in the same block as its percentile.
  const major = vis.slice(vis.indexOf("export function MajorCard"), vis.indexOf("export function RatioCell"));
  assert.ok(major.indexOf("fmtFunding(a.funding)") > 0 && major.indexOf("th pct") > major.indexOf("fmtFunding(a.funding)"));
  // Order: the strip → past a line → the majors → your positions → the table → More.
  const order = ["<IntelStrip", "<LineCard", "<MajorCard", "YOUR POSITIONS", "TOP MARKETS BY OPEN INTEREST", '<Fold title="More"'].map((t) => page.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "strip → lines → majors → positions → table → More");
  assert.match(vis, /isMobile \? \{\} : \{ position: "sticky" as const/, "sticky on desktop only");
  const code = (src) => src.split("\n").filter((l) => !/^\s*(\/\/|\*|\{\/\*)/.test(l)).join("\n");
  for (const src of [vis, page]) assert.doesNotMatch(code(src), /\bbias\b|\bscore\b|conviction/i);
});
