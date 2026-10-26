// The text a search engine reads for a call page (Search Console, 2026-10-25): built from the stored
// call, grade only from a current stamp, lifecycle otherwise, R:R from the levels.
// Run: node --test app/lib/callPageMeta.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { callPageMeta, injectCallMeta, fmtPx } from "./callPageMeta.mjs";

const W = "0x9a3012988d60d61b34660be06a321f7bf7bccb28";
const base = { id: "c1", symbol: "PERP_BTC_USDC", direction: "LONG", entryPrice: 64100, stopLoss: 63200, takeProfit1: 65450, riskReward: 9, createdAt: Date.UTC(2026, 9, 12, 14), isPublic: true };

test("graded call: title and description carry the grade; R:R from the levels, not the stored field", () => {
  const m = callPageMeta(base, { wallet: W, id: "c1", displayName: "mfer", graded: { outcome: "WIN", r: 1.5 } });
  assert.equal(m.title, "BTC LONG call by mfer · graded WIN +1.50R | Nexus Trading Labs");
  assert.match(m.description, /^Posted Oct 12, 2026\. Entry \$64,100 · stop \$63,200 · target \$65,450 \(1:1\.50\)\. Graded WIN \+1\.50R\./);
  assert.doesNotMatch(m.description, /1:9/);
  assert.equal(m.url, `https://trade.nexustradinglabs.com/feed/thesis/${W}/c1`);
  assert.equal(m.image, `https://og.nexustradinglabs.com/og/thesis/${W}/c1.png`);
});

test("a loss reads with a real minus sign", () => {
  const m = callPageMeta(base, { wallet: W, id: "c1", graded: { outcome: "LOSS", r: -1 } });
  assert.match(m.title, /graded LOSS −1\.00R/);
  assert.match(m.title, /by 0x9a30…cb28/);
});

test("no current stamp → never a grade, even if the stored call carries an old one", () => {
  const m = callPageMeta({ ...base, gradedOutcome: "WIN", gradedR: 1.5, status: "HIT_TP", fillState: "OPEN" }, { wallet: W, id: "c1", graded: null });
  assert.match(m.title, /· open, not graded yet \|/);
  assert.doesNotMatch(m.title + m.description, /WIN/);
});

test("lifecycle states: awaiting fill, fill not checked, not graded + why", () => {
  assert.match(callPageMeta({ ...base, fillState: "WORKING" }, { wallet: W, id: "c1" }).title, /awaiting fill at \$64,100/);
  assert.match(callPageMeta(base, { wallet: W, id: "c1" }).title, /fill not checked yet/);
  const bad = callPageMeta({ ...base, stopLoss: 65000 }, { wallet: W, id: "c1" });
  assert.match(bad.title, /not graded: stop or target on the wrong side of entry/);
});

test("a split whose runner was stopped says so", () => {
  const split = { ...base, exitPlan: "SPLIT_50", takeProfit2: 66800 }; // R1 = 1.5 → stopped runner = 0.25R
  const m = callPageMeta(split, { wallet: W, id: "c1", graded: { outcome: "WIN", r: 0.25 } });
  assert.match(m.title, /graded: TP1 hit, runner stopped \+0\.25R/);
});

test("prices keep the digits that matter", () => {
  assert.equal(fmtPx(64100), "$64,100");
  assert.equal(fmtPx(2416.7), "$2,416.70");
  assert.equal(fmtPx(15.42), "$15.42");
  assert.equal(fmtPx(0.4321), "$0.4321");
  assert.equal(fmtPx(0.000123), "$0.000123");
  assert.equal(fmtPx(0), "—");
});

test("inject: replaces the site title + og/twitter tags once, adds description, canonical, noscript; escapes", () => {
  const html = `<!DOCTYPE html><html><head>
    <title>Nexus Trading Labs</title>
    <meta property="og:title" content="Nexus Trading Labs" />
    <meta property="og:description" content="site" />
    <meta property="og:image" content="https://site.png" />
    <meta property="og:url" content="https://trade.nexustradinglabs.com" />
    <meta property="og:type" content="website" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Nexus Trading Labs" />
    <meta name="twitter:description" content="site" />
    <meta name="twitter:image" content="https://site.png" />
    <meta name="fc:miniapp" content='{"x":1}' />
  </head><body><div id="root"></div></body></html>`;
  const m = callPageMeta({ ...base, symbol: "PERP_<b>_USDC" }, { wallet: W, id: "c1", displayName: 'a"b<c>' });
  const out = injectCallMeta(html, m);
  for (const tag of ["og:title", "og:description", "og:image", "og:url", "og:type", "twitter:card", "twitter:title", "twitter:description", "twitter:image"])
    assert.equal((out.match(new RegExp(`"${tag}"`, "g")) || []).length, 1, tag);
  assert.equal((out.match(/<title>/g) || []).length, 1);
  assert.match(out, /<meta name="description" content="Posted Oct 12, 2026/);
  assert.match(out, new RegExp(`<link rel="canonical" href="https://trade.nexustradinglabs.com/feed/thesis/${W}/c1" />`));
  assert.match(out, /fc:miniapp/, "unrelated tags stay");
  assert.match(out, /<body><noscript><h1>|<body>\s*<noscript><h1>/);
  assert.doesNotMatch(out, /<b>|a"b/, "user text is escaped");
  assert.match(out, /a&quot;b&lt;c&gt;/);
  assert.match(out, /og:type" content="article"/);
});

test("inject: html without a head is returned unchanged", () => {
  assert.equal(injectCallMeta("plain", callPageMeta(base, { wallet: W, id: "c1" })), "plain");
});
