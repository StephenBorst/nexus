// Soft-404 fix (Search Console, 2026-10-19): a missing call permalink answers 404 + noindex,
// app routes carry X-Robots-Tag: noindex, and every failure mode serves the page as before.
// Run: node --test app/lib/seoGate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gateThesisPage, thesisLookupUrl, lookupVerdict } from "./seoGate.mjs";
import { onRequest } from "../../functions/feed/thesis/[wallet]/[id].js";

const SHELL = "<!doctype html><div id=root></div>";
const next = async () => new Response(SHELL, { status: 200, headers: { "Content-Type": "text/html" } });
const answering = (status) => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(null, { status }); } }; };
const W = "0x9a3012988d60d61b34660be06a321f7bf7bccb28";

test("a call lab-api doesn't have → 404 + noindex, same app body", async () => {
  const f = answering(404);
  const res = await gateThesisPage({ wallet: W, id: "nope", loadApp: next, fetchImpl: f.fetchImpl });
  assert.equal(res.status, 404);
  assert.equal(res.headers.get("X-Robots-Tag"), "noindex");
  assert.equal(res.headers.get("Cache-Control"), "no-cache");
  assert.equal(await res.text(), SHELL); // people still get the page's own "not public" screen
  assert.equal(f.calls[0].init.method, undefined); // a GET
  assert.equal(f.calls[0].url, `https://og.nexustradinglabs.com/thesis/${W}/nope/meta`);
});

test("a public call with meta → 200, the call's own title in the HTML", async () => {
  const meta = { title: "BTC LONG call by mfer · open, not graded yet | Nexus Trading Labs", description: "Entry $64,100.", headline: "BTC LONG call by mfer", url: "https://trade.nexustradinglabs.com/feed/thesis/x/y", image: "https://og/x.png", publishedAt: null };
  const html = "<!doctype html><html><head><title>Nexus Trading Labs</title><meta property=\"og:title\" content=\"Nexus Trading Labs\" /></head><body><div id=root></div></body></html>";
  const res = await gateThesisPage({ wallet: W, id: "y", loadApp: async () => new Response(html, { headers: { "Content-Type": "text/html", "Content-Length": "99" } }),
    fetchImpl: async () => new Response(JSON.stringify({ meta }), { status: 200 }) });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Content-Length"), null);
  const out = await res.text();
  assert.match(out, /<title>BTC LONG call by mfer · open, not graded yet \| Nexus Trading Labs<\/title>/);
  assert.equal((out.match(/property="og:title"/g) || []).length, 1, "site og:title replaced, not duplicated");
  assert.match(out, /<noscript><h1>BTC LONG call by mfer<\/h1>/);
});

test("a 200 without meta (an older lab-api) serves the page unchanged", async () => {
  const res = await gateThesisPage({ wallet: W, id: "y", loadApp: next, fetchImpl: async () => new Response(JSON.stringify({ thesis: {} }), { status: 200 }) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), SHELL);
});

test("a public call → 200, indexable", async () => {
  const res = await gateThesisPage({ wallet: W, id: "reg-bd180a17119ae795", loadApp: next, fetchImpl: answering(200).fetchImpl });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("X-Robots-Tag"), null);
});

test("fails open: 405 (old lab-api), 5xx, network error, timeout all serve the page as before", async () => {
  for (const s of [405, 500, 503, 429]) {
    const res = await gateThesisPage({ wallet: W, id: "x", loadApp: next, fetchImpl: answering(s).fetchImpl });
    assert.equal(res.status, 200, `status ${s}`);
    assert.equal(res.headers.get("X-Robots-Tag"), null);
  }
  const boom = await gateThesisPage({ wallet: W, id: "x", loadApp: next, fetchImpl: async () => { throw new Error("down"); } });
  assert.equal(boom.status, 200);
  const keepAlive = setTimeout(() => {}, 2000); // AbortSignal.timeout's timer doesn't hold the loop open
  const slow = await gateThesisPage({ wallet: W, id: "x", loadApp: next, timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(signal.reason))) });
  clearTimeout(keepAlive);
  assert.equal(slow.status, 200);
});

test("lookup URL encodes the parts; empty or absurd parts are a 404 without asking", async () => {
  assert.equal(thesisLookupUrl(W, "a/b?c"), `https://og.nexustradinglabs.com/thesis/${W}/a%2Fb%3Fc/meta`);
  assert.equal(thesisLookupUrl("", "x"), null);
  assert.equal(thesisLookupUrl(W, "x".repeat(201)), null);
  const f = answering(200);
  const res = await gateThesisPage({ wallet: W, id: "", loadApp: next, fetchImpl: f.fetchImpl });
  assert.equal(res.status, 404);
  assert.equal(f.calls.length, 0);
});

test("verdicts", () => {
  assert.equal(lookupVerdict(404), "missing");
  assert.equal(lookupVerdict(200), "found");
  assert.equal(lookupVerdict(204), "found");
  assert.equal(lookupVerdict(405), "unknown");
});

test("the Pages Function: asks the assets for \"/\"; non-GET passes through; an internal error serves the app", async () => {
  const asked = [];
  const env = { ASSETS: { fetch: async (req) => { asked.push(new URL(req.url).pathname); return next(); } } };
  const post = await onRequest({ request: new Request("https://x/feed/thesis/a/b", { method: "POST" }), params: {}, env, next });
  assert.equal(post.status, 200);
  let n = 0;
  const flaky = { ASSETS: { fetch: async () => { n++; if (n === 1) throw new Error("asset fetch failed"); return next(); } } };
  const res = await onRequest({ request: new Request("https://x/feed/thesis/a/b"), params: { wallet: W, id: "b" }, env: flaky, next });
  assert.equal(res.status, 200);
  const empty = await onRequest({ request: new Request("https://x/feed/thesis/a/b"), params: { wallet: W, id: "" }, env, next });
  assert.equal(empty.status, 404);
  assert.deepEqual(asked, ["/"]);
});

// public/_headers: Cloudflare matches the request path, exact or with a trailing /* splat.
function noindexPaths() {
  const lines = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8").split("\n");
  const out = new Set(); let path = null;
  for (const l of lines) {
    if (/^\//.test(l)) path = l.trim();
    else if (path && /^\s+X-Robots-Tag:\s*noindex/i.test(l)) out.add(path);
  }
  return out;
}
const matches = (rules, p) => [...rules].some((r) => r === p || (r.endsWith("/*") && p.startsWith(r.slice(0, -1))));

test("app routes are noindex; the content routes are not", () => {
  const rules = noindexPaths();
  for (const p of ["/perp", "/perp/PERP_BTC_USDC", "/portfolio", "/portfolio/positions", "/markets", "/leaderboard", "/rewards/affiliate", "/vaults", "/points", "/swap", "/messages", "/ops/revenue"])
    assert.ok(matches(rules, p), `${p} should be noindex`);
  for (const p of ["/", "/lab", "/feed", `/feed/thesis/${W}/x`, `/feed/trader/${W}`, "/proof", "/analyze", "/token", "/token/BTC", "/intel", "/arena", "/assets/index-abc.js"])
    assert.ok(!matches(rules, p), `${p} must stay indexable`);
});
