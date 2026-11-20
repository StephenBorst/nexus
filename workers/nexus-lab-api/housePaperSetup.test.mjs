// The house paper setup job (housePaperSetup.mjs): fake KV, no network. Creates each run once, keeps the user list,
// never rewrites a config or a state, and does nothing with the switch off. Plus the two guards: the agent routes refuse
// every change to a house run, exec refuses any non-paper entry for one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ensureHousePaper } from "./housePaperSetup.mjs";
import { HOUSE_PAPER_IDS, housePaperConfig } from "../../app/lib/housePaper.mjs";

function fakeKV(init = {}) {
  const m = new Map(Object.entries(init));
  const puts = [];
  return { m, puts, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { puts.push(k); m.set(k, v); } };
}
const N = Object.keys(HOUSE_PAPER_IDS).length;

test("off unless HOUSE_PAPER_RUNS = true: writes nothing", async () => {
  const kv = fakeKV();
  assert.equal((await ensureHousePaper({ NEXUS_AGENT: kv })).off, true);
  assert.equal(kv.puts.length, 0);
});

test("first run: every house run gets its config, a fresh record and a place on agent:users; others keep theirs", async () => {
  const kv = fakeKV({ "agent:users": JSON.stringify(["0xabc"]) });
  const now = Date.UTC(2026, 10, 20, 12);
  const r = await ensureHousePaper({ NEXUS_AGENT: kv, HOUSE_PAPER_RUNS: "true" }, { now });
  assert.equal(r.created.length, N);
  assert.deepEqual(r.issues, []);
  for (const [read, id] of Object.entries(HOUSE_PAPER_IDS)) {
    assert.deepEqual(JSON.parse(kv.m.get(`agent:config:${id}`)), housePaperConfig(read));
    const st = JSON.parse(kv.m.get(`agent:state:${id}`));
    assert.equal(st.started_at, now);
    assert.equal(st.active, true);
    assert.equal(st.current_position, null);
  }
  const users = JSON.parse(kv.m.get("agent:users"));
  assert.equal(users[0], "0xabc", "an existing user is kept");
  assert.equal(users.length, N + 1);
  // only house keys and the user list are written
  for (const k of kv.puts) assert.ok(k === "agent:users" || Object.values(HOUSE_PAPER_IDS).some((id) => k.endsWith(id)), k);
});

test("later runs: nothing written; a changed config is reported, never rewritten; an existing record is never reset", async () => {
  const kv = fakeKV({ "agent:users": "[]" });
  const env = { NEXUS_AGENT: kv, HOUSE_PAPER_RUNS: "true" };
  await ensureHousePaper(env, { now: 1 });
  const before = kv.puts.length;
  const again = await ensureHousePaper(env, { now: 2 });
  assert.equal(kv.puts.length, before, "a second run writes nothing");
  assert.deepEqual(again.created, []);
  const id = HOUSE_PAPER_IDS.btc_lead_lag;
  kv.m.set(`agent:config:${id}`, JSON.stringify({ ...housePaperConfig("btc_lead_lag"), leverage: 10 }));
  const r = await ensureHousePaper(env, { now: 3 });
  assert.match(r.issues.join(), /btc_lead_lag: stored config differs/);
  assert.equal(JSON.parse(kv.m.get(`agent:config:${id}`)).leverage, 10, "never rewritten");
  // a config gone but its record still there: the config comes back, the record is kept
  const id2 = HOUSE_PAPER_IDS.spot_absorb;
  kv.m.delete(`agent:config:${id2}`);
  await ensureHousePaper(env, { now: 4 });
  assert.equal(JSON.parse(kv.m.get(`agent:state:${id2}`)).started_at, 1);
});

test("the agent routes refuse every change to a house run, before any owner check; exec refuses a non-paper entry", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  const at = src.indexOf('if (parts[0] === "agent" && parts[1]) {');
  const guard = src.indexOf("isHousePaper(address) && request.method !== \"GET\"", at);
  assert.ok(guard > at && guard < src.indexOf("const requireOwner = async (body)", at), "the guard runs before any agent route");
  assert.match(src.slice(guard, guard + 400), /house_paper_readonly[\s\S]*403/);
  const toml = readFileSync(new URL("./wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /^HOUSE_PAPER_RUNS = "true"$/m);
  const ex = readFileSync(new URL("../nexus-agent-exec/index.js", import.meta.url), "utf8");
  const ep = ex.slice(ex.indexOf("async function enterPosition("));
  assert.match(ep.slice(0, 1200), /if \(isHousePaper\(address\) && !paper\) \{ console\.error\([^\n]*\); return; \}/);
});
