// Run: node --test workers/nexus-lab-api/publishMark.test.mjs
// The publish price: one Orderly read per market, never throws, never touches the real network here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPublishMark, marksForPublishes, MAX_MARKS_PER_SAVE } from "./publishMark.mjs";
import { sealTheses } from "./callLock.mjs";

const quiet = { error() {}, log() {} };
const noSleep = async () => {};
const fakeFetch = (handler) => {
  const urls = [];
  const f = async (url) => { urls.push(url); return handler(url); };
  f.urls = urls;
  return f;
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("readPublishMark: Orderly's mark for the call's market, from any symbol shape", async () => {
  const f = fakeFetch(() => jsonRes({ success: true, data: { symbol: "PERP_BTC_USDC", mark_price: 63712.4 } }));
  const m = await readPublishMark("btc", { fetchImpl: f, now: () => 1234, sleep: noSleep, log: quiet });
  assert.deepEqual(m, { px: 63712.4, at: 1234, src: "orderly-mark" });
  assert.equal(f.urls[0], "https://api-evm.orderly.org/v1/public/futures/PERP_BTC_USDC");
});

test("readPublishMark: a challenge page, a 429, an error or a missing price is null, never a throw", async () => {
  const cases = [
    () => new Response("<html>challenge</html>", { status: 403 }),
    () => new Response("{}", { status: 429 }),
    () => { throw new Error("offline"); },
    () => jsonRes({ success: true, data: { mark_price: 0 } }),
    () => jsonRes({ success: true, data: {} }),
    () => jsonRes({ success: false, message: "no symbol" }, 400),
  ];
  for (const h of cases) {
    assert.equal(await readPublishMark("ETH", { fetchImpl: fakeFetch(h), sleep: noSleep, log: quiet }), null);
  }
  assert.equal(await readPublishMark("", { fetchImpl: fakeFetch(() => jsonRes({})) }), null, "no market, no read");
});

test("marksForPublishes: one read per market, only for the ids being published, capped per save", async () => {
  const asked = [];
  const read = async (perp) => { asked.push(perp); return { px: 10, at: 5, src: "orderly-mark" }; };
  const incoming = [
    { id: "a", symbol: "BTC" }, { id: "b", symbol: "PERP_BTC_USDC" }, { id: "c", symbol: "ETH" },
    { id: "skip", symbol: "SOL" },                 // not being published in this save
  ];
  const out = await marksForPublishes(incoming, ["a", "b", "c"], read);
  assert.deepEqual(asked, ["PERP_BTC_USDC", "PERP_ETH_USDC"]);
  assert.deepEqual(Object.keys(out).sort(), ["a", "b", "c"]);
  assert.equal(out.a.px, 10);

  asked.length = 0;
  const many = Array.from({ length: MAX_MARKS_PER_SAVE + 2 }, (_, i) => ({ id: `x${i}`, symbol: `C${i}` }));
  const capped = await marksForPublishes(many, many.map((t) => t.id), read);
  assert.equal(asked.length, MAX_MARKS_PER_SAVE);
  assert.equal(Object.keys(capped).length, MAX_MARKS_PER_SAVE, "the rest publish without a mark");

  assert.deepEqual(await marksForPublishes(incoming, ["a"], async () => null), {}, "a failed read: no mark");
  assert.deepEqual(await marksForPublishes(incoming, ["a"], undefined), {}, "no reader: no reads");
});

test("sealTheses keeps a mark only if it was read around the publish, and only on a first publish", () => {
  const now = 1_790_000_000_000;
  const call = (id) => ({ id, symbol: "BTC", direction: "LONG", entryPrice: 100, stopLoss: 95, takeProfit1: 110, isPublic: true });
  const sealed = sealTheses({
    prev: [], incoming: [call("fresh"), call("old")], registry: null, now,
    publishMarks: { fresh: { px: 100.1, at: now - 1000 }, old: { px: 99, at: now - 10 * 60_000 } },
  });
  assert.equal(sealed.registry.calls.fresh.publishMark.px, 100.1);
  assert.equal(sealed.registry.calls.old.publishMark, undefined, "a 10-minute-old price isn't the market at the post");
  // A later save, with a new mark offered: the first one stands.
  const again = sealTheses({
    prev: sealed.theses, incoming: sealed.theses, registry: sealed.registry, now: now + 3600e3,
    publishMarks: { fresh: { px: 120, at: now + 3600e3 } },
  });
  assert.equal(again.theses.find((t) => t.id === "fresh").publishMark.px, 100.1);
});
