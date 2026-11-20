// The news wire's rules (app/lib/newsWire.mjs). Run: node --test app/lib/newsWire.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  NEWS_FEEDS, NEWS_WINDOW_MS, NEWS_PER_SOURCE, newsCoins, newsCategory, parseFeed, plainText, safeLink,
  feedItems, mergeNews, newsForCoin, newsAge, newsId, decodeEntities,
} from "./newsWire.mjs";

const NOW = Date.parse("2026-11-20T10:30:00Z");
const rfc = (ms) => new Date(ms).toUTCString();
const FEED = { id: "ct", name: "Cointelegraph", kind: "crypto" };

const rss = (items) => `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items.map((i) => `
  <item>
    <title><![CDATA[${i.title}]]></title>
    <link>${i.link}</link>
    <description><![CDATA[${i.desc ?? ""}]]></description>
    <pubDate>${i.date}</pubDate>
  </item>`).join("")}</channel></rss>`;

test("every feed is https, named once, with a kind", () => {
  assert.equal(new Set(NEWS_FEEDS.map((f) => f.id)).size, NEWS_FEEDS.length);
  for (const f of NEWS_FEEDS) {
    assert.match(f.url, /^https:\/\//);
    assert.ok(["crypto", "markets", "macro"].includes(f.kind), f.id);
  }
});

test("no third-party relay: neither the wire nor the app reads feeds through rss2json", () => {
  for (const f of NEWS_FEEDS) assert.doesNotMatch(f.url, /rss2json/);
  const page = readFileSync(new URL("../pages/lab/MarketIntel.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(page, /rss2json/);
  assert.match(page, /\/intel\/news/);
});

test("coins: tickers in capitals, names in any case", () => {
  assert.deepEqual(newsCoins("Bitcoin falls below $60K for first time since July"), ["BTC"]);
  assert.deepEqual(newsCoins("ETH and SOL lead the bounce"), ["ETH", "SOL"]);
  assert.deepEqual(newsCoins("ethereum gas fees hit a low"), ["ETH"]);
  assert.deepEqual(newsCoins("$DOGE rips on X rumours"), ["DOGE"]);
  assert.deepEqual(newsCoins("Hyperliquid volumes top $10B"), ["HYPE"]);
});

test("coins: words that only look like tickers are left out", () => {
  assert.deepEqual(newsCoins("Bitcoin price near $60K as stocks sink"), ["BTC"]); // "near" is a word
  assert.deepEqual(newsCoins("Analysts say the hype is over"), []);
  assert.deepEqual(newsCoins("Link your wallet to the pump"), []);
  assert.deepEqual(newsCoins("DOT announces new highway funding"), []); // the Department of Transportation
  assert.deepEqual(newsCoins("An avalanche of liquidations"), []);         // a word, not the chain
  assert.deepEqual(newsCoins("Sol Campbell retires"), []);                  // "Sol" is not "SOL" or "Solana"
  assert.deepEqual(newsCoins("Whether ETFs matter"), []);                  // "ether" inside a word
  assert.deepEqual(newsCoins("NEAR Protocol and $LINK"), ["LINK", "NEAR"]);
  assert.deepEqual(newsCoins("Avalanche rolls out a subnet"), ["AVAX"]);
  assert.deepEqual(newsCoins("BTCUSD and XETH"), []);                      // part of a longer word
});

test("category: the old client rule; the Fed's feed is always MACRO", () => {
  assert.equal(newsCategory("Powell signals a pause", "", "crypto"), "MACRO");
  assert.equal(newsCategory("Aave launches v4", "", "crypto"), "DEFI");
  assert.equal(newsCategory("Bitcoin slips", "", "markets"), "CRYPTO");
  assert.equal(newsCategory("Board approves minutes", "", "macro"), "MACRO");
  assert.equal(newsCategory("Something else", "", "crypto"), "CRYPTO");
  assert.equal(newsCategory("Something else", "", "markets"), "MARKETS");
});

test("parse: RSS items, CDATA, entities, tags dropped (escaped ones too)", () => {
  const xml = rss([{ title: "Bitcoin &amp; Ether &#8212; a <b>big</b> day", link: "https://x.test/a", desc: "&lt;p&gt;Line one&lt;/p&gt; <img src=x>two", date: rfc(NOW) }]);
  const [it] = parseFeed(xml);
  assert.equal(it.title, "Bitcoin & Ether — a big day");
  assert.equal(it.summary, "Line one two");
  assert.equal(it.link, "https://x.test/a");
  assert.equal(decodeEntities("&#x2019;"), "’");
  assert.equal(plainText("<![CDATA[a]]> &nbsp; b"), "a b");
});

test("parse: Atom entries, link by href", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>FOMC statement</title><link rel="alternate" href="https://fed.test/1"/><updated>2026-11-20T09:00:00Z</updated><summary>Rates held.</summary></entry></feed>`;
  assert.deepEqual(parseFeed(xml), [{ title: "FOMC statement", link: "https://fed.test/1", summary: "Rates held.", published: "2026-11-20T09:00:00Z" }]);
});

test("parse: garbage in = nothing out, never a throw", () => {
  assert.deepEqual(parseFeed(""), []);
  assert.deepEqual(parseFeed("<html>Access denied</html>"), []);
  assert.deepEqual(parseFeed(null), []);
});

test("links: only http(s) is ever served", () => {
  assert.equal(safeLink("javascript:alert(1)"), "");
  assert.equal(safeLink("data:text/html,x"), "");
  assert.equal(safeLink(" https://ok.test/a?b=1&amp;c=2 "), "https://ok.test/a?b=1&c=2");
  const [it] = feedItems(rss([{ title: "x", link: "javascript:alert(1)", date: rfc(NOW) }]), FEED, NOW);
  assert.equal(it.link, "");
});

test("feed items: coins, category, a stable id, a summary cut at 240", () => {
  const long = "a".repeat(400);
  const [it] = feedItems(rss([{ title: "Solana ETF approved", link: "https://x.test/sol", desc: long, date: rfc(NOW - 60_000) }]), FEED, NOW);
  assert.deepEqual(it.coins, ["SOL"]);
  assert.equal(it.category, "CRYPTO");
  assert.equal(it.id, newsId("https://x.test/sol"));
  assert.equal(it.summary.length, 240);
  assert.ok(it.summary.endsWith("…"));
  assert.equal(it.publishedAt, NOW - 60_000);
  assert.equal(it.source, "Cointelegraph");
});

test("feed items: a re-stamped cluster (4+ at one second) and future times count as undated", () => {
  const same = rfc(NOW - 5 * 60_000);
  const items = feedItems(rss([
    ...[1, 2, 3, 4].map((n) => ({ title: `Old story ${n}`, link: `https://x.test/${n}`, date: same })),
    { title: "From the future", link: "https://x.test/f", date: rfc(NOW + 3600_000) },
    { title: "Real one", link: "https://x.test/r", date: rfc(NOW - 120_000) },
  ]), FEED, NOW);
  assert.deepEqual(items.filter((i) => i.publishedAt == null).map((i) => i.title).sort(),
    ["From the future", "Old story 1", "Old story 2", "Old story 3", "Old story 4"]);
  assert.equal(items.find((i) => i.title === "Real one").publishedAt, NOW - 120_000);
});

test("feed items: older than 48h drops", () => {
  const items = feedItems(rss([{ title: "Stale", link: "https://x.test/s", date: rfc(NOW - NEWS_WINDOW_MS - 1) }]), FEED, NOW);
  assert.deepEqual(items, []);
});

test("merge: one story once, by id or by title across feeds; dated newest first, undated after", () => {
  const a = { id: "1", title: "Bitcoin falls below $60K", sourceId: "ct", publishedAt: NOW - 10_000, firstSeenAt: NOW };
  const dupTitle = { id: "2", title: "Bitcoin Falls Below $60K!", sourceId: "dc", publishedAt: NOW - 5_000, firstSeenAt: NOW };
  const b = { id: "3", title: "ETH steady", sourceId: "dc", publishedAt: NOW - 20_000, firstSeenAt: NOW };
  const u = { id: "4", title: "Undated", sourceId: "yh", publishedAt: null, firstSeenAt: NOW - 1000 };
  const out = mergeNews([a], [dupTitle, b, u], NOW);
  assert.deepEqual(out.map((i) => i.id), ["1", "3", "4"]);
});

test("merge: an undated story keeps the time it was first seen, so it doesn't jump back to the top", () => {
  const first = { id: "u", title: "Undated", sourceId: "yh", publishedAt: null, firstSeenAt: NOW - 3600_000 };
  const again = { ...first, firstSeenAt: NOW };
  const [it] = mergeNews([first], [again], NOW);
  assert.equal(it.firstSeenAt, NOW - 3600_000);
});

test("merge: a feed that failed keeps its stories until they age out", () => {
  const held = { id: "h", title: "Held", sourceId: "ct", publishedAt: NOW - 3600_000, firstSeenAt: NOW - 3600_000 };
  assert.equal(mergeNews([held], [], NOW).length, 1);
  assert.equal(mergeNews([held], [], NOW + NEWS_WINDOW_MS).length, 0);
});

test("merge: no feed floods the top", () => {
  const many = Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, title: `Story ${i}`, sourceId: "ct", publishedAt: NOW - i * 1000, firstSeenAt: NOW }));
  const one = { id: "o", title: "Other", sourceId: "dc", publishedAt: NOW - 999_999, firstSeenAt: NOW };
  const out = mergeNews([], [...many, one], NOW);
  assert.equal(out.filter((i) => i.sourceId === "ct").length, NEWS_PER_SOURCE);
  assert.ok(out.some((i) => i.id === "o"));
});

test("a coin's stories; ages in words", () => {
  const items = [{ id: "1", coins: ["BTC", "ETH"] }, { id: "2", coins: ["SOL"] }, { id: "3" }];
  assert.deepEqual(newsForCoin(items, "PERP_ETH_USDC").map((i) => i.id), ["1"]);
  assert.deepEqual(newsForCoin(items, "sol").map((i) => i.id), ["2"]);
  assert.equal(newsAge({ publishedAt: NOW - 35 * 60_000 }, NOW), "35m");
  assert.equal(newsAge({ publishedAt: NOW - 2 * 3600_000 }, NOW), "2h");
  assert.equal(newsAge({ publishedAt: null, firstSeenAt: NOW - 3 * 3600_000 }, NOW), "seen 3h ago");
});
