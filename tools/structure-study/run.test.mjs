// The runner's wiring, offline: fake candles, fake house record. Every run here uses synthetic
// tapes (flat or failed), so no real structure split is ever computed in a test.
import test from "node:test";
import assert from "node:assert/strict";
import { runStudy, paramsFromDoc, canonical, readRepoFile, DOC } from "./run.mjs";
import { PREREG, VERDICTS } from "./study.mjs";

const realRead = readRepoFile;
const H4 = 4 * 3600 * 1000;
const quiet = () => {};

// Every market: 30 weeks of perfectly flat 4H bars before `to` → every call is `flat_tape`.
const flatTape = async (symbol, from, to) => {
  const bars = [];
  for (let t = Math.floor(from / H4) * H4; t <= to; t += H4) bars.push({ t, o: 1, h: 1, l: 1, c: 1 });
  return { symbol, orderly: `PERP_${symbol}_USDC`, bars, pages: 1, gaps: 0 };
};
const failedTape = async (symbol) => ({ symbol, orderly: `PERP_${symbol}_USDC`, bars: [], pages: 0, gaps: 0, error: "orderly challenge (HTTP 403) /tv/history?…" });
const noNetwork = async () => { throw new Error("test tried the network"); };

test("paramsFromDoc reads the block after the marker; canonical ignores key order", () => {
  assert.deepEqual(paramsFromDoc("x\n<!-- prereg-params -->\n```json\r\n{\"a\":1}\r\n```\n"), { a: 1 });
  assert.throws(() => paramsFromDoc("```json\n{}\n```"), /no <!-- prereg-params -->/);
  assert.throws(() => paramsFromDoc("<!-- prereg-params -->\nnone"), /not a ```json fence/);
  assert.equal(canonical({ b: [1, { d: 2, c: 3 }], a: null }), canonical({ a: null, b: [1, { c: 3, d: 2 }] }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("refuses when the registration and the code disagree", async () => {
  const edited = realRead(DOC).replace('"minGapR": 0.4,', '"minGapR": 0.3,');
  const readText = (p) => (p === DOC ? edited : realRead(p));
  await assert.rejects(runStudy({ stage: 1, readText, tape: flatTape, fetchJson: noNetwork, log: quiet }), /differ from tools\/structure-study\/study\.mjs/);
});

test("refuses when the frozen population changed", async () => {
  const file = JSON.parse(realRead(PREREG.stage1.file));
  file.calls[0] = { ...file.calls[0], gradedOutcome: file.calls[0].gradedOutcome === "WIN" ? "LOSS" : "WIN" };
  const readText = (p) => (p === PREREG.stage1.file ? JSON.stringify(file) : realRead(p));
  await assert.rejects(runStudy({ stage: 1, readText, tape: flatTape, fetchJson: noNetwork, log: quiet }), /population changed/);
});

test("refuses stage 2 before its read date, and any other stage", async () => {
  const early = PREREG.cutoffMs + 27 * 86400000;
  await assert.rejects(runStudy({ stage: 2, now: early, readText: realRead, tape: flatTape, fetchJson: noNetwork, log: quiet }), /stage 2 reads on or after 2026-10-28T00:00:00\.000Z/);
  await assert.rejects(runStudy({ stage: 3, readText: realRead, tape: flatTape, fetchJson: noNetwork, log: quiet }), /--stage must be 1 or 2/);
});

test("candles that fail to load VOID the run instead of shrinking the sample", async () => {
  const rep = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape: failedTape, fetchJson: noNetwork, commit: "abc", log: quiet });
  assert.equal(rep.stage1.verdict, VERDICTS.VOID);
  assert.equal(rep.populations["stage 1"].n, 163);
  assert.equal(rep.populations["stage 1"].byReason.candles_unavailable, 163);
  assert.ok(rep.markets.every((m) => m.error));
  assert.equal(rep.stage2, null);
  assert.match(rep.docSha256, /^[0-9a-f]{64}$/);
});

test("stage 1 wiring: every call reaches the classifier with its own post time and entry", async () => {
  const asked = [];
  const tape = async (symbol, from, to, opts) => { asked.push({ symbol, from, to, opts }); return flatTape(symbol, from, to); };
  const rep = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape, fetchJson: noNetwork, log: quiet });
  assert.equal(rep.calls.stage1.length, 163);
  assert.ok(rep.calls.stage1.every((x) => x.classified === false && x.reason === "flat_tape"));
  assert.equal(rep.stage1.verdict, VERDICTS.INSUFFICIENT);
  // One fetch per market, reaching 28 weeks before its first call and ending at its last call.
  const file = JSON.parse(realRead(PREREG.stage1.file));
  assert.equal(asked.length, new Set(file.calls.map((c) => c.symbol)).size);
  for (const a of asked) {
    const mine = file.calls.filter((c) => c.symbol === a.symbol).map((c) => c.createdAt);
    assert.equal(a.from, Math.min(...mine) - 28 * 7 * 86400000);
    assert.equal(a.to, Math.max(...mine));
    assert.equal(a.opts.pageDays, 40);
  }
});

test("stage 2 reads only house calls posted in its window, graded", async () => {
  const c = PREREG.cutoffMs, day = 86400000;
  const call = (id, createdAt, extra = {}) => ({ id, symbol: "ETH", direction: "SHORT", entryPrice: 100, stopLoss: 103, takeProfit1: 96, createdAt, source: "nexus-signal", gradeV: 3, gradedOutcome: "WIN", gradedR: 1.33, ...extra });
  const theses = [
    call("nexus-ETH-a", c + day), call("nexus-ETH-b", c + 5 * day, { gradedOutcome: "LOSS", gradedR: -1 }), call("nexus-ETH-c", c + 13 * day),
    call("nexus-ETH-open", c + 2 * day, { gradedOutcome: undefined, gradedR: undefined, gradeV: undefined }),
    call("nexus-ETH-late", c + 14 * day), call("nexus-ETH-early", c - day),
    call("manual-1", c + 3 * day, { source: undefined }), call("nexus-ETH-dup", c + 4 * day, { duplicateOf: "0xabc" }),
  ];
  const urls = [];
  const fetchJson = async (u) => { urls.push(u); return { theses }; };
  const rep = await runStudy({ stage: 2, now: c + 28 * day, readText: realRead, tape: flatTape, fetchJson, log: quiet });
  assert.deepEqual(urls, [`https://og.nexustradinglabs.com/lab/${PREREG.population.wallet}`]);
  assert.deepEqual(rep.calls.stage2.map((x) => x.id), ["nexus-ETH-a", "nexus-ETH-b", "nexus-ETH-c"]);
  assert.equal(rep.populations["stage 2"].posted, 4);
  assert.equal(rep.stage2.verdict, "NOT_APPLICABLE"); // stage 1 read INSUFFICIENT on flat tapes
});
