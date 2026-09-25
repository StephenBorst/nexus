import { test } from "node:test";
import assert from "node:assert/strict";
import { handleXrayShare, buildXrayCardSvg, loadCardInputs } from "./routes-xrayshare.mjs";
import { syncTape } from "../../app/lib/hlTape.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 25, 14, 0);
const W = "0x" + "da".repeat(20);

function kv() {
  const m = new Map();
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async list() { return { keys: [] }; } };
}
let tid = 1;
const close = (daysAgo, pnl) => ({ tid: tid++, time: NOW - daysAgo * DAY, coin: "BTC", px: "1", sz: "1", side: "A", dir: "Close Long", closedPnl: String(pnl), fee: "0" });
async function envWithTape(fills) {
  const env = { LAB_STORE: kv() };
  const { record } = syncTape(null, [fills], { now: NOW });
  await env.LAB_STORE.put(`xray:hltape:${W}`, JSON.stringify(record));
  return env;
}
const req = (path) => new Request(`https://og.nexustradinglabs.com${path}`, { headers: { "CF-Connecting-IP": "9.9.9.9" } });
const noHL = async () => { throw new Error("HL must not be called"); };
const neverLimit = () => false;

test("share page: real meta from the stored tape, versioned image, forwards to /analyze", async () => {
  const fills = [...Array.from({ length: 14 }, () => close(5, 30)), ...Array.from({ length: 8 }, () => close(5, -15))];
  const env = await envWithTape(fills);
  const res = await handleXrayShare(["share", "xray", W], req(`/share/xray/${W}`), env, { now: NOW, hlInfo: noHL });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get("Content-Type"), /text\/html/);
  assert.match(html, /<meta property="og:title" content="0xdada…dada · 30D PF 3\.50 · 64% win · 22 trades — Wallet X-Ray">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, new RegExp(`og:image" content="https://og\\.nexustradinglabs\\.com/og/xray/${W}\\.png\\?v=[0-9]+-22-0"`));
  assert.match(html, new RegExp(`url=https://trade\\.nexustradinglabs\\.com/analyze\\?address=${W}`));
});

test("card image: PNG via the renderer, cached when versioned", async () => {
  const env = await envWithTape(Array.from({ length: 25 }, () => close(3, 10)));
  const store = new Map();
  const cache = { async match(r) { return store.get(r.url)?.clone() ?? null; }, async put(r, res) { store.set(r.url, res); } };
  let renders = 0;
  const renderPng = async (svg) => { renders++; assert.match(svg, /30D GRADE/); return new Uint8Array([137, 80, 78, 71]); };
  const deps = { now: NOW, hlInfo: noHL, renderPng, cache };
  const a = await handleXrayShare(["og", "xray", `${W}.png`], req(`/og/xray/${W}.png?v=1`), env, deps);
  assert.equal(a.headers.get("Content-Type"), "image/png");
  assert.equal(a.headers.get("Cache-Control"), "public, max-age=86400");
  await handleXrayShare(["og", "xray", `${W}.png`], req(`/og/xray/${W}.png?v=1`), env, deps);
  assert.equal(renders, 1, "second hit served from cache");
  const bare = await handleXrayShare(["og", "xray", `${W}.png`], req(`/og/xray/${W}.png`), env, deps);
  assert.equal(bare.headers.get("Cache-Control"), "public, max-age=300");
});

test("renderer failure falls back to SVG; no .png → SVG", async () => {
  const env = await envWithTape([close(1, 5)]);
  const bad = await handleXrayShare(["og", "xray", `${W}.png`], req(`/og/xray/${W}.png`), env, { now: NOW, hlInfo: noHL, renderPng: async () => { throw new Error("x"); } });
  assert.equal(bad.headers.get("Content-Type"), "image/svg+xml");
  const svg = await handleXrayShare(["og", "xray", W], req(`/og/xray/${W}`), env, { now: NOW, hlInfo: noHL });
  const body = await svg.text();
  assert.match(body, /ACCRUING/, "1 trade in 30D → ACCRUING, not a grade");
  assert.doesNotMatch(body, /PROFIT FACTOR/);
});

test("unknown wallet: seeds within budget, else renders the honest empty card", async () => {
  const env = { LAB_STORE: kv() };
  const hl = async (b) => (b.type === "userFillsByTime" ? (b.startTime === 0 ? [close(2, 7)] : []) : []);
  const seeded = await loadCardInputs(env, W, { hlInfo: hl, now: NOW, limiter: neverLimit });
  assert.equal(seeded.card.kind, "HL");
  const env2 = { LAB_STORE: kv() };
  const blocked = await loadCardInputs(env2, W, { hlInfo: noHL, now: NOW, limiter: () => true });
  assert.equal(blocked.card.kind, "NONE");
});

test("Orderly-only wallet gets its watched record on the card", async () => {
  const env = { LAB_STORE: kv() };
  const hist = Array.from({ length: 25 }, (_, i) => ({ t: NOW - (24 - i) * DAY, realized: 1000 + i * 50, unrealized: 0, markets: 3 }));
  await env.LAB_STORE.put(`xray:hist:${W}`, JSON.stringify(hist));
  const { card } = await loadCardInputs(env, W, { hlInfo: async () => [], now: NOW, limiter: neverLimit });
  assert.equal(card.kind, "WATCHED");
  assert.match(buildXrayCardSvg(card), /WATCHED RECORD|WATCHED · ACCRUING/);
});

test("bad address → 400; other paths → null; non-GET → 405", async () => {
  const env = { LAB_STORE: kv() };
  assert.equal((await handleXrayShare(["share", "xray", "0xnope"], req("/share/xray/0xnope"), env)).status, 400);
  assert.equal(await handleXrayShare(["share", "thesis", W], req("/share/thesis"), env), null);
  const post = new Request(`https://og.nexustradinglabs.com/share/xray/${W}`, { method: "POST" });
  assert.equal((await handleXrayShare(["share", "xray", W], post, env)).status, 405);
});

test("card text is escaped in the SVG", () => {
  const svg = buildXrayCardSvg({ status: "NONE", kind: "NONE", who: "<b>", headline: "A&B", headlineTone: "flat", stats: [], context: '"x"', partialNote: null, stamp: "s" });
  assert.match(svg, /&lt;b&gt;/);
  assert.match(svg, /A&amp;B/);
  assert.doesNotMatch(svg, /<b>/);
});
