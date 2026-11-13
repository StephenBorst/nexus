// paperRun: a cleared read's paper run in R, never in dollars and never as a total.
// Run: node --test app/lib/paperRun.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { tradeR, paperRun, paperRunLine } from "./paperRun.mjs";
import { gatePaperRunPage, paperRunMeta, withSnapshot } from "./seoGate.mjs";
import { paperRunSnapshotHtml } from "./paperRun.mjs";
import { handlePaperRun } from "../../workers/nexus-lab-api/routes-paperrun.mjs";
import { sitemapXml } from "./routeMeta.mjs";

const root = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");
const WALLET = "0x95e26E980e300C34360933b849457F42c6Bd7622";

// The level_reclaim paper wallet's first five closed rows, as exec stored them (2026-11-12 read).
const LIVE_ROWS = [
  { symbol: "PERP_LINK_USDC", direction: "LONG", entry_price: 16.96, exit_price: 16.54, qty: 8.8, leverage: 3, pnl: -3.7, pnl_percent: -2.48, reason: "SL", opened_at: "2026-11-10T08:00:40.000Z", closed_at: "2026-11-10T19:51:41.000Z" },
  { symbol: "PERP_XRP_USDC", direction: "LONG", entry_price: 1.1751, exit_price: 1.1436, qty: 127, leverage: 3, pnl: -4.0, pnl_percent: -2.68, reason: "SL", opened_at: "2026-11-07T08:00:45.227Z", closed_at: "2026-11-08T21:36:41.187Z" },
  { symbol: "PERP_ARB_USDC", direction: "LONG", entry_price: 0.1539, exit_price: 0.1646, qty: 974, leverage: 3, pnl: 10.42, pnl_percent: 6.95, reason: "TP", opened_at: "2026-11-05T17:01:51.139Z", closed_at: "2026-11-06T01:45:41.430Z" },
];
const state = (extra = {}) => ({
  started_at: "2026-11-05T05:48:34.469Z", paper_trades: LIVE_ROWS, paper_agg: { trades: 3, wins: 1, losses: 2, net: 2.7 },
  current_position: { symbol: "PERP_WLD_USDC", direction: "LONG", paper: true, opened_at: 1794492102603, pnl_percent: 1.67, qty: 501, entry_price: 0.2994 },
  ...extra,
});

test("tradeR: R from the fill when the row carries its stop; by the contract when it doesn't; unread otherwise", () => {
  assert.deepEqual(tradeR({ direction: "LONG", entry_price: 100, exit_price: 103.15, reason: "TP", sl_percent: 2.1 }), { movePct: 3.15, r: 1.5, rBasis: "fill" });
  assert.deepEqual(tradeR({ direction: "SHORT", entry_price: 100, exit_price: 102.2, reason: "SL", sl_percent: 2.1 }), { movePct: -2.2, r: -1.05, rBasis: "fill" }, "an exit past the stop shows as more than 1R");
  assert.deepEqual(tradeR({ direction: "LONG", entry_price: 100, exit_price: 101, reason: "TIMEOUT", sl_percent: 2 }), { movePct: 1, r: 0.5, rBasis: "fill" });
  assert.deepEqual(tradeR({ direction: "LONG", entry_price: 0.1539, exit_price: 0.1646, reason: "TP" }), { movePct: 6.95, r: 1.5, rBasis: "contract" });
  assert.deepEqual(tradeR({ direction: "LONG", entry_price: 1.1751, exit_price: 1.1436, reason: "SL" }), { movePct: -2.68, r: -1, rBasis: "contract" });
  assert.deepEqual(tradeR({ direction: "LONG", entry_price: 1, exit_price: 1.01, reason: "TIMEOUT" }), { movePct: 1, r: null, rBasis: null }, "never a 0 or a guess");
});

test("paperRun: count, tally, numbering, the open trade without its P&L", () => {
  const run = paperRun("level_reclaim", state());
  assert.equal(run.wallet, WALLET);
  assert.deepEqual([run.count, run.target, run.remaining, run.complete], [3, 30, 27, false]);
  assert.deepEqual(run.tally, { win: 1, loss: 2, time: 0, other: 0 });
  assert.deepEqual(run.trades.map((t) => [t.n, t.coin, t.reason, t.r]), [[1, "ARB", "TP", 1.5], [2, "XRP", "SL", -1], [3, "LINK", "SL", -1]], "oldest first");
  assert.deepEqual(run.open, { n: 4, coin: "WLD", side: "LONG", openedAt: "2026-11-12T14:01:42.603Z", entry: 0.2994 }, "numbered after the closed trades, its entry, no P&L");
  assert.equal(paperRunLine(run), "level_reclaim on paper: 3 of 30 trades. 1 TP · 2 SL.");
});

test("no dollar figure and no total of R anywhere in the payload", () => {
  const run = paperRun("level_reclaim", state());
  const keys = new Set();
  const walk = (v) => { if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); } };
  walk(run);
  for (const k of ["pnl", "pnl_percent", "qty", "leverage", "net", "grossWin", "grossLoss", "risk_usd", "sumR", "totalR", "avgR", "meanR", "netR", "entry_price"]) {
    assert.ok(!keys.has(k), `payload carries ${k}`);
  }
  assert.doesNotMatch(JSON.stringify(run), /\$/);
});

test("the record starts where exec's does: rows before a reset are left out; a rolled window keeps lifetime numbering", () => {
  const reset = paperRun("level_reclaim", state({ paper_reset_at: "2026-11-07T00:00:00Z", paper_agg: { trades: 2 } }));
  assert.deepEqual(reset.trades.map((t) => t.coin), ["XRP", "LINK"]);
  const rolled = paperRun("level_reclaim", state({ paper_agg: { trades: 55 } }));
  assert.equal(rolled.windowed, true);
  assert.deepEqual(rolled.trades.map((t) => t.n), [53, 54, 55]);
  assert.equal(paperRun("level_reclaim", state({ paper_agg: { trades: 30 } })).complete, true);
});

test("no paper wallet = null; an unread state = unread, never zeros", () => {
  assert.equal(paperRun("rsi_reset_deep", state()), null);
  assert.equal(paperRun("nope", state()), null);
  const u = paperRun("level_reclaim", null);
  assert.equal(u.unread, true);
  assert.equal(u.count, undefined);
  assert.equal(paperRunLine(u), "level_reclaim on paper: record unread right now.");
});

const kvWith = (raw) => ({ get: async (k) => (k === `agent:state:${WALLET.toLowerCase()}` ? raw : null) });
const req = (method = "GET") => new Request("https://og.nexustradinglabs.com/x", { method });

test("GET /signals/paper-run/:axis: public JSON, 404 without a paper wallet, unread on a bad record", async () => {
  assert.equal(await handlePaperRun(["signals", "basis"], req(), {}), null, "other /signals routes pass through");
  const ok = await handlePaperRun(["signals", "paper-run", "level_reclaim"], req(), { NEXUS_AGENT: kvWith(JSON.stringify(state())) });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await ok.json();
  assert.equal(body.ok, true);
  assert.equal(body.count, 3);
  const missing = await handlePaperRun(["signals", "paper-run", "rsi_reset_deep"], req(), { NEXUS_AGENT: kvWith(null) });
  assert.equal(missing.status, 404);
  const bad = await (await handlePaperRun(["signals", "paper-run", "level_reclaim"], req(), { NEXUS_AGENT: kvWith("{not json") })).json();
  assert.equal(bad.unread, true);
  assert.equal((await handlePaperRun(["signals", "paper-run", "level_reclaim"], req("POST"), {})).status, 405);
});

const APP = "<!doctype html><html><head><title>Nexus Trading Labs</title><meta property=\"og:title\" content=\"x\" /></head><body><div id=\"root\"></div></body></html>";
const loadApp = async () => new Response(APP, { status: 200, headers: { "Content-Type": "text/html" } });
const api = (status, body) => async () => new Response(JSON.stringify(body), { status });

test("the run page's head: the live count; a read with no paper wallet = a real 404; anything else fails open", async () => {
  const run = { ok: true, ...paperRun("level_reclaim", state()) };
  const res = await gatePaperRunPage({ axis: "level_reclaim", loadApp, fetchImpl: api(200, run) });
  const html = await res.text();
  assert.match(html, /<title>level_reclaim on paper: 3 of 30 trades \| Nexus Trading Labs<\/title>/);
  assert.match(html, /<meta name="description" content="level_reclaim on paper: 3 of 30 trades\. 1 TP · 2 SL\. Every trade in R/);
  assert.match(html, /<link rel="canonical" href="https:\/\/trade\.nexustradinglabs\.com\/proof\/paper\/level_reclaim" \/>/);
  const missing = await gatePaperRunPage({ axis: "rsi_reset_deep", loadApp, fetchImpl: api(404, { ok: false }) });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get("X-Robots-Tag"), "noindex");
  const down = await gatePaperRunPage({ axis: "level_reclaim", loadApp, fetchImpl: api(503, {}) });
  assert.equal(down.status, 200);
  assert.equal(await down.text(), APP);
  const threw = await gatePaperRunPage({ axis: "level_reclaim", loadApp, fetchImpl: async () => { throw new Error("timeout"); } });
  assert.equal(await threw.text(), APP);
  assert.equal(paperRunMeta("level_reclaim", null), null);
});

test("exec stamps the stop on PAPER rows only (record, nothing reads it to trade)", () => {
  const src = read("workers/nexus-agent-exec/index.js");
  assert.match(src, /state\.paper_trades\.unshift\(\{ id: `paper_\$\{Date\.now\(\)\}`, \.\.\.auditable, .*\.\.\.\(Number\(pos\.slPercent\) > 0 \? \{ sl_percent: Number\(pos\.slPercent\) \} : \{\}\)(?:, \.\.\.\(pos\.dca \? \{ entry_avg: true \} : \{\}\))? \}\);/);
  assert.equal((src.match(/sl_percent:/g) || []).length, 1, "only the paper row carries it");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /\.sl_percent\b/, "exec never reads it back");
  // The tape check's label for a DCA average entry (paperTape.mjs, 2026-11-13): same rules.
  assert.equal((src.match(/entry_avg:/g) || []).length, 1, "only the paper row carries entry_avg");
  assert.doesNotMatch(src.replace(/\/\/.*$/gm, ""), /\.entry_avg\b/, "exec never reads entry_avg back");
});

test("the page shows no dollars or totals, links from /proof, and is routed + in the sitemap", () => {
  const page = read("app/pages/proof/PaperRun.tsx").replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(page, /\bpnl\b|\bqty\b|leverage|reduce\(/, "no money fields, no summing");
  assert.doesNotMatch(page, /C\.(pos|neg|up|down|green|red)\b/, "green/red is for money and price only");
  assert.match(read("app/pages/proof/FeaturedLead.tsx"), /<Link to=\{`\/proof\/paper\/\$\{encodeURIComponent\(p\.axis\)\}`\}/);
  assert.match(read("app/main.tsx"), /\{ path: 'paper\/:axis', element: <PaperRunPage \/> \}/);
  assert.match(read("functions/proof/paper/[axis].js"), /gatePaperRunPage\(\{ axis: params\.axis, loadApp \}\)/);
  assert.ok(sitemapXml().includes("<loc>https://trade.nexustradinglabs.com/proof/paper/level_reclaim</loc>"));
});

test("with the tape checks, each trade carries its entry/exit verdict and the run a summary in plain words", async () => {
  const { entryKey, exitKeyOf } = await import("./paperTape.mjs");
  const rows = LIVE_ROWS.map((r, i) => ({ ...r, id: `paper_${i}` }));
  const checks = {
    [entryKey("PERP_ARB_USDC", Date.parse("2026-11-05T17:01:51.139Z"))]: { verdict: "ON_TAPE" },
    [exitKeyOf(rows[2])]: { verdict: "NEAR", bps: 3 },
    [exitKeyOf(rows[0])]: { verdict: "OFF", bps: 40 },
  };
  const run = paperRun("level_reclaim", state({ paper_trades: rows }), { v: 1, checks });
  const arb = run.trades.find((t) => t.coin === "ARB");
  assert.deepEqual(arb.tape, { entry: "ON_TAPE", exit: "NEAR" });
  assert.deepEqual(run.trades.find((t) => t.coin === "LINK").tape, { entry: "PENDING", exit: "OFF" });
  assert.deepEqual([run.tape.fills, run.tape.judged, run.tape.onTape, run.tape.near, run.tape.off, run.tape.pending], [7, 3, 1, 1, 1, 4], "3 rows × 2 + the open WLD entry");
  assert.match(run.tape.line, /^1 of 3 paper fills traded inside/);
  assert.equal(paperRun("level_reclaim", state()).tape, undefined, "no tape record = no tape block");
});

test("the open trade is a row on the page: entry, tape and Open, never a P&L or an R", () => {
  const page = read("app/pages/proof/PaperRun.tsx");
  assert.match(page, /\{run\.open && \(\n\s+<tr/);
  assert.match(page, />Open<\/td>/);
  assert.match(page, /title="R is read when the trade closes\.">—<\/td>/);
  assert.match(page, /run\.trades\.length === 0 && !run\.open/, "the table shows when the only trade is open");
});

test("the server snapshot: the run in the HTML in place of the boot screen, no dollars, fails open", () => {
  const run = { ok: true, ...paperRun("level_reclaim", state()) };
  const snap = paperRunSnapshotHtml(run);
  assert.match(snap, /level_reclaim on paper\.<span[^>]*>3 of 30 trades\.<\/span>/);
  assert.match(snap, /<td[^>]*>4<\/td><td[^>]*>WLD<\/td><td[^>]*>LONG<\/td><td[^>]*>Open<\/td><td[^>]*>—<\/td>/, "the open trade first, no R");
  assert.match(snap, /<td[^>]*>ARB<\/td><td[^>]*>LONG<\/td><td[^>]*>Target<\/td><td[^>]*>\+1\.50R \*<\/td>/);
  assert.doesNotMatch(snap.replace(/No dollar P&amp;L/, ""), /\$|pnl|P&amp;L/i, "no dollar figure");
  assert.doesNotMatch(snap, /#3ecf8e|#f7525f/i, "green/red is for money and price only");
  assert.equal(paperRunSnapshotHtml(paperRun("level_reclaim", null)), null, "unread = no snapshot");
  assert.ok(!snap.includes("<script"), "inert HTML only");
  const evil = paperRunSnapshotHtml({ ...run, axis: "<img src=x onerror=alert(1)>" });
  assert.doesNotMatch(evil, /<img/, "escaped");
  // pinned to the real boot screen in index.html: a change there must fail here, not silently skip the snapshot
  const html = read("index.html");
  const out = withSnapshot(html, snap);
  assert.notEqual(out, html);
  assert.ok(out.includes(`<div id="root">${snap}</div>`));
  assert.doesNotMatch(out, /class="nx-boot-sub"/);
  assert.equal(withSnapshot("<div id=\"root\"></div>", snap), "<div id=\"root\"></div>", "no boot screen = unchanged");
  assert.equal(withSnapshot(html, null), html);
});

test("the page's Function writes the snapshot and asks lab-api through the edge cache", async () => {
  const run = { ok: true, ...paperRun("level_reclaim", state()) };
  let asked = null;
  const appHtml = read("index.html");
  const res = await gatePaperRunPage({ axis: "level_reclaim", loadApp: async () => new Response(appHtml, { status: 200 }), fetchImpl: async (u, o) => { asked = o; return new Response(JSON.stringify(run), { status: 200 }); } });
  const html = await res.text();
  assert.deepEqual(asked.cf, { cacheTtl: 60, cacheEverything: true });
  assert.match(html, /class="nx-paper-snapshot"/);
  assert.match(html, /<title>level_reclaim on paper: 3 of 30 trades/);
});
