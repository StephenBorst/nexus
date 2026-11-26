// Smart Money, visual-first (smartLayout.mjs + SmartMoneyView.tsx): the score never alone, stages from the record,
// sort by stage then days watched, one source for the strip, and every single-wallet copy through edgeGate.
// Run: node --test app/lib/smartLayout.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SCORE_MIN_WINDOWS, TIER_BARS, STAGES, walletStage, scoreMark, buildingLine, recordFacts, sortWallets, stripCounts, lastMoves, SCORE_LINE, STRIP_LINE,
} from "./smartLayout.mjs";
import { xrayTrack } from "../../workers/nexus-lab-api/logic.mjs";
import { edgeGate, WATCHED_MIN_DAYS } from "./xrayGrade.mjs";

const DAY = 86400000;
// A daily realized-P&L series: `pattern` = each day's change.
const series = (pattern, t0 = 1_790_000_000_000) => {
  let r = 0;
  return [{ t: t0, realized: 0 }, ...pattern.map((d, i) => ({ t: t0 + (i + 1) * DAY, realized: (r += d) }))];
};

test("the bars here are xrayTrack's own: scored from 4 windows, POSITIVE 40 / 7, CONSISTENT 65 / 14", () => {
  assert.deepEqual([SCORE_MIN_WINDOWS, TIER_BARS.POSITIVE.score, TIER_BARS.POSITIVE.windows, TIER_BARS.CONSISTENT.score, TIER_BARS.CONSISTENT.windows], [4, 40, 7, 65, 14]);
  assert.equal(xrayTrack(series([10, 10, 10])).scored, false, "3 windows: not scored");
  assert.equal(xrayTrack(series([10, 10, 10, 10])).scored, true, "4 windows: scored");
  const fortnight = xrayTrack(series(Array(14).fill(100)));
  assert.ok(fortnight.operatorScore >= TIER_BARS.CONSISTENT.score && fortnight.tier.tier === "CONSISTENT");
  const thirteen = xrayTrack(series(Array(13).fill(100)));
  assert.notEqual(thirteen.tier.tier, "CONSISTENT", "13 windows can't be CONSISTENT whatever the score");
  const loser = xrayTrack(series([-10, 5, -10, 5, -10]));
  assert.equal(loser.tier, null, "net negative: no tier");
});

test("walletStage + scoreMark: stage from the record; the score only as a dot against both bars", () => {
  const rec = (pattern) => xrayTrack(series(pattern));
  assert.equal(walletStage(null), "BUILDING");
  assert.equal(walletStage(rec([10, 10])), "BUILDING");
  assert.equal(walletStage(rec(Array(14).fill(100))), "CONSISTENT");
  assert.equal(walletStage(rec([-10, 5, -10, 5, -10])), "UNTIERED");
  assert.deepEqual(STAGES, ["CONSISTENT", "POSITIVE", "TRACKED", "UNTIERED", "BUILDING"]);
  const m = scoreMark(rec(Array(14).fill(100)));
  assert.deepEqual(m.ticks, [40, 65]);
  assert.ok(m.pos === m.score && m.score >= 65);
  assert.equal(scoreMark(rec([10, 10])), null, "unscored: no mark, the building line instead");
  assert.equal(buildingLine(rec([10, 10])), "2 of 4 daily windows");
});

test("recordFacts: the parts the score is made of, from the record; unread parts left out", () => {
  const tk = { gradedWindows: 14, winWindows: 9, netRealized: 12400, maxDrawdown: 3000, daysTracked: 15 };
  assert.deepEqual(recordFacts(tk).map((f) => f.text), ["9 of 14 days green", "+$12K realized while watched", "max drawdown $3,000", "15d watched"]);
  assert.deepEqual(recordFacts({ netRealized: -500, daysTracked: 3 }).map((f) => f.text), ["−$500 realized while watched", "3d watched"]);
  assert.deepEqual(recordFacts(null), []);
});

test("sortWallets: stage first, then days watched, then the venue's own order; never the blended score alone", () => {
  const board = [{ address: "0xa" }, { address: "0xb" }, { address: "0xc" }, { address: "0xd" }, { address: "0xe" }];
  const tm = {
    "0xa": { scored: true, tier: { tier: "TRACKED" }, operatorScore: 39, gradedWindows: 30 },
    "0xb": { scored: true, tier: { tier: "POSITIVE" }, operatorScore: 41, gradedWindows: 8 },
    "0xc": { scored: true, tier: { tier: "POSITIVE" }, operatorScore: 60, gradedWindows: 7 },
    "0xd": { scored: false, points: 2 },
    "0xe": { scored: true, tier: { tier: "CONSISTENT" }, operatorScore: 66, gradedWindows: 14 },
  };
  assert.deepEqual(sortWallets(board, tm).map((t) => t.address), ["0xe", "0xb", "0xc", "0xa", "0xd"], "0xb (8 days) before 0xc (score 60, 7 days)");
  assert.deepEqual(stripCounts([...board.map((b) => ({ ...b, source: "hl" })), { address: "0xf", source: "orderly" }], tm),
    { total: 6, orderly: 1, hl: 5, byStage: { CONSISTENT: 1, POSITIVE: 2, TRACKED: 1, UNTIERED: 0, BUILDING: 2 } });
});

test("lastMoves: each wallet's newest move in the feed", () => {
  const m = lastMoves([
    { addr: "0xA", type: "OPEN", side: "LONG", sym: "SOL", ts: 1 },
    { addr: "0xa", type: "CLOSE", side: "LONG", sym: "SOL", ts: 5 },
    { addr: "0xb", type: "OPEN", side: "FLAT", sym: "X", ts: 9 },
  ]);
  assert.deepEqual(m, { "0xa": { type: "CLOSE", side: "LONG", sym: "SOL", ts: 5 } });
});

test("the copy gate is the X-Ray's: a short watched record or a net-negative one locks the copy", () => {
  const short = xrayTrack(series(Array(10).fill(50)));
  const g = edgeGate({ watched: short });
  assert.equal(g.pass, false);
  assert.match(g.reasons[0], new RegExp(`needs ${WATCHED_MIN_DAYS}`));
  assert.equal(edgeGate({ watched: xrayTrack(series(Array(21).fill(50))) }).pass, true);
  assert.equal(edgeGate({ watched: xrayTrack(series([...Array(21).fill(50), -5000])) }).pass, false, "underwater vetoes");
  assert.equal(edgeGate({ watched: null }).pass, false, "no record: locked");
});

test("the page: copy through edgeGate, score never green or alone, stage sort, building on a tap, secondary lists folded", () => {
  const v = readFileSync(new URL("../pages/lab/SmartMoneyView.tsx", import.meta.url), "utf8");
  const confirm = v.slice(v.indexOf("function CopyConfirm"), v.indexOf("// Colour = stage only"));
  assert.match(confirm, /edgeGate\(\{ watched: track && !track\.building \? track : null \}\)/);
  assert.match(confirm, /disabled=\{!gate\?\.pass\}/);
  assert.match(confirm, /if \(gate\?\.pass\) onConfirm\(\)/, "the click is gated too, not just the look");
  assert.match(confirm, /Open its X-Ray →/);
  assert.doesNotMatch(v, /color: "#3ecf8e", border: "1px solid #33333a", borderRadius: 3, padding: "1px 5px", flexShrink: 0, cursor: "pointer" \}\}>\{tk\.tier\.glyph\} \{tk\.operatorScore\}/, "the old green score chip is gone");
  assert.match(v, /sortWallets\(board, trackMap\)/);
  assert.match(v, /score \{mark\.score\} · bars \{TIER_BARS\.POSITIVE\.score\} \/ \{TIER_BARS\.CONSISTENT\.score\}/, "the score sits with both bars");
  assert.match(v, /Show the \$\{building\.length\} still building a record/);
  const more = v.slice(v.indexOf('<Fold title="More"'));
  assert.ok(more.includes("<ConvictionScanner />") && more.includes("TIER CHANGES"), "the scan and the tier changes sit under More");
  const order = ["<WalletStrip", "THE WALLETS", "{/* ── THE SHOVEL LINE", "SMART MONEY CONSENSUS", "LIVE SIGNAL FEED", '<Fold title="More"'].map((t) => v.indexOf(t));
  assert.ok(order.every((i, k) => i > 0 && (k === 0 || i > order[k - 1])), "strip → wallets → shovel → consensus → feed → More");
  for (const line of [SCORE_LINE, STRIP_LINE]) assert.doesNotMatch(line, /proven|guarantee/i);
  assert.doesNotMatch(STRIP_LINE, /edge/i);
  assert.match(SCORE_LINE, /not a graded edge/);
});

test("walletLists: building folds only while some wallet is scored; with none scored the building list is the board", async () => {
  const { walletLists, NONE_SCORED_LINE } = await import("./smartLayout.mjs");
  const board = [{ address: "0xa" }, { address: "0xb" }];
  const none = walletLists(board, { "0xa": { scored: false, points: 3 } });
  assert.deepEqual([none.shown.length, none.folded.length, none.noneScored], [2, 0, true]);
  const some = walletLists(board, { "0xa": { scored: true, tier: { tier: "POSITIVE" }, gradedWindows: 8 } });
  assert.deepEqual([some.shown.map((t) => t.address), some.folded.map((t) => t.address), some.noneScored], [["0xa"], ["0xb"], false]);
  assert.match(NONE_SCORED_LINE, /4 daily windows/);
  const v = readFileSync(new URL("../pages/lab/SmartMoneyView.tsx", import.meta.url), "utf8");
  assert.match(v, /walletLists\(base, trackMap\)/);
  assert.match(v, /createPortal\(<>[\s\S]*<CopyConfirm[\s\S]*<\/>, document\.body\)/, "the copy gate opens on the screen, not inside the transformed tab");
});

test("buildingLine never counts snapshots as graded windows", () => {
  assert.equal(buildingLine({ scored: false, points: 5 }), "5 snapshots so far", "no gradedWindows: say snapshots");
  assert.equal(buildingLine({ scored: false, points: 5, gradedWindows: 0 }), "0 of 4 daily windows", "far-apart snapshots grade nothing");
  assert.equal(buildingLine(null), "not watched yet");
});

test("one card a wallet: P&L + positions + Trade up front, the record's detail behind Details (visual pass 2026-11-26)", () => {
  const v = readFileSync(new URL("../pages/lab/SmartMoneyView.tsx", import.meta.url), "utf8");
  const card = v.slice(v.indexOf("const walletCard"), v.indexOf("THE WALLETS <span"));
  const det = card.indexOf("<Details>"), end = card.indexOf("</Details>");
  assert.ok(det > 0 && end > det, "one Details per card");
  for (const t of ["{usd(t.pnl)}", "tradeBtn(", "STAGE_WORD[stage]", "toggleWatch(", "{p.coin}"]) assert.ok(card.indexOf(t) > 0 && card.indexOf(t) < det, `${t} in the first view`);
  for (const t of ["Building a record", "score {mark.score}", "last move:", "uPnL <span"]) assert.ok(card.indexOf(t) > det && card.indexOf(t) < end, `${t} behind Details`);
  assert.match(v, /from "@\/components\/ReadCard"/, "the same Details as /proof and the shelf");
});
