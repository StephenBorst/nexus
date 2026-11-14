// Follow a wallet's moves (walletWatch.mjs). Run: node --test workers/nexus-lab-api/walletWatch.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runWalletWatch, newEvents, moveMessage, nextIndex, recordWords, CURSOR_KEY, WL_INDEX_KEY } from "./walletWatch.mjs";
import { topicForType, normTopics } from "./push.mjs";

const kv = (o = {}) => { const m = new Map(Object.entries(o)); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const A = "0xaaaa000000000000000000000000000000000001", B = "0xbbbb000000000000000000000000000000000002";
const ev = (addr, ts, over = {}) => ({ source: "orderly", addr, sym: "ETH", side: "SHORT", type: "OPEN", price: 1836.5, szUsd: 42000, ts, ...over });

test("the first run only sets the cursor; later runs take what's newer, oldest first", () => {
  assert.deepEqual(newEvents([ev(A, 5), ev(B, 9)], null), { fresh: [], cursor: 9 });
  const r = newEvents([ev(A, 12), ev(B, 9), ev(B, 11)], 9);
  assert.deepEqual(r.fresh.map((e) => e.ts), [11, 12]);
  assert.equal(r.cursor, 12);
});

test("the note says the move and the wallet's graded record, never 'copy this'", () => {
  assert.equal(moveMessage(ev(A, 1), { tier: "CONSISTENT", daysTracked: 21 }), "0xaaaa…0001 opened a $42k short on ETH at $1,836.5. Its record: CONSISTENT tier over 21 tracked days (X-Ray).");
  assert.equal(moveMessage(ev(A, 1, { type: "CLOSE" }), null), "0xaaaa…0001 closed a $42k short on ETH. Its record: no tracked record yet (X-Ray).");
  assert.equal(recordWords({ tier: null }), "no tracked record yet");
  assert.doesNotMatch(moveMessage(ev(A, 1), null), /copy|follow this|edge/i);
});

test("only callers who starred the mover hear about it, at most 5 a run each; the wallets switch gates the phone", async () => {
  const env = { LAB_STORE: kv({
    "sm:ord:events": JSON.stringify([ev(A, 20), ev(B, 21)]),
    [CURSOR_KEY]: "10",
    [WL_INDEX_KEY]: JSON.stringify(["0xc1", "0xc2"]),
    "sm:wl:0xc1": JSON.stringify([A]),
    "sm:wl:0xc2": JSON.stringify([]),
  }) };
  const sent = [];
  const r = await runWalletWatch(env, async (w, n) => { sent.push([w, n]); }, { readHist: async () => [{ t: 1 }, { t: 2 }], now: 99 });
  assert.equal(r.sent, 1);
  assert.equal(sent[0][0], "0xc1");
  assert.equal(sent[0][1].type, "wallet_move");
  assert.equal(sent[0][1].url, `/analyze?address=${A}`);
  assert.equal(env.LAB_STORE.m.get(CURSOR_KEY), "21");
  assert.equal(topicForType("wallet_move"), "wallets");
  assert.equal(normTopics(undefined).wallets, false, "off until the trader turns it on");
  // nothing new: nothing sent
  const again = await runWalletWatch(env, async () => { throw new Error("no"); }, { readHist: async () => [] });
  assert.deepEqual(again, { events: 0, sent: 0 });
});

test("the watcher index tracks who has starred anyone", () => {
  assert.deepEqual(nextIndex(["0xA"], "0xb", true), ["0xa", "0xb"]);
  assert.deepEqual(nextIndex(["0xa", "0xb"], "0xB", false), ["0xa"]);
});

test("wired: the watchlist POST keeps the index, the */5 cron runs it", () => {
  assert.match(readFileSync(new URL("./routes-smart.mjs", import.meta.url), "utf8"), /nextIndex\(idxRaw \? JSON\.parse\(idxRaw\) : \[\], caller, clean\.length > 0\)/);
  assert.match(readFileSync(new URL("./index.js", import.meta.url), "utf8"), /runWalletWatch\(env, \(w, n\) => appendNotification\(env, w, n\)/);
});
