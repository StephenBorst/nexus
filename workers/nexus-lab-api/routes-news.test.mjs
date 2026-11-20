// GET /intel/news (routes-news.mjs). Run: node --test workers/nexus-lab-api/routes-news.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleNews, readNews, NEWS_CACHE_KEY, NEWS_TTL_MS } from "./routes-news.mjs";
import { NEWS_FEEDS } from "../../app/lib/newsWire.mjs";

const kv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const req = (p) => new Request(`https://og.nexustradinglabs.com${p}`);
const NOW = Date.parse("2026-11-20T10:30:00Z");
const rss = (items) => `<rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date(i.t).toUTCString()}</pubDate></item>`).join("")}</channel></rss>`;
const byFeed = (map) => async (url) => {
  const f = NEWS_FEEDS.find((x) => x.url === url);
  const body = f && map[f.id];
  if (body instanceof Error) throw body;
  if (typeof body === "number") return new Response("no", { status: body });
  return new Response(body ?? "<html>blocked</html>", { status: 200 });
};

test("reads every feed, tags coins, names the feeds that failed", async () => {
  const env = { LAB_STORE: kv() };
  const fetchImpl = byFeed({
    coindesk: rss([{ title: "Bitcoin falls below $60K", link: "https://cd.test/1", t: NOW - 60_000 }]),
    cointelegraph: rss([{ title: "Solana ETF approved", link: "https://ct.test/1", t: NOW - 120_000 }]),
    decrypt: 403,
    fed: new Error("timeout"),
  });
  const res = await handleNews(["intel", "news"], req("/intel/news"), env, { fetchImpl, now: NOW });
  const b = await res.json();
  assert.deepEqual(b.items.map((i) => [i.title, i.coins]), [["Bitcoin falls below $60K", ["BTC"]], ["Solana ETF approved", ["SOL"]]]);
  assert.ok(b.unread.includes("Decrypt"));
  assert.ok(b.unread.includes("Federal Reserve"));
  assert.ok(b.unread.includes("The Block"), "a reply with no stories in it is a failed read");
  assert.ok(!b.unread.includes("CoinDesk"));
  // the reason a feed failed is kept server-side (the owner can read KV), not sent to every reader
  assert.equal(b.sources.find((s) => s.id === "decrypt").err, undefined);
  const stored = JSON.parse(env.LAB_STORE.m.get(NEWS_CACHE_KEY));
  assert.equal(stored.sources.find((s) => s.id === "decrypt").err, "http 403");
});

test("?coin= returns that coin's stories only", async () => {
  const env = { LAB_STORE: kv() };
  const fetchImpl = byFeed({ coindesk: rss([
    { title: "Bitcoin falls below $60K", link: "https://cd.test/1", t: NOW - 60_000 },
    { title: "ETH and SOL hold up", link: "https://cd.test/2", t: NOW - 90_000 },
  ]) });
  const b = await (await handleNews(["intel", "news"], req("/intel/news?coin=sol"), env, { fetchImpl, now: NOW })).json();
  assert.equal(b.coin, "SOL");
  assert.deepEqual(b.items.map((i) => i.title), ["ETH and SOL hold up"]);
});

test("feeds are read at most once per 5 minutes", async () => {
  const env = { LAB_STORE: kv() };
  let calls = 0;
  const fetchImpl = async (u) => { calls++; return byFeed({ coindesk: rss([{ title: "A", link: "https://cd.test/a", t: NOW }]) })(u); };
  await readNews(env, { fetchImpl, now: NOW });
  const after = calls;
  await readNews(env, { fetchImpl, now: NOW + NEWS_TTL_MS - 1 });
  assert.equal(calls, after);
  await readNews(env, { fetchImpl, now: NOW + NEWS_TTL_MS });
  assert.equal(calls, after * 2);
});

test("a feed that goes down keeps its stories; it is named with when it last answered", async () => {
  const env = { LAB_STORE: kv() };
  await readNews(env, { fetchImpl: byFeed({ coindesk: rss([{ title: "Held story", link: "https://cd.test/h", t: NOW - 60_000 }]) }), now: NOW });
  const w = await readNews(env, { fetchImpl: byFeed({ coindesk: 500 }), now: NOW + NEWS_TTL_MS });
  assert.deepEqual(w.items.map((i) => i.title), ["Held story"]);
  const cd = w.sources.find((s) => s.id === "coindesk");
  assert.equal(cd.ok, false);
  assert.equal(cd.lastOkAt, NOW);
});

test("every feed down and nothing held = an empty list with every source named, never 'no news'", async () => {
  const env = { LAB_STORE: kv() };
  const b = await (await handleNews(["intel", "news"], req("/intel/news"), env, { fetchImpl: async () => { throw new Error("down"); }, now: NOW })).json();
  assert.deepEqual(b.items, []);
  assert.equal(b.unread.length, NEWS_FEEDS.length);
});

test("other paths are not ours", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal(await handleNews(["intel", "calendar"], req("/intel/calendar"), env), null);
  assert.equal(await handleNews(["intel", "news", "x"], req("/intel/news/x"), env), null);
});

test("wired into the worker", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /import \{ handleNews \} from "\.\/routes-news\.mjs"/);
  assert.match(src, /await handleNews\(parts, request, env\)/);
});
