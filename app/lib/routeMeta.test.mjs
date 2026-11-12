// routeMeta: each indexed route's own title/description, in the HTML (Pages Function) and the tab
// (usePageTitle), one source; sitemap + robots; fail open.
// Run: node --test app/lib/routeMeta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { ROUTE_META, routeMetaFor, routeTitle, sitemapXml, SITE_TITLE, DEFAULT_IMAGE } from "./routeMeta.mjs";
import { gateRoutePage } from "./seoGate.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const ROUTES = Object.keys(ROUTE_META);
const PAGE_OF = {
  "/proof": "app/pages/proof/index.tsx", "/lab": "app/pages/lab/index.tsx", "/feed": "app/pages/feed/index.tsx",
  "/arena": "app/pages/arena/index.tsx", "/analyze": "app/pages/analyze/index.tsx", "/token": "app/pages/token/Index.tsx",
  "/intel": "app/pages/intel/index.tsx",
};

test("every named route is indexable: an app route, and not under a noindex header", () => {
  const redirects = read("public/_redirects");
  const headers = read("public/_headers");
  for (const r of ROUTES) {
    assert.match(redirects, new RegExp(`^${r}\\s+/\\s+200`, "m"), `${r} is an app route`);
    assert.doesNotMatch(headers, new RegExp(`^${r}(/\\*)?\\s*\\n\\s+X-Robots-Tag: noindex`, "m"), `${r} must stay indexable`);
  }
});

test("copy: plain words, a real description, no claims the scoreboard hasn't made", () => {
  for (const [r, m] of Object.entries(ROUTE_META)) {
    const meta = routeMetaFor(r);
    assert.ok(meta.title.length <= 75, `${r} title ${meta.title.length} chars`);
    assert.ok(m.description.length >= 60 && m.description.length <= 170, `${r} description ${m.description.length} chars`);
    assert.doesNotMatch(`${m.name} ${m.description}`, /\b(proven|guarantee\w*|best|revolutionary|moon|alpha)\b/i, r);
    assert.doesNotMatch(`${m.name} ${m.description}`, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${r}: no emoji in brand copy`);
    assert.doesNotMatch(m.description, /'/, `${r}: ’ not '`);
  }
});

test("meta shape: title with the site suffix, canonical url, card, website type; unknown routes get nothing", () => {
  const m = routeMetaFor("/proof/");
  assert.equal(m.title, `Proof: the public record | ${SITE_TITLE}`);
  assert.equal(m.url, "https://trade.nexustradinglabs.com/proof");
  assert.equal(m.type, "website");
  assert.match(m.image, /og\/record\.png$/);
  assert.equal(routeMetaFor("/lab?tab=agent").url, "https://trade.nexustradinglabs.com/lab");
  assert.equal(routeMetaFor("/lab").image, DEFAULT_IMAGE);
  assert.equal(routeMetaFor("/perp/PERP_BTC_USDC"), null);
  assert.equal(routeTitle("/portfolio"), SITE_TITLE);
});

const APP = `<!doctype html><html><head>
    <title>Nexus Trading Labs</title>
    <meta property="og:title" content="Nexus Trading Labs" />
    <meta property="og:description" content="site blurb" />
    <meta property="og:type" content="website" />
    <meta name="twitter:title" content="Nexus Trading Labs" />
  </head><body><div id="root"></div></body></html>`;
const appRes = (body = APP, status = 200) => async () => new Response(body, { status, headers: { "Content-Type": "text/html", ETag: "x" } });

test("gateRoutePage writes the route's own head, once, and keeps the app body", async () => {
  const res = await gateRoutePage({ pathname: "/feed", loadApp: appRes() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Cache-Control"), "no-cache");
  assert.equal(res.headers.get("ETag"), null);
  const html = await res.text();
  assert.match(html, /<title>Feed: traders’ calls, graded \| Nexus Trading Labs<\/title>/);
  assert.equal((html.match(/property="og:title"/g) || []).length, 1, "the site tag is replaced, not doubled");
  assert.match(html, /<meta property="og:type" content="website" \/>/);
  assert.doesNotMatch(html, /article:published_time/);
  assert.match(html, /<link rel="canonical" href="https:\/\/trade\.nexustradinglabs\.com\/feed" \/>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<noscript><h1>Feed: traders’ calls, graded<\/h1>/);
});

test("gateRoutePage fails open: an unnamed route, a non-200 app or HTML without a head comes back untouched", async () => {
  const a = await gateRoutePage({ pathname: "/portfolio", loadApp: appRes() });
  assert.equal(await a.text(), APP);
  const b = await gateRoutePage({ pathname: "/proof", loadApp: appRes("oops", 503) });
  assert.equal(b.status, 503);
  const c = await gateRoutePage({ pathname: "/proof", loadApp: appRes("no head here") });
  assert.equal(await c.text(), "no head here");
});

test("one Function per named route, each calling the shared gate; no Function for any other route", () => {
  for (const r of ROUTES) {
    const f = `functions${r}/index.js`;
    assert.ok(existsSync(new URL(f, root)), f);
    const src = read(f);
    assert.match(src, /import \{ gateRoutePage \} from "\.\.\/\.\.\/app\/lib\/seoGate\.mjs";/);
    assert.match(src, /try \{ return await loadApp\(\); \} catch \{ return next\(\); \}/, `${f} fails open`);
  }
  const dirs = readdirSync(new URL("functions/", root), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => `/${d.name}`);
  for (const d of dirs) if (existsSync(new URL(`functions${d}/index.js`, root))) assert.ok(ROUTES.includes(d), `functions${d}/index.js has no ROUTE_META entry`);
});

test("each page sets the same tab title (usePageTitle with its route)", () => {
  for (const [r, f] of Object.entries(PAGE_OF)) {
    const src = read(f);
    assert.match(src, /import \{ usePageTitle \} from "@\/hooks\/usePageTitle";/, f);
    assert.ok(src.includes(`usePageTitle(${r === "/intel" ? 'embedded ? null : "/intel"' : `"${r}"`});`), `${f} sets ${r}`);
  }
  assert.deepEqual(Object.keys(PAGE_OF).sort(), [...ROUTES].sort());
});

test("sitemap.xml is generated from this file and robots.txt points at it", () => {
  assert.equal(read("public/sitemap.xml"), sitemapXml());
  for (const r of ["/", ...ROUTES]) assert.ok(sitemapXml().includes(`<loc>https://trade.nexustradinglabs.com${r}</loc>`), r);
  assert.match(read("public/robots.txt"), /^Sitemap: https:\/\/trade\.nexustradinglabs\.com\/sitemap\.xml$/m);
  assert.match(read("public/robots.txt"), /^Allow: \/$/m);
});
