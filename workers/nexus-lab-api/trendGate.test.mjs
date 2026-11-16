// trendGate.mjs (registered conditioner, docs/research/trend-gate-prereg.md, signed 2026-11-16). Run: node --test workers/nexus-lab-api/trendGate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { btcTrendByHour, trendLabel, labelCounts, TREND_GATE_STUDY } from "./trendGate.mjs";
import { REGISTERED_READS } from "../../app/lib/readPipeline.mjs";

const TREND_GATE_PAGE_SHA256 = "47201e23806e2c78f29d90b0e24a21143e7d88802903d8b842bb755f3ac52206";

const H = 3600000;
// 30 days of BTC: 15 days up, then 15 days down (hourly closes).
const tape = Array.from({ length: 720 }, (_, i) => {
  const c = i < 360 ? 100 + i * 0.1 : 136 - (i - 360) * 0.1;
  return { t: i * H, o: c, h: c + 0.05, l: c - 0.05, c, v: 1 };
});
const trend = btcTrendByHour(tape);

test("WITH / AGAINST / UNLABELLED from BTC's 4h trend the event could see", () => {
  const up = 300 * H, down = 700 * H;   // decision closes
  assert.equal(trendLabel({ t: up, side: "LONG" }, trend), "WITH");
  assert.equal(trendLabel({ t: up, side: "SHORT" }, trend), "AGAINST");
  assert.equal(trendLabel({ t: down, side: "SHORT" }, trend), "WITH");
  assert.equal(trendLabel({ t: down, side: "LONG" }, trend), "AGAINST");
  assert.equal(trendLabel({ t: 10 * H, side: "LONG" }, trend), "UNLABELLED", "fewer than 20 complete 4h bars");
  assert.equal(trendLabel({ t: up, side: "FLAT" }, trend), "UNLABELLED");
  assert.deepEqual(labelCounts([{ t: up, side: "LONG" }, { t: down, side: "LONG" }, { t: 0, side: "LONG" }], trend), { events: 3, WITH: 1, AGAINST: 1, UNLABELLED: 1 });
});

test("no lookahead: poisoning everything after the event never changes its label", () => {
  for (const at of [200, 361, 365, 400, 600, 719]) {
    const t = at * H;
    const poisoned = tape.map((c) => (c.t >= t ? { ...c, o: 1, h: 1, l: 1, c: 1 } : c));
    for (const side of ["LONG", "SHORT"]) assert.equal(trendLabel({ t, side }, btcTrendByHour(poisoned)), trendLabel({ t, side }, trend), `hour ${at} ${side}`);
  }
});

test("signed 2026-11-16: the page is pinned above Results, and its numbers are the code's", () => {
  const doc = readFileSync(new URL("../../docs/research/trend-gate-prereg.md", import.meta.url), "utf8");
  const above = doc.slice(0, doc.indexOf("## Results"));
  assert.equal(createHash("sha256").update(above).digest("hex"), TREND_GATE_PAGE_SHA256);
  assert.match(above, /Signed by borst 2026-11-16/);
  assert.match(above, /Out-of-sample from\n2026-11-17T00:00:00Z\. Limit 2027-05-17T00:00:00Z\./);
  assert.deepEqual({ ...TREND_GATE_STUDY, reads: [...TREND_GATE_STUDY.reads], excluded: [...TREND_GATE_STUDY.excluded] }, {
    from: "2026-11-17T00:00:00Z", limit: "2027-05-17T00:00:00Z",
    reads: ["rsi_reset_deep", "level_reclaim", "oi_div_reversal", "session_momentum", "confluence_follow", "oi_div_reversal_4h",
      "oi_coil_break", "session_fade", "level_reclaim_tight", "spot_absorb", "btc_lead_lag", "funding_basis_split", "smart_consensus_2x"],
    excluded: ["bb_rsi_momentum", "shelf_breakdown_short", "session_fade_short", "oi_div_reversal_4h_long"],
    minEach: 30, minSmallAtLimit: 20, shifts: 1000, minShiftDays: 7, alpha: 0.05,
  });
  for (const r of TREND_GATE_STUDY.reads) assert.match(above, new RegExp("`" + r + "`"), `${r} named on the page`);
  // Every read named is a registered read, in or out, never both. (Reads registered after signing are in neither list.)
  const registered = new Set(REGISTERED_READS.map((r) => r.axis));
  for (const r of [...TREND_GATE_STUDY.reads, ...TREND_GATE_STUDY.excluded]) assert.ok(registered.has(r), `${r} is registered`);
  assert.equal(TREND_GATE_STUDY.reads.filter((r) => TREND_GATE_STUDY.excluded.includes(r)).length, 0);
});

test("a conditioner: nothing that trades or grades imports it until its judge is built", () => {
  const root = new URL("../../", import.meta.url);
  const scan = (dir) => (existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root), { recursive: true }) : [])
    .filter((f) => /\.(mjs|js|ts|tsx)$/.test(f) && !String(f).includes("node_modules") && !/\.test\.mjs$/.test(f))
    .map((f) => [`${dir}/${f}`, readFileSync(new URL(`${dir}/${f}`, root), "utf8")]);
  const users = [...scan("workers/nexus-agent-brain"), ...scan("workers/nexus-agent-exec"), ...scan("workers/nexus-lab-api"), ...scan("app")]
    .filter(([f, src]) => !f.endsWith("trendGate.mjs") && /trendGate\.mjs/.test(src));
  assert.deepEqual(users.map(([f]) => f), [], "only the count tool may read the draft until it is signed and its judge is built");
});
