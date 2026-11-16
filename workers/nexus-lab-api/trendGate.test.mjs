// trendGate.mjs (DRAFT conditioner, docs/research/trend-gate-prereg.md). Run: node --test workers/nexus-lab-api/trendGate.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { btcTrendByHour, trendLabel, labelCounts } from "./trendGate.mjs";

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

test("a draft conditioner: nothing that trades or grades imports it, and the page stays unsigned until borst signs", () => {
  const root = new URL("../../", import.meta.url);
  const scan = (dir) => (existsSync(new URL(dir, root)) ? readdirSync(new URL(dir, root), { recursive: true }) : [])
    .filter((f) => /\.(mjs|js|ts|tsx)$/.test(f) && !String(f).includes("node_modules") && !/\.test\.mjs$/.test(f))
    .map((f) => [`${dir}/${f}`, readFileSync(new URL(`${dir}/${f}`, root), "utf8")]);
  const users = [...scan("workers/nexus-agent-brain"), ...scan("workers/nexus-agent-exec"), ...scan("workers/nexus-lab-api"), ...scan("app")]
    .filter(([f, src]) => !f.endsWith("trendGate.mjs") && /trendGate\.mjs/.test(src));
  assert.deepEqual(users.map(([f]) => f), [], "only the count tool may read the draft until it is signed and its judge is built");
  const page = readFileSync(new URL("docs/research/trend-gate-prereg.md", root), "utf8");
  assert.match(page, /DRAFT, unsigned/);
  assert.match(page, /- \[ \] borst:/, "the sign-off box is still open");
});
