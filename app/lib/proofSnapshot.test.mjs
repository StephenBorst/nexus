// /proof's instant first paint: the static header written over the boot screen (proofSnapshot.mjs, applied by
// seoGate.mjs gateProofPage from functions/proof/index.js). Run: node --test app/lib/proofSnapshot.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { proofSnapshotHtml, pulseCountsLine } from "./proofSnapshot.mjs";
import { gateProofPage } from "./seoGate.mjs";
import { HEADLINE_DEFAULT, PROOF_BAR_LINE } from "./proofCopy.mjs";
import { BRAND } from "./brand.mjs";

const INDEX = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
// The shape GET /calls/pulse served on 2026-11-13 (routes-pulse.mjs v5), trimmed to what the snapshot reads.
const PULSE = Object.freeze({
  ok: true, windowDays: 7, open: 0, gradedWeek: 11,
  engines: { open: 3, gradedWeek: 1 },
  headline: { cleared: true, axes: ["level_reclaim"], title: "level_reclaim cleared the bar.", sub: "68 trades, net positive after fees. As of Nov 13." },
  signals: [{ axis: "level_reclaim", stage: "PAPER", trades: 68, netBps: 58.2, paper: { wallet: "0x95e26E980e300C34360933b849457F42c6Bd7622", trades: 6, target: 30 } }],
});
const app = (html = INDEX, status = 200) => async () => new Response(html, { status, headers: { "Content-Type": "text/html" } });
const serving = (body, status = 200) => { const calls = []; return { calls, fetchImpl: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify(body), { status }); } }; };

test("the header as the live page writes it: headline, paper count, the gate, the bar", () => {
  const s = proofSnapshotHtml(PULSE);
  assert.match(s, /level_reclaim cleared the bar\./);
  assert.match(s, /68 trades, net positive after fees\. As of Nov 13\./);
  assert.match(s, /On paper: 6 of 30 trades\./);
  assert.match(s, /A live plan is written only after 30 paper trades, net positive after fees\. Nothing is armed\./);
  assert.match(s, /href="\/proof\/paper\/level_reclaim"/);
  assert.ok(s.includes(PROOF_BAR_LINE));
});

test("people and engines counted apart, never blended", () => {
  assert.equal(pulseCountsLine(PULSE), "Last 7 days: 11 calls graded from people, 1 from our engine callers. Open now: 0 from people, 3 from engines.");
  assert.equal(pulseCountsLine({ ...PULSE, gradedWeek: 1 }).startsWith("Last 7 days: 1 call graded"), true);
  assert.equal(pulseCountsLine({ ...PULSE, engines: null }), null, "an unread side = no line, never a 0");
  assert.equal(pulseCountsLine({ ...PULSE, open: "3" }), null);
  assert.doesNotMatch(proofSnapshotHtml({ ...PULSE, engines: null }), /Last 7 days/);
});

test("no claim without the scoreboard's: headline null = the default, and no paper line beside it", () => {
  const s = proofSnapshotHtml({ ...PULSE, headline: null });
  assert.ok(s.includes(HEADLINE_DEFAULT.title));
  assert.doesNotMatch(s, /cleared the bar/);
  assert.doesNotMatch(s, /On paper/, "paper progress only beside a cleared headline");
  assert.equal(proofSnapshotHtml(null), null);
  assert.equal(proofSnapshotHtml({ ok: false }), null);
});

test("an unread paper count says unread, never 0; no dollars, no green or red", () => {
  const s = proofSnapshotHtml({ ...PULSE, signals: [{ ...PULSE.signals[0], paper: { ...PULSE.signals[0].paper, trades: null } }] });
  assert.match(s, /On paper: count unread right now\./);
  const full = proofSnapshotHtml(PULSE);
  assert.doesNotMatch(full, /\$/);
  assert.ok(!full.includes(BRAND.win) && !full.includes(BRAND.loss));
});

test("served text is escaped", () => {
  const s = proofSnapshotHtml({ ...PULSE, headline: { ...PULSE.headline, title: "<img src=x onerror=alert(1)>" }, signals: [{ ...PULSE.signals[0], axis: "a\"><script>" }] });
  assert.doesNotMatch(s, /<img|<script/);
  assert.match(s, /href="\/proof\/paper\/a%22%3E%3Cscript%3E"/);
});

test("the Function: meta + snapshot over the real index.html's boot screen, pulse read through the edge cache", async () => {
  const f = serving(PULSE);
  const res = await gateProofPage({ pathname: "/proof", loadApp: app(), fetchImpl: f.fetchImpl });
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.equal(f.calls[0].url, "https://og.nexustradinglabs.com/calls/pulse");
  assert.deepEqual(f.calls[0].init.cf, { cacheTtl: 60, cacheEverything: true });
  assert.match(html, /<div id="root"><div class="nx-proof-snapshot"/, "the boot screen is replaced inside #root (React's createRoot clears it on mount)");
  assert.doesNotMatch(html, /class="nx-boot-sub"/);
  assert.match(html, /<title>Proof: the public record \| Nexus Trading Labs<\/title>/);
  assert.equal(res.headers.get("Cache-Control"), "no-cache");
});

test("fail open: a dead, slow or odd pulse serves the page with its meta and the boot screen", async () => {
  for (const fetchImpl of [
    async () => { throw new Error("down"); },
    async () => new Response("oops", { status: 500 }),
    async () => new Response("not json", { status: 200 }),
    async () => new Response(JSON.stringify({ ok: false }), { status: 200 }),
  ]) {
    const res = await gateProofPage({ pathname: "/proof", loadApp: app(), fetchImpl });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /class="nx-boot-sub"/);
    assert.match(html, /<title>Proof: the public record/);
  }
  const notFound = await gateProofPage({ pathname: "/proof", loadApp: app("x", 404), fetchImpl: serving(PULSE).fetchImpl });
  assert.equal(notFound.status, 404, "the app shell missing is passed through untouched");
});
