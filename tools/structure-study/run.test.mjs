// The runner's wiring, offline: fake candles, fake house record. Every run here uses synthetic
// tapes (flat, failed, empty or a made-up price wave), never real candles.
import test from "node:test";
import assert from "node:assert/strict";
import { runStudy, paramsFromDoc, paramBlocks, canonical, readRepoFile, DOC } from "./run.mjs";
import { PREREG, VERDICTS } from "./study.mjs";
import { fetchTape } from "./tape.mjs";

const realRead = readRepoFile;
const H4 = 4 * 3600 * 1000;
const quiet = () => {};
const noSleep = async () => {};

// Every market: 30 weeks of perfectly flat 4H bars before `to` → every call is `flat_tape`.
const flatTape = async (symbol, from, to) => {
  const bars = [];
  for (let t = Math.floor(from / H4) * H4; t <= to; t += H4) bars.push({ t, o: 1, h: 1, l: 1, c: 1 });
  return { symbol, orderly: `PERP_${symbol}_USDC`, bars, pages: 1, gaps: 0 };
};
const failedTape = async (symbol) => ({ symbol, orderly: `PERP_${symbol}_USDC`, bars: [], pages: 0, gaps: 0, error: "orderly challenge (HTTP 403) /tv/history?…" });
// Run 1 (2026-09-30): every page answered no_data, nothing errored, the tape was simply empty.
const emptyTape = async (symbol) => ({ symbol, orderly: `PERP_${symbol}_USDC`, bars: [], bars1h: 0, pages: 6, gaps: 0 });
const noNetwork = async () => { throw new Error("test tried the network"); };

// A fake Orderly /tv/history that behaves like the real one: 1H candles for any range, "no_data" for
// any other resolution (240 included). Prices are a deterministic wave per market, so 4H and weekly
// swings exist and every page agrees with every other.
function fakeOrderly() {
  const urls = [];
  const get = async (url) => {
    urls.push(url);
    const q = new URL(url).searchParams;
    if (q.get("resolution") !== "60") return { s: "no_data" };
    const k = [...q.get("symbol")].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 7 + 1;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const d = { s: "ok", t: [], o: [], h: [], l: [], c: [] };
    for (let s = Math.ceil(from / 3600) * 3600; s <= to; s += 3600) {
      const x = s / 3600;
      const p = 100 + 8 * Math.sin(x / (53 + k)) + 3 * Math.sin(x / (9 + k)) + 15 * Math.sin(x / (700 + 40 * k));
      d.t.push(s); d.o.push(p); d.c.push(p + 0.2 * Math.sin(x)); d.h.push(p + 0.6); d.l.push(p - 0.6);
    }
    return d;
  };
  return { get, urls };
}

test("paramsFromDoc reads the latest block; paramBlocks reads them all, in order", () => {
  assert.deepEqual(paramsFromDoc("x\n<!-- prereg-params -->\n```json\r\n{\"a\":1}\r\n```\n"), { a: 1 });
  const two = "<!-- prereg-params -->\n```json\n{\"a\":1}\n```\ntext\n<!-- prereg-params amendment-1 2026-10-01 -->\n```json\n{\"a\":2}\n```\n";
  assert.deepEqual(paramsFromDoc(two), { a: 2 });
  assert.deepEqual(paramBlocks(two), [{ label: "", params: { a: 1 } }, { label: "amendment-1 2026-10-01", params: { a: 2 } }]);
  assert.throws(() => paramsFromDoc("```json\n{}\n```"), /no <!-- prereg-params -->/);
  assert.throws(() => paramsFromDoc("<!-- prereg-params -->\nnone"), /not a ```json fence/);
  // The fence must follow its own marker: a marker without one can't borrow the next block's.
  assert.throws(() => paramBlocks("<!-- prereg-params a -->\ntext\n<!-- prereg-params b -->\n```json\n{}\n```"), /\(a\) is not a ```json fence/);
  assert.equal(canonical({ b: [1, { d: 2, c: 3 }], a: null }), canonical({ a: null, b: [1, { c: 3, d: 2 }] }));
  assert.notEqual(canonical({ a: 1 }), canonical({ a: 2 }));
});

test("refuses when the latest block and the code disagree", async () => {
  const doc = realRead(DOC);
  const at = doc.lastIndexOf('"minGapR": 0.4,');
  const edited = doc.slice(0, at) + '"minGapR": 0.3,' + doc.slice(at + '"minGapR": 0.4,'.length);
  const readText = (p) => (p === DOC ? edited : realRead(p));
  await assert.rejects(runStudy({ stage: 1, readText, tape: flatTape, fetchJson: noNetwork, log: quiet }), /differ from tools\/structure-study\/study\.mjs/);
});

test("refuses when any block changes a rule (an amendment may only change the candle source)", async () => {
  const edited = realRead(DOC).replace('"minGapR": 0.4,', '"minGapR": 0.3,'); // the registered block
  const readText = (p) => (p === DOC ? edited : realRead(p));
  await assert.rejects(runStudy({ stage: 1, readText, tape: flatTape, fetchJson: noNetwork, log: quiet }), /changes a rule, not just the candle source/);
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

test("run 1's failure: an empty tape VOIDs the run, even when nothing errored", async () => {
  const rep = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape: emptyTape, fetchJson: noNetwork, log: quiet });
  assert.equal(rep.stage1.verdict, VERDICTS.VOID);
  assert.equal(rep.populations["stage 1"].byReason.candles_unavailable, 163);
  assert.ok(rep.markets.every((m) => m.error === "no candles" && m.bars === 0));
  // And through the real fetcher: a venue that answers no_data to every page.
  const tape = (s, f, t, o) => fetchTape(s, f, t, { ...o, get: async () => ({ s: "no_data" }), sleep: noSleep });
  const rep2 = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape, fetchJson: noNetwork, log: quiet });
  assert.equal(rep2.stage1.verdict, VERDICTS.VOID);
  assert.ok(rep2.markets.every((m) => /no candles/.test(m.error)));
});

test("stage 1 wiring: every call reaches the classifier with its own post time and entry", async () => {
  const asked = [];
  const tape = async (symbol, from, to, opts) => { asked.push({ symbol, from, to, opts }); return flatTape(symbol, from, to); };
  const rep = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape, fetchJson: noNetwork, log: quiet });
  assert.equal(rep.calls.stage1.length, 163);
  assert.ok(rep.calls.stage1.every((x) => x.classified === false && x.reason === "flat_tape"));
  assert.equal(rep.stage1.verdict, VERDICTS.INSUFFICIENT);
  // One fetch per market, reaching 28 weeks before its first call and ending at its last call, on the
  // amended source: 1H candles in 20-day pages.
  const file = JSON.parse(realRead(PREREG.stage1.file));
  assert.equal(asked.length, new Set(file.calls.map((c) => c.symbol)).size);
  for (const a of asked) {
    const mine = file.calls.filter((c) => c.symbol === a.symbol).map((c) => c.createdAt);
    assert.equal(a.from, Math.min(...mine) - 28 * 7 * 86400000);
    assert.equal(a.to, Math.max(...mine));
    assert.equal(a.opts.pageDays, 20);
    assert.equal(a.opts.resolution, "60");
  }
});

test("end to end on a venue like Orderly (1H only): every call gets classified", async () => {
  const { get, urls } = fakeOrderly();
  const tape = (s, f, t, o) => fetchTape(s, f, t, { ...o, get, sleep: noSleep });
  const rep = await runStudy({ stage: 1, now: Date.UTC(2026, 9, 1), readText: realRead, tape, fetchJson: noNetwork, log: quiet });
  assert.ok(urls.length > 0 && urls.every((u) => u.includes("resolution=60")), "asks for 1H candles only");
  assert.ok(rep.markets.every((m) => !m.error && m.bars > 0 && m.bars1h > m.bars));
  assert.equal(rep.populations["stage 1"].classified, 163);
  assert.notEqual(rep.stage1.verdict, VERDICTS.VOID);
  assert.ok(rep.calls.stage1.every((x) => typeof x.counterCycle === "boolean"));
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
