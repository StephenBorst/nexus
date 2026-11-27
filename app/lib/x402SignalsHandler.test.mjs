// The paid feed's handler (bankr-x402/nexus-signals.ts): btc_lead_lag only on a CLEARED 200 from lab-api, else today's
// funding-fade feed with its live grade. Node strips the handler's types on import. Run: node --test app/lib/x402SignalsHandler.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "../../bankr-x402/nexus-signals.ts";
import { SOLD_READS } from "./soldRead.mjs";

const J = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const FUND = {
  "/signals": () => J({ generated_at: "2026-11-27T20:00:00Z", signals: [{ symbol: "ETH", verdict: "FADE", fade_dir: "SHORT", funding_annual_pct: 40, stretched: true, mark_price: 3000 }] }),
  "/intel/mispriced": () => J({ markets: [] }),
  "/intel/axis-backtest": () => J({ asOf: "2026-11-27T19:53:00Z", axes: [{ name: "funding_fade", verdict: "NOISE", r: { samples: 3000, hitRate: 0.31, meanR: -0.2, stable: true } }] }),
};
const stub = (sold) => async (url) => {
  const path = String(url).replace("https://og.nexustradinglabs.com", "");
  if (path.startsWith("/signals/read/")) { if (sold instanceof Error) throw sold; return sold(); }
  return FUND[path]();
};
const CLEARED = { ok: true, cleared: true, axis: "btc_lead_lag", grade: { axis: "btc_lead_lag", cleared: true, stage: "PAPER" }, generated_at: "2026-12-30T05:10:00Z", signals: [{ symbol: "ETH", side: "LONG" }] };
const body = async (sold) => (await handler(new Request("https://x402.test/"), stub(sold))).json();

test("today: lab-api says not_cleared, so the feed is funding-fade with its NOISE grade, as before", async () => {
  const b = await body(() => J({ ok: false, cleared: false, error: "not_cleared" }, 403));
  assert.equal(b.read, "funding_fade");
  assert.equal(b.grade.axis, "funding_fade"); assert.equal(b.grade.verdict, "NOISE");
  assert.equal(b.signals[0].symbol, "ETH"); assert.equal(b.signals[0].side, "SHORT");
});

test("anything short of a cleared 200 serves funding-fade: an error, a 503, a 200 that isn't cleared or has no grade", async () => {
  for (const sold of [new Error("down"), () => J({ error: "board_unread" }, 503),
    () => J({ ...CLEARED, cleared: false }), () => J({ ...CLEARED, grade: undefined }),
    () => J({ ...CLEARED, grade: { ...CLEARED.grade, cleared: false } }), () => J({ ...CLEARED, axis: "level_reclaim" }), () => new Response("<html>", { status: 200 })]) {
    const b = await body(sold);
    assert.equal(b.read, "funding_fade"); assert.equal(b.grade.axis, "funding_fade");
  }
});

test("cleared: the feed is btc_lead_lag, carrying its live grade", async () => {
  const b = await body(() => J(CLEARED));
  assert.equal(b.read, "btc_lead_lag");
  assert.equal(b.grade.cleared, true); assert.equal(b.grade.axis, "btc_lead_lag");
  assert.deepEqual(b.signals, CLEARED.signals);
  assert.doesNotMatch(JSON.stringify(b), /proven|guaranteed|\+EV/i);
});

test("the handler's read list matches soldRead.mjs, and the listing names no read before it clears", () => {
  const src = readFileSync(new URL("../../bankr-x402/nexus-signals.ts", import.meta.url), "utf8");
  assert.match(src, new RegExp(`const SOLD_READS = \\[${SOLD_READS.map((r) => `"${r}"`).join(", ")}\\]`));
  const cfg = JSON.parse(readFileSync(new URL("../../bankr-x402/bankr.x402.json", import.meta.url), "utf8"));
  const d = cfg.services["nexus-signals"].description;
  assert.match(d, /CLEARED/); assert.match(d, /names its read/); assert.match(d, /live grade/); assert.match(d, /Not a proven edge\./);
  // the grade moves, so the listing never states one (it went stale once: NOISE while the board served PROMISING)
  for (const g of ["PREDICTIVE", "PROMISING", "NOISE", "ACCRUING", "INSUFFICIENT"]) assert.ok(!d.includes(g), `the listing asserts no grade (${g})`);
  for (const r of SOLD_READS) assert.ok(!d.includes(r), `the listing doesn't market ${r} before it clears`);
  assert.ok(!("nexus-signals-basis" in cfg.services), "the basis swap stays staged");
});

test("the README states no grade as current: the only grade word is the dated 2026-09-25 record", () => {
  const md = readFileSync(new URL("../../bankr-x402/README.md", import.meta.url), "utf8");
  const GRADE = /\b(PREDICTIVE|PROMISING|NOISE|ACCRUING|INSUFFICIENT)\b/;
  const dated = md.slice(md.indexOf("The record on 2026-09-25:"), md.indexOf("Today's grade is on\n/proof."));
  assert.ok(dated.length > 0 && GRADE.test(dated), "the dated record keeps its numbers");
  assert.ok(!GRADE.test(md.replace(dated, "")), "no grade word outside the dated record");
  assert.match(md, /see `read: "funding_fade"` with its live grade from the scoreboard/);
});
