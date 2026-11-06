import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND } from "../../app/lib/brand.mjs";
import { recordCard } from "../../app/lib/recordShare.mjs";
import { handleRecordShare, buildRecordCardSvg } from "./routes-recordshare.mjs";

const NOW = Date.parse("2026-11-06T05:00:00Z");
const PULSE = { ok: true, open: 2, gradedWeek: 1, last: null, engines: { open: 1, gradedWeek: 10, last: null },
  headline: { cleared: true }, signals: [{ axis: "level_reclaim", trades: 48, paper: { trades: 1, target: 30 } }] };
const ALLOWED = new Set(Object.values(BRAND).map((c) => c.toLowerCase()));
const colours = (svg) => [...svg.matchAll(/#[0-9a-fA-F]{6}\b/g)].map((m) => m[0].toLowerCase());

test("card: brand colours only, no green/red (counts, not money), bone top rule, both states", () => {
  for (const card of [recordCard(PULSE, NOW), recordCard(null, NOW), recordCard({ ...PULSE, signals: [] }, NOW)]) {
    const svg = buildRecordCardSvg(card);
    for (const c of colours(svg)) assert.ok(ALLOWED.has(c), `colour ${c} is not in brand.mjs`);
    assert.ok(!colours(svg).includes(BRAND.win.toLowerCase()) && !colours(svg).includes(BRAND.loss.toLowerCase()));
    assert.match(svg, new RegExp(`height="3" fill="${BRAND.brand}"`));
  }
  const svg = buildRecordCardSvg(recordCard(PULSE, NOW));
  assert.match(svg, /2 open/); assert.match(svg, /OUR ENGINES/); assert.match(svg, /On paper: 1 of 30\. Nothing armed\./);
  const down = buildRecordCardSvg(recordCard(null, NOW));
  assert.match(down, /Live counts are unavailable right now\./);
  assert.ok(!/proven|cleared/.test(down), "an unreadable pulse makes no claim about the signals");
  assert.match(buildRecordCardSvg(recordCard({ ...PULSE, headline: { cleared: false }, signals: [] }, NOW)), /Nothing has proven itself yet\./);
});

test("routes: share page carries the versioned card and forwards to /proof; png renders; other paths fall through", async () => {
  const deps = { now: NOW, readPulse: async () => PULSE, cache: null };
  assert.equal(await handleRecordShare(["share", "recordx"], new Request("https://x/share/recordx"), {}, deps), null);
  assert.equal(await handleRecordShare(["og", "thesis", "a", "b"], new Request("https://x/og/thesis/a/b"), {}, deps), null);
  const page = await handleRecordShare(["share", "record"], new Request("https://x/share/record?v=1"), {}, deps);
  const html = await page.text();
  assert.match(html, /twitter:card" content="summary_large_image"/);
  assert.match(html, /og:image" content="https:\/\/og\.nexustradinglabs\.com\/og\/record\.png\?v=2026-11-06-/);
  assert.match(html, /location\.replace\("https:\/\/trade\.nexustradinglabs\.com\/proof"\)/);
  const png = await handleRecordShare(["og", "record.png"], new Request("https://x/og/record.png?v=1"), {}, { ...deps, renderPng: async () => new Uint8Array([1, 2]) });
  assert.equal(png.headers.get("Content-Type"), "image/png");
  const svg = await handleRecordShare(["og", "record"], new Request("https://x/og/record"), {}, deps);
  assert.equal(svg.headers.get("Content-Type"), "image/svg+xml");
  const post = await handleRecordShare(["og", "record"], new Request("https://x/og/record", { method: "POST" }), {}, deps);
  assert.equal(post.status, 405);
});

test("an unreadable pulse still serves an honest card, never an error", async () => {
  const res = await handleRecordShare(["og", "record"], new Request("https://x/og/record"), {}, { now: NOW, readPulse: async () => { throw new Error("kv down"); }, cache: null });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Live counts are unavailable/);
});

test("index.js wires the card to the same scoreboard key as the pulse", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /handleRecordShare\(parts, request, env, \{ renderPng: renderMonoPng, scorecardKey: axisbtCacheKey\(20\) \}\)/);
});
