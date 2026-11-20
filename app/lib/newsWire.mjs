// ── The news wire: headlines read by OUR server, tagged with the coins they name (borst 2026-11-20) ─────────────────
// Before: the browser pulled four RSS feeds through rss2json, a third party that saw every reader's IP, and the stories
// were sorted by a topic regex only, never tied to a coin. Now lab-api reads the feeds itself (routes-news.mjs), parses
// them here, tags each story with the coins it names, and serves one list: GET /intel/news[?coin=ETH].
// Rules here, pure and tested (newsWire.test.mjs). A headline is an input, never a direction: nothing here reads tone.

/** The feeds, read by lab-api. `kind` says what a feed is; the Fed's own press releases are a primary source. */
export const NEWS_FEEDS = Object.freeze([
  { id: "coindesk", name: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/", kind: "crypto" },
  { id: "cointelegraph", name: "Cointelegraph", url: "https://cointelegraph.com/rss", kind: "crypto" },
  { id: "decrypt", name: "Decrypt", url: "https://decrypt.co/feed", kind: "crypto" },
  { id: "theblock", name: "The Block", url: "https://www.theblock.co/rss.xml", kind: "crypto" },
  { id: "blockworks", name: "Blockworks", url: "https://blockworks.co/feed", kind: "crypto" },
  { id: "yahoo", name: "Yahoo Finance", url: "https://finance.yahoo.com/news/rssindex", kind: "markets" },
  { id: "fed", name: "Federal Reserve", url: "https://www.federalreserve.gov/feeds/press_all.xml", kind: "macro" },
]);

export const NEWS_WINDOW_MS = 48 * 3600_000;   // a story older than this drops off the wire
export const NEWS_PER_SOURCE = 15;             // no single feed can flood the top
export const NEWS_MAX = 90;
export const NEWS_SUMMARY_CHARS = 240;
export const NEWS_CATEGORIES = Object.freeze(["CRYPTO", "MACRO", "DEFI", "MARKETS", "GEOPOLITICS"]);

// ── Coins a headline names ──────────────────────────────────────────────────────────────────────────────────────────
// A ticker counts only in capitals as its own word ("ETH", "$ETH"); a name counts as a word in any case ("ethereum").
// AMBIGUOUS tickers are English words or other acronyms (LINK, NEAR, OP, DOT = the US Department of Transportation…):
// they count only with a "$" in front, or by their name. Names that are also plain words ("Avalanche", "Sui", "Tron")
// count only when capitalized. A wrong tag puts a story on the wrong coin, so this errs toward leaving one out.
export const NEWS_COINS = Object.freeze({
  BTC: { names: ["bitcoin"] },
  ETH: { names: ["ethereum", "ether"] },
  SOL: { names: ["solana"] },
  BNB: { names: ["bnb chain"] },
  XRP: { names: ["ripple"] },
  LINK: { names: ["chainlink"], ambiguous: true },
  DOGE: { names: ["dogecoin"] },
  AVAX: { capNames: ["Avalanche"] },
  HYPE: { names: ["hyperliquid"], ambiguous: true },
  ZEC: { names: ["zcash"] },
  NEAR: { capNames: ["NEAR Protocol", "Near Protocol"], ambiguous: true },
  SUI: { capNames: ["Sui"] },
  PUMP: { names: ["pump.fun", "pumpfun"], ambiguous: true },
  ENA: { names: ["ethena"] },
  ONDO: { names: ["ondo finance"], capNames: ["Ondo"] },
  INJ: { names: ["injective"] },
  ZRO: { names: ["layerzero"] },
  ARB: { names: ["arbitrum"] },
  WLD: { names: ["worldcoin"] },
  ADA: { names: ["cardano"] },
  LTC: { names: ["litecoin"] },
  TRX: { capNames: ["Tron", "TRON"] },
  DOT: { names: ["polkadot"], ambiguous: true },
  TON: { names: ["toncoin"] },
  APT: { names: ["aptos"] },
  OP: { capNames: ["Optimism"], ambiguous: true },
  PEPE: { capNames: ["Pepe"] },
  SHIB: { names: ["shiba inu"] },
  AAVE: { capNames: ["Aave"] },
  UNI: { names: ["uniswap"] },
  TIA: { names: ["celestia"] },
  SEI: { capNames: ["Sei"] },
  TAO: { names: ["bittensor"] },
  // Orderly's index and commodity perps: macro headlines land on the market they move. Tickers here are never bare
  // words (CL, XAU), so these count by name only.
  SPX500: { names: ["s&p 500", "s&p500", "s&p"], ambiguous: true },
  NAS100: { names: ["nasdaq", "nasdaq 100", "nasdaq-100"], ambiguous: true },
  XAU: { names: ["gold price", "gold prices", "gold futures", "spot gold", "bullion"], capNames: ["Gold"], ambiguous: true, not: /digital gold/i },
  CL: { names: ["crude", "oil price", "oil prices", "wti", "brent"], ambiguous: true },
});

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const COIN_TESTS = Object.entries(NEWS_COINS).map(([coin, c]) => {
  const tests = [];
  // "$ETH" always; bare "ETH" only when the ticker is not ambiguous. Capitals only, its own word.
  tests.push(new RegExp(`(?<![A-Za-z0-9])\\$${coin}(?![A-Za-z0-9])`));
  if (!c.ambiguous) tests.push(new RegExp(`(?<![A-Za-z0-9$])${coin}(?![A-Za-z0-9])`));
  for (const n of c.names || []) tests.push(new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`, "i"));
  for (const n of c.capNames || []) tests.push(new RegExp(`(?<![A-Za-z0-9])${esc(n)}(?![A-Za-z0-9])`));
  return [coin, tests, c.not || null];
});

/** The coins a text names, in NEWS_COINS order. */
export function newsCoins(text) {
  const t = String(text || "");
  if (!t) return [];
  return COIN_TESTS.filter(([, tests, not]) => tests.some((re) => re.test(not ? t.replace(new RegExp(not.source, "gi"), " ") : t))).map(([coin]) => coin);
}

/** A topic label from the words used (the old client rule, unchanged), or the feed's own kind for the Fed. */
export function newsCategory(title, summary, kind) {
  if (kind === "macro") return "MACRO";
  const t = `${title || ""} ${summary || ""}`.toLowerCase();
  if (/\b(fed|fomc|powell|interest rate|inflation|gdp|recession|economy|treasury|cpi|monetary)\b/.test(t)) return "MACRO";
  if (/\b(defi|dex|perpetual|protocol|yield|aave|uniswap|orderly|gmx|liquidity|onchain)\b/.test(t)) return "DEFI";
  if (/\b(geopolit|war|sanction|iran|russia|china|tariff|trade war|conflict|military)\b/.test(t)) return "GEOPOLITICS";
  if (/\b(bitcoin|btc|ethereum|eth|solana|sol|crypto|blockchain|altcoin|token|nft|web3)\b/.test(t)) return "CRYPTO";
  if (/\b(stocks|equity|nasdaq|s&p|dow|earnings|ipo|nyse|market cap|share)\b/.test(t)) return "MARKETS";
  return kind === "crypto" ? "CRYPTO" : "MARKETS";
}

// ── Parsing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", ndash: "–", mdash: "—", hellip: "…" };
export function decodeEntities(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const unCdata = (s) => String(s || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
/** Plain text: CDATA opened, entities decoded, tags dropped (twice: an escaped "&lt;p&gt;" decodes into a tag). */
export function plainText(s) {
  const once = decodeEntities(unCdata(s).replace(/<[^>]*>/g, " "));
  return once.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
/** Only an http(s) link is ever served (a "javascript:" href in a feed would run in the reader's browser). */
export function safeLink(u) {
  const s = decodeEntities(unCdata(u)).trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(s) ? s : "";
}

/** RSS <item> and Atom <entry> blocks → {title, link, summary, published (raw)}. Never throws. */
export function parseFeed(xml) {
  const src = String(xml || "");
  const out = [];
  const blocks = src.match(/<item[\s>][\s\S]*?<\/item>/gi) || src.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  for (const b of blocks) {
    const title = plainText(tag(b, "title"));
    let link = safeLink(tag(b, "link"));
    if (!link) {
      const alt = b.match(/<link\b[^>]*rel=["']alternate["'][^>]*>/i) || b.match(/<link\b[^>]*href=[^>]*>/i);
      const href = alt && alt[0].match(/href=["']([^"']+)["']/i);
      link = href ? safeLink(href[1]) : "";
    }
    if (!link) link = safeLink(tag(b, "guid"));
    const summary = plainText(tag(b, "description") || tag(b, "summary") || tag(b, "content"));
    const published = plainText(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date"));
    if (title) out.push({ title, link, summary, published });
  }
  return out;
}

export function parseNewsDate(s) {
  const t = Date.parse(String(s || "").trim());
  return Number.isFinite(t) ? t : null;
}

/** FNV-1a, 32-bit hex: a stable id from the link (else the title). */
export function newsId(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s || "")) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * One feed's reply → wire items. A story's time counts only if it is believable: not in the future (> 10 min), and not
 * shared to the second by 4+ stories in the same feed (a publisher re-stamping old stories with its build time, the
 * "same stories from a month ago" bug). Such a story is kept but marked undated, and sinks below dated ones.
 */
export function feedItems(xml, feed, now = Date.now()) {
  const raw = parseFeed(xml);
  const counts = new Map();
  const rows = raw.map((r) => ({ ...r, t: parseNewsDate(r.published) }));
  for (const r of rows) if (r.t != null) counts.set(r.t, (counts.get(r.t) || 0) + 1);
  const out = [];
  for (const r of rows) {
    const dated = r.t != null && r.t <= now + 10 * 60_000 && (counts.get(r.t) || 0) < 4;
    if (dated && now - r.t > NEWS_WINDOW_MS) continue;
    const summary = r.summary.length > NEWS_SUMMARY_CHARS ? `${r.summary.slice(0, NEWS_SUMMARY_CHARS - 1).trimEnd()}…` : r.summary;
    out.push({
      id: newsId(r.link || `${feed.id}:${r.title}`),
      title: r.title.slice(0, 300),
      summary,
      link: r.link,
      source: feed.name,
      sourceId: feed.id,
      category: newsCategory(r.title, r.summary, feed.kind),
      coins: newsCoins(`${r.title} ${r.summary}`),
      publishedAt: dated ? r.t : null,
      firstSeenAt: now,
    });
  }
  return out;
}

const titleKey = (t) => String(t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 60);

/**
 * The wire after a read: what we held + what just came in. One story once (same id, or the same title from two feeds:
 * the first seen stays). A story keeps the time it was first seen, so an undated one doesn't jump back to the top on
 * every read. Window 48h (by its own time, else first seen), ≤ NEWS_PER_SOURCE a feed, ≤ NEWS_MAX in all.
 * Order: dated newest first, then undated by first seen.
 */
export function mergeNews(prev, fresh, now = Date.now()) {
  const byId = new Map();
  const titles = new Set();
  for (const it of [...(prev || []), ...(fresh || [])]) {
    if (!it || !it.id || !it.title) continue;
    const old = byId.get(it.id);
    if (old) { byId.set(it.id, { ...it, firstSeenAt: old.firstSeenAt, publishedAt: old.publishedAt ?? it.publishedAt }); continue; }
    const k = titleKey(it.title);
    if (titles.has(k)) continue;
    titles.add(k);
    byId.set(it.id, it);
  }
  const live = [...byId.values()].filter((i) => now - (i.publishedAt ?? i.firstSeenAt) <= NEWS_WINDOW_MS);
  live.sort((a, b) => {
    const da = a.publishedAt != null, db = b.publishedAt != null;
    if (da !== db) return da ? -1 : 1;
    return da ? b.publishedAt - a.publishedAt : b.firstSeenAt - a.firstSeenAt;
  });
  const per = new Map();
  const out = [];
  for (const i of live) {
    const n = (per.get(i.sourceId) || 0) + 1;
    per.set(i.sourceId, n);
    if (n <= NEWS_PER_SOURCE) out.push(i);
    if (out.length >= NEWS_MAX) break;
  }
  return out;
}

/** Stories naming a coin (bare ticker or PERP_ symbol), newest first. */
export function newsForCoin(items, coin) {
  const c = String(coin || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");
  return (items || []).filter((i) => Array.isArray(i.coins) && i.coins.includes(c));
}

/** "35m" / "2h" / "1d": the age of a story by its own time, else by when we first saw it ("seen 2h ago"). */
export function newsAge(item, now = Date.now()) {
  const t = item?.publishedAt ?? item?.firstSeenAt;
  if (!Number.isFinite(t)) return "";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  const w = m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
  return item.publishedAt != null ? w : `seen ${w} ago`;
}
