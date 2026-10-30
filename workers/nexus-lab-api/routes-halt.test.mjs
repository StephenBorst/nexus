// The live-entry halt (app/lib/liveHalt.mjs, routes-halt.mjs, nexus-agent-exec) with REAL signatures.
// Run: node --test workers/nexus-lab-api/routes-halt.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateKeyToAccount } from "viem/accounts";
import { handleHalt } from "./routes-halt.mjs";
import {
  LIVE_HALT_KEY, LIVE_HALT_LOG_KEY, HALT_SIG_MAX_AGE_MS, HALT_READ_FAILED, liveHaltMessage, parseLiveHalt,
  haltBlocksEntry, publicHalt, cleanReason, appendHaltLog, LIVE_HALT_LOG_MAX,
} from "../../app/lib/liveHalt.mjs";

const T0 = 1_790_000_000_000;
const owner = privateKeyToAccount("0x" + "a1".repeat(32));
const ops = privateKeyToAccount("0x" + "c3".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const O = owner.address.toLowerCase();

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return {
    m,
    async get(k) { return m.has(k) ? m.get(k) : null; },
    async put(k, v) { m.set(k, v); },
    async delete(k) { m.delete(k); },
  };
}
// Safe owners come from the cache, so no RPC is touched; a fetch here fails the test.
const noFetch = async () => { throw new Error("network touched"); };
const envWith = (agent = {}, extra = {}) => ({ LAB_STORE: kv({ "ops:safe:owners": [O] }), NEXUS_AGENT: kv(agent), ...extra });
const call = (env, method, body, at = T0) => handleHalt(["ops", "halt"], new Request("https://og.test/ops/halt", {
  method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
}), env, { now: () => at, fetchImpl: noFetch });
const signed = async (account, on, ts = T0, extra = {}) => ({
  address: account.address, on, ts, sig: await account.signMessage({ message: liveHaltMessage(account.address, on, ts) }), ...extra,
});

test("the exec rule: only live modes stop; PAPER always runs; off stops nothing", () => {
  const on = parseLiveHalt(JSON.stringify({ on: true, at: T0, reason: "cascade" }));
  for (const mode of ["AUTONOMOUS", "ASSISTED", undefined]) assert.equal(haltBlocksEntry(on, mode), true, String(mode));
  assert.equal(haltBlocksEntry(on, "PAPER"), false);
  assert.equal(haltBlocksEntry(parseLiveHalt(null), "AUTONOMOUS"), false);
  assert.equal(haltBlocksEntry(HALT_READ_FAILED, "AUTONOMOUS"), true, "an unread flag holds live entries for the tick");
  assert.equal(haltBlocksEntry(HALT_READ_FAILED, "PAPER"), false);
});

test("a flag that doesn't parse still halts (fail closed); no key = not halted", () => {
  assert.deepEqual(parseLiveHalt(null), { on: false });
  assert.deepEqual(parseLiveHalt(""), { on: false });
  assert.equal(parseLiveHalt("not json").on, true);
  assert.equal(parseLiveHalt("1").on, true);
});

test("the public view never names who switched it", () => {
  const v = publicHalt(parseLiveHalt(JSON.stringify({ on: true, at: T0, by: O, reason: "x" })));
  assert.deepEqual(v, { halted: true, since: T0, reason: "x" });
  assert.deepEqual(publicHalt({ on: false }), { halted: false });
});

test("the two messages differ, name the address, and say nothing closes or moves", () => {
  const p = liveHaltMessage(O, true, T0), r = liveHaltMessage(O, false, T0);
  assert.notEqual(p, r);
  for (const m of [p, r]) {
    assert.match(m, new RegExp(`Address: ${O}`));
    assert.match(m, /Closes nothing\. Moves no funds\. Valid 5 minutes\./);
    assert.ok(Array.from(m).every((ch) => ch === "\n" || (ch >= " " && ch <= "~")), "ASCII only");
  }
  assert.equal(liveHaltMessage(owner.address, true, T0), p, "case of the address doesn't change the text");
});

test("reasons are one printable line, capped", () => {
  assert.equal(cleanReason("  BTC\n-8%\t15m  "), "BTC -8% 15m");
  assert.equal(cleanReason("x".repeat(500)).length, 140);
  assert.equal(cleanReason(undefined), "");
});

test("the log keeps the newest first and is capped", () => {
  let log = [];
  for (let i = 0; i < LIVE_HALT_LOG_MAX + 5; i++) log = appendHaltLog(log, { sigTs: i });
  assert.equal(log.length, LIVE_HALT_LOG_MAX);
  assert.equal(log[0].sigTs, LIVE_HALT_LOG_MAX + 4);
});

test("GET is public and reads the flag", async () => {
  const env = envWith();
  assert.deepEqual(await (await call(env, "GET")).json(), { halted: false });
  env.NEXUS_AGENT.m.set(LIVE_HALT_KEY, JSON.stringify({ on: true, at: T0, by: O, reason: "r" }));
  assert.deepEqual(await (await call(env, "GET")).json(), { halted: true, since: T0, reason: "r" });
});

test("an owner pauses, then resumes; both are logged", async () => {
  const env = envWith();
  const p = await call(env, "POST", await signed(owner, true, T0, { reason: "Binance outage\ncascade" }), T0 + 1000);
  assert.equal(p.status, 200);
  assert.deepEqual(await p.json(), { ok: true, halted: true, since: T0 + 1000, reason: "Binance outage cascade" });
  const rec = JSON.parse(env.NEXUS_AGENT.m.get(LIVE_HALT_KEY));
  assert.equal(rec.by, O);
  assert.equal(haltBlocksEntry(parseLiveHalt(env.NEXUS_AGENT.m.get(LIVE_HALT_KEY)), "AUTONOMOUS"), true);

  const r = await call(env, "POST", await signed(owner, false, T0 + 5000), T0 + 6000);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, halted: false });
  assert.equal(env.NEXUS_AGENT.m.has(LIVE_HALT_KEY), false);
  const log = JSON.parse(env.NEXUS_AGENT.m.get(LIVE_HALT_LOG_KEY));
  assert.deepEqual(log.map((e) => e.on), [false, true]);
});

test("OPS_WALLETS may switch it too", async () => {
  const env = envWith({}, { OPS_WALLETS: ops.address });
  assert.equal((await call(env, "POST", await signed(ops, true))).status, 200);
});

test("a stranger's valid signature is refused (403) and nothing is written", async () => {
  const env = envWith();
  const res = await call(env, "POST", await signed(mallory, true));
  assert.equal(res.status, 403);
  assert.equal(env.NEXUS_AGENT.m.size, 0);
});

test("a signature over the other action, someone else's address, or no signature is refused", async () => {
  const env = envWith();
  const pauseSig = await signed(owner, true);
  assert.equal((await call(env, "POST", { ...pauseSig, on: false })).status, 401, "a pause signature can't resume");
  assert.equal((await call(env, "POST", { ...(await signed(mallory, true)), address: owner.address })).status, 401, "signed by someone else");
  assert.equal((await call(env, "POST", { address: owner.address, on: true, ts: T0 })).status, 401);
  assert.equal((await call(env, "POST", { ...pauseSig, on: "yes" })).status, 400);
  assert.equal(env.NEXUS_AGENT.m.size, 0);
});

test("an old or future signature is refused, and an applied one can't be replayed", async () => {
  const env = envWith();
  assert.equal((await call(env, "POST", await signed(owner, true, T0), T0 + HALT_SIG_MAX_AGE_MS + 1)).status, 401);
  assert.equal((await call(env, "POST", await signed(owner, true, T0 + 120_000), T0)).status, 401);

  const pause = await signed(owner, true, T0);
  const resume = await signed(owner, false, T0 + 1000);
  assert.equal((await call(env, "POST", pause, T0 + 10)).status, 200);
  assert.equal((await call(env, "POST", resume, T0 + 2000)).status, 200);
  // The earlier pause, sent again inside its 5 minutes, must not re-pause.
  assert.equal((await call(env, "POST", pause, T0 + 3000)).status, 409);
  assert.equal(env.NEXUS_AGENT.m.has(LIVE_HALT_KEY), false);
});

test("exec: the flag is read once per tick and checked before any live entry, after the ASSISTED queue", () => {
  const src = readFileSync(new URL("../nexus-agent-exec/index.js", import.meta.url), "utf8");
  assert.match(src, /parseLiveHalt\(await env\.NEXUS_AGENT\.get\(LIVE_HALT_KEY\)\)/);
  assert.match(src, /processUser\(address, env, priceCache, liveHalt\)/);
  const body = src.slice(src.indexOf("async function processUser("), src.indexOf("async function enterPosition("));
  const assisted = body.indexOf('config.mode === "ASSISTED"');
  const gate = body.indexOf("haltBlocksEntry(liveHalt, config.mode)");
  const enter = body.indexOf("await enterPosition(");
  assert.ok(assisted > 0 && gate > assisted && enter > gate, "the halt check must sit between the ASSISTED queue and enterPosition");
  assert.equal(body.split("await enterPosition(").length - 1, 1, "one entry call, behind the halt");
  // Exits and the kill switch run before the gate, so a halt never strands a position.
  assert.ok(body.indexOf("monitorPosition(") < gate && body.indexOf('"KILLED"') < gate);
});
