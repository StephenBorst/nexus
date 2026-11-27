// The CLEARED-read house caller (readHouseCaller.mjs): posts nothing until the read is CLEARED, from its own wallet only.
// Run: node --test workers/nexus-lab-api/readHouseCaller.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateReadHouseCalls, runReadHouseCallers, handleReadHouse, readHouseAddress, READ_HOUSE_RUN_MINUTES } from "./readHouseCaller.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";
import { houseProof } from "./callDedupe.mjs";

const KEY = "axisbt:test";
const WALLET = "0x65eca27cb89fd50063300c9be32b6107c912c0c8";
const HOUSE1 = "0x76a22635ecd0e86c555ccd2202d250d82f3bb17b";
const NOW = Date.UTC(2026, 11, 30, 5, 8);
const EV = Date.UTC(2026, 11, 30, 5);
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); },
    async list({ prefix }) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; } };
}
const board = (stage) => ({ asOf: "2026-12-30T04:53:00Z", pipeline: { reads: [{ axis: "btc_lead_lag", stage, failing: null, numbers: {} }] } });
const PASS = { verdict: "PASS", randomCheck: { verdict: "BEAT", pctBeaten: 93 } };
const envWith = ({ stage = "TRADEABLE", judgment = null, address = WALLET } = {}) => ({
  HOUSE_READ_CALLER_ADDRESS: address,
  LAB_STORE: kv({ [KEY]: board(stage), ...(judgment ? { [PJUDGE_KEY("btc_lead_lag")]: judgment } : {}) }),
  NEXUS_AGENT: kv({}),
});
const deps = (o = {}) => ({ scorecardKey: KEY, now: () => NOW, locks: {}, lock: (_e, _k, fn) => fn(),
  read: async () => [{ symbol: "ETH", side: "LONG", event_at: new Date(EV).toISOString(), reason: "x" }],
  readMark: async () => ({ px: 2500, at: NOW, src: "orderly-mark" }), readAtr: async () => 0.02, ...o });

test("today (TRADEABLE, no paper PASS): nothing read, nothing posted, dry run included", async () => {
  let ran = 0;
  for (const dryRun of [false, true]) {
    const env = envWith();
    const r = await generateReadHouseCalls(env, "btc_lead_lag", deps({ dryRun, read: async () => { ran++; return []; } }));
    assert.equal(r.skipped, "not_cleared");
    assert.ok(![...env.LAB_STORE.m.keys()].some((k) => k.startsWith("lab:")));
  }
  assert.equal(ran, 0);
});

test("no address = off; a PASS that didn't beat random, a lock or a lost stage = off", async () => {
  assert.equal((await generateReadHouseCalls(envWith({ address: "" }), "btc_lead_lag", deps())).skipped, "HOUSE_READ_CALLER_ADDRESS not set");
  assert.equal((await generateReadHouseCalls(envWith({ stage: "PAPER", judgment: { verdict: "PASS", randomCheck: { verdict: "DIDNT_BEAT" } } }), "btc_lead_lag", deps())).skipped, "not_cleared");
  assert.equal((await generateReadHouseCalls(envWith({ stage: "PAPER", judgment: PASS }), "btc_lead_lag", deps({ locks: { btc_lead_lag: {} } }))).skipped, "not_cleared");
  assert.equal((await generateReadHouseCalls(envWith({ stage: "EDGE", judgment: PASS }), "btc_lead_lag", deps())).skipped, "not_cleared");
});

test("cleared: the event posts once as a public call under the new house wallet, never house-1's", async () => {
  const env = envWith({ stage: "PAPER", judgment: PASS });
  const r = await generateReadHouseCalls(env, "btc_lead_lag", deps());
  assert.equal(r.house, WALLET);
  assert.equal(r.posted.length, 1);
  assert.deepEqual({ ...r.posted[0], id: undefined }, { id: undefined, symbol: "ETH", direction: "LONG", entry: 2500, tp: 2590, sl: 2440 });
  const rec = JSON.parse(env.LAB_STORE.m.get(`lab:${WALLET}`));
  assert.equal(rec.theses.length, 1);
  assert.equal(rec.theses[0].timeStopH, 168);
  assert.ok(!env.LAB_STORE.m.has(`lab:${HOUSE1}`), "house-1's wallet is untouched");
  const again = await generateReadHouseCalls(env, "btc_lead_lag", deps());
  assert.deepEqual(again.posted, []);
  assert.equal(JSON.parse(env.LAB_STORE.m.get(`lab:${WALLET}`)).theses.length, 1, "one call per event");
  assert.deepEqual(houseProof(rec.theses[0].id, env), { owner: WALLET, evidence: "house id (houseread-…) minted by HOUSE_READ_CALLER_ADDRESS" });
});

test("cleared, dry run: previews the call, writes nothing; the cron logs only what ran", async () => {
  const env = envWith({ stage: "PAPER", judgment: PASS });
  const r = await generateReadHouseCalls(env, "btc_lead_lag", deps({ dryRun: true }));
  assert.equal(r.dryRun, true); assert.equal(r.candidates.length, 1);
  assert.ok(!env.LAB_STORE.m.has(`lab:${WALLET}`));
  const off = envWith();
  const out = await runReadHouseCallers(off, { scorecardKey: KEY });
  assert.equal(out.btc_lead_lag.skipped, "not_cleared");
  assert.ok(!off.LAB_STORE.m.has("house:lastrun:read-btc_lead_lag"));
});

test("status route: says off and why, never the read's signals", async () => {
  const res = await handleReadHouse(["signals", "read-house"], new Request("https://og.test/signals/read-house"), envWith(), { scorecardKey: KEY, locks: {} });
  const b = await res.json();
  assert.equal(b.wallet, WALLET); assert.equal(b.enabled, false);
  assert.equal(b.reads.btc_lead_lag.cleared, false); assert.match(b.reads.btc_lead_lag.line, /only a CLEARED read/);
  assert.ok(!JSON.stringify(b).includes("signals\""));
});

test("config: the new house wallet is set, house-1's isn't reused, it's left out of the people/engine counts", () => {
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^HOUSE_READ_CALLER_ADDRESS = "0x65eca27cb89fd50063300c9be32b6107c912c0c8"$/m);
  assert.equal(readHouseAddress({ HOUSE_READ_CALLER_ADDRESS: WALLET.toUpperCase().replace("0X", "0x") }), WALLET);
  assert.ok(!toml.toLowerCase().includes(HOUSE1));
  const engines = toml.match(/^ENGINE_CALLER_ADDRESSES = "(.*)"$/m)[1].toLowerCase();
  assert.ok(!engines.includes(WALLET));
  for (const f of ["routes-pulse.mjs", "weeklyScorecard.mjs"]) {
    assert.match(readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), /exclude: \[[^\]]*env\.HOUSE_READ_CALLER_ADDRESS\]/, f);
  }
  for (const m of READ_HOUSE_RUN_MINUTES) assert.ok(![41, 47, 49, 53].includes(m), `minute ${m} clashes with an hourly job`);
});
