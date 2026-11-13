// /analyze's instant frame: the X-Ray header + the linked wallet's "analyzing" block written over the boot screen
// (xraySnapshot.mjs, applied by seoGate.mjs gateAnalyzePage from functions/analyze/index.js).
// Run: node --test app/lib/xraySnapshot.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { xraySnapshotHtml, xrayAddressFrom, XRAY_TITLE, XRAY_EYEBROW, XRAY_NOTE } from "./xraySnapshot.mjs";
import { gateAnalyzePage } from "./seoGate.mjs";
import { onRequest } from "../../functions/analyze/index.js";
import { BRAND } from "./brand.mjs";

const INDEX = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
const W = "0x9A3012988d60D61b34660BE06a321F7BF7bCcB28";
const app = (html = INDEX, status = 200) => async () => new Response(html, { status, headers: { "Content-Type": "text/html" } });

test("only a well-formed 0x address from the link is echoed, lower-cased", () => {
  assert.equal(xrayAddressFrom(`?address=${W}`), W.toLowerCase());
  assert.equal(xrayAddressFrom(`?foo=1&address=${W}`), W.toLowerCase());
  for (const bad of ["", "?address=", "?address=0x123", `?address=${W}00`, "?address=<script>", "?address=vitalik.eth", null, undefined])
    assert.equal(xrayAddressFrom(bad), null, String(bad));
});

test("a shared link: the header, that wallet, an analyzing line, empty placeholders", () => {
  const s = xraySnapshotHtml(W.toLowerCase());
  assert.ok(s.includes(XRAY_EYEBROW) && s.includes(XRAY_TITLE) && s.includes(XRAY_NOTE));
  assert.ok(s.includes(`--wallet ${W.toLowerCase()}`));
  assert.match(s, /Analyzing… reading Hyperliquid \+ Orderly\./);
  assert.match(s, /class="nx-boot-line"/, "reuses the boot screen's sweep (index.html CSS, reduced-motion aware)");
});

test("the frame claims nothing about the wallet: no grade, no money, no green or red", () => {
  const s = xraySnapshotHtml(W);
  assert.doesNotMatch(s, /\$\d|PnL|P&amp;L|WIN|LOSS|ACCRUING|COPY/);
  assert.ok(!s.includes(BRAND.win) && !s.includes(BRAND.loss));
});

test("no address = the header and a loading line, no wallet block", () => {
  for (const a of [null, "nope", "<img src=x onerror=alert(1)>"]) {
    const s = xraySnapshotHtml(a);
    assert.ok(s.includes(XRAY_TITLE));
    assert.match(s, /Loading the analyzer…/);
    assert.doesNotMatch(s, /--wallet|<img/);
  }
});

test("the live page's header reads the same three strings", () => {
  const page = readFileSync(new URL("../pages/analyze/index.tsx", import.meta.url), "utf8");
  assert.match(page, /eyebrow=\{XRAY_EYEBROW\}\s*title=\{XRAY_TITLE\}\s*note=\{XRAY_NOTE\}/);
});

test("the Function: meta + the frame over the real index.html's boot screen, the wallet from the query", async () => {
  const res = await onRequest({
    request: new Request(`https://trade.nexustradinglabs.com/analyze?address=${W}`),
    env: { ASSETS: { fetch: app() } },
    next: async () => new Response("next"),
  });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.match(html, /<div id="root"><div class="nx-xray-snapshot"/, "inside #root, so createRoot clears it on mount");
  assert.doesNotMatch(html, /class="nx-boot-sub"/);
  assert.ok(html.includes(`--wallet ${W.toLowerCase()}`));
  assert.match(html, /<title>Wallet X-Ray: any trader’s record, graded \| Nexus Trading Labs<\/title>/);
  assert.equal(res.headers.get("Cache-Control"), "no-cache");
});

test("fail open: a page without the boot screen, or a missing app shell, passes through", async () => {
  const plain = "<!doctype html><html><head><title>x</title></head><body><div id=\"root\"></div></body></html>";
  const a = await gateAnalyzePage({ pathname: "/analyze", search: `?address=${W}`, loadApp: app(plain) });
  assert.equal(a.status, 200);
  assert.doesNotMatch(await a.text(), /nx-xray-snapshot/);
  const b = await gateAnalyzePage({ pathname: "/analyze", search: "", loadApp: app("gone", 404) });
  assert.equal(b.status, 404);
});
