// stableHist.mjs — recording only. Run: node --test workers/nexus-lab-api/stableHist.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { stableRows, snapshotStable, STABLE_HIST_KEY, STABLE_FROM_MS } from "./stableHist.mjs";

const D = 86400;
const day = (k) => STABLE_FROM_MS / 1000 + k * D;
const reply = (n) => [
  { date: String(STABLE_FROM_MS / 1000 - 5 * D), totalCirculatingUSD: { peggedUSD: 1 } },        // before 2021: dropped
  ...Array.from({ length: n }, (_, k) => ({ date: String(day(k) + 3600), totalCirculatingUSD: { peggedUSD: 100e9 + k * 1e6, peggedEUR: 5e8 } })),
  { date: String(day(1)), totalCirculatingUSD: { peggedUSD: 0 } },                                 // a zero is never a row
];
const kv = () => { const m = {}; return { m, get: async (k) => m[k] ?? null, put: async (k, v) => { m[k] = v; } }; };
const fetchOk = (body) => async () => ({ ok: true, json: async () => body });

test("rows: one a day at UTC midnight, the USD-pegged total, from 2021, nothing from a broken reply", () => {
  const rows = stableRows(reply(3));
  assert.deepEqual(rows, [0, 1, 2].map((k) => ({ t: STABLE_FROM_MS + k * D * 1000, usd: 100e9 + k * 1e6 })));
  assert.deepEqual(stableRows({ error: "rate limited" }), []);
  assert.deepEqual(stableRows([{ date: "x", totalCirculating: { peggedUSD: 5 } }]), []);
  assert.equal(stableRows([{ date: String(day(0)), totalCirculating: { peggedUSD: 7e9 } }])[0].usd, 7e9, "the older field name still reads");
});

test("stores, waits 6h before reading again, never shrinks the series, never stores a broken read", async () => {
  const k = kv(), now = Date.UTC(2026, 10, 16, 12);
  const r = await snapshotStable(k, { fetchImpl: fetchOk(reply(5)), now });
  assert.deepEqual([r.stored, r.rows], [true, 5]);
  assert.equal(JSON.parse(k.m[STABLE_HIST_KEY]).rows.length, 5);
  assert.equal((await snapshotStable(k, { fetchImpl: async () => { throw new Error("must not read"); }, now: now + 3600000 })).reason, "read_recently");
  await assert.rejects(snapshotStable(k, { fetchImpl: fetchOk(reply(2)), now: now + 7 * 3600000 }), /shorter than the stored series/);
  await assert.rejects(snapshotStable(k, { fetchImpl: fetchOk({ message: "nope" }), now: now + 7 * 3600000 }), /no USD stablecoin rows/);
  await assert.rejects(snapshotStable(k, { fetchImpl: async () => ({ ok: false, status: 429 }), now: now + 7 * 3600000 }), /defillama 429/);
  assert.equal(JSON.parse(k.m[STABLE_HIST_KEY]).rows.length, 5, "the stored series survived every bad read");
});

test("recording only: nothing that grades, trades or gates reads it", () => {
  const root = new URL("../../", import.meta.url);
  const files = ["workers/nexus-agent-brain", "workers/nexus-agent-exec", "workers/nexus-lab-api", "app"].flatMap((d) =>
    readdirSync(new URL(d, root), { recursive: true }).filter((f) => /\.(mjs|js|ts|tsx)$/.test(f) && !String(f).includes("node_modules") && !/\.test\.mjs$/.test(f))
      .map((f) => [`${d}/${f}`, readFileSync(new URL(`${d}/${f}`, root), "utf8")]));
  const users = files.filter(([f, src]) => !f.endsWith("stableHist.mjs") && /stableHist\.mjs|stable:hist/.test(src)).map(([f]) => f);
  assert.deepEqual(users, ["workers/nexus-lab-api/index.js"], "only the recorder hook and its read-only route");
});
