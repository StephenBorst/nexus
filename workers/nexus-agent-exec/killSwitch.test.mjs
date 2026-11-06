// The kill switch: close first, then stop + delete the key (killSwitch.mjs), and the wiring that
// broke it before 2026-11-06 (route deleted key + list entry; exec read `config` before defining it).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runKill, KILL_MAX_ATTEMPTS } from "./killSwitch.mjs";
import { handleAgentKill } from "../nexus-lab-api/routes-kill.mjs";

const POS = { symbol: "PERP_ETH_USDC", direction: "LONG", qty: 0.01, paper: false };

function fakeIo({ closes = true, throws = false } = {}, state) {
  const log = [];
  return {
    log,
    io: {
      close: async () => { log.push("close"); if (throws) throw new Error("orderly down"); if (closes) state.current_position = null; },
      saveState: async (s) => log.push(`save:${s.active}:${s.current_position ? "pos" : "flat"}`),
      clearFlag: async () => log.push("clearFlag"),
      clearDirective: async () => log.push("clearDirective"),
      deleteKey: async () => log.push("deleteKey"),
      notify: async (t) => log.push(`notify:${t.slice(0, 20)}`),
    },
  };
}

test("kill with an open position: close comes BEFORE the key is deleted", async () => {
  const state = { active: true, current_position: { ...POS } };
  const { io, log } = fakeIo({}, state);
  const r = await runKill({ state, io });
  assert.equal(r.outcome, "DONE");
  assert.deepEqual(log, ["close", "save:false:flat", "clearFlag", "clearDirective", "deleteKey"]);
  assert.equal(state.active, false);
});

test("kill while flat: no close, agent stops, key deleted", async () => {
  const state = { active: true, current_position: null };
  const { io, log } = fakeIo({}, state);
  assert.equal((await runKill({ state, io })).outcome, "DONE");
  assert.deepEqual(log, ["save:false:flat", "clearFlag", "clearDirective", "deleteKey"]);
});

test("unconfirmed close keeps the flag AND the key, retries next tick", async () => {
  for (const opt of [{ closes: false }, { throws: true }]) {
    const state = { active: true, current_position: { ...POS } };
    const { io, log } = fakeIo(opt, state);
    const r = await runKill({ state, io });
    assert.equal(r.outcome, "RETRY");
    assert.equal(r.attempts, 1);
    assert.ok(!log.includes("deleteKey") && !log.includes("clearFlag"), "the key that places the close must survive");
    assert.equal(state.active, true);
    assert.equal(state.kill_attempts, 1);
  }
});

test("a close that lands on a later try finishes cleanly", async () => {
  const state = { active: true, current_position: { ...POS }, kill_attempts: 3 };
  const { io, log } = fakeIo({}, state);
  const r = await runKill({ state, io });
  assert.equal(r.outcome, "DONE");
  assert.equal(r.attempts, 3);
  assert.equal("kill_attempts" in state, false);
  assert.ok(log.includes("deleteKey"));
});

test("after KILL_MAX_ATTEMPTS: stop anyway, keep the record, tell the owner", async () => {
  const state = { active: true, current_position: { ...POS }, kill_attempts: KILL_MAX_ATTEMPTS - 1 };
  const { io, log } = fakeIo({ closes: false }, state);
  const r = await runKill({ state, io });
  assert.equal(r.outcome, "GAVE_UP");
  assert.equal(state.active, false);
  assert.ok(state.current_position, "the record stays: the position may still be live");
  assert.ok(log.includes("deleteKey") && log.includes("clearFlag"));
  assert.ok(log.some((l) => l.startsWith("notify:")));
});

test("a failing notify never blocks the give-up", async () => {
  const state = { active: true, current_position: { ...POS }, kill_attempts: KILL_MAX_ATTEMPTS };
  const { io } = fakeIo({ closes: false }, state);
  io.notify = async () => { throw new Error("telegram down"); };
  assert.equal((await runKill({ state, io })).outcome, "GAVE_UP");
});

// ── The route half ───────────────────────────────────────────────────────────────────────────
function fakeKv(init = {}) {
  const m = new Map(Object.entries(init));
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}
const A = "0x1111111111111111111111111111111111111111";

test("route: sets the flag, keeps the key and the list entry", async () => {
  const kv = fakeKv({ [`agent:key:${A}`]: "sealed", "agent:users": JSON.stringify([A, "0xb"]) });
  const r = await handleAgentKill({ kv, address: A });
  assert.equal(r.body.ok, true);
  assert.equal(kv.m.get(`agent:kill:${A}`), "1");
  assert.equal(kv.m.get(`agent:key:${A}`), "sealed");
  assert.deepEqual(JSON.parse(kv.m.get("agent:users")), [A, "0xb"]);
});

test("route: a wallet dropped by an earlier kill is put back on the list", async () => {
  for (const users of [undefined, "[]", "not json", JSON.stringify(["0xb"])]) {
    const kv = fakeKv(users === undefined ? {} : { "agent:users": users });
    await handleAgentKill({ kv, address: A });
    assert.ok(JSON.parse(kv.m.get("agent:users")).includes(A));
  }
});

// ── The wiring (source checks: index.js files aren't importable without the worker runtime) ───
const execSrc = readFileSync(new URL("./index.js", import.meta.url), "utf8");
const apiSrc = readFileSync(new URL("../nexus-lab-api/index.js", import.meta.url), "utf8");

test("exec: the kill branch goes through runKill and never reads `config` before it exists", () => {
  const start = execSrc.indexOf("if (killRaw || state.kill_requested)");
  const end = execSrc.indexOf("if (!state.active) return;", start);
  assert.ok(start > 0 && end > start);
  const branch = execSrc.slice(start, end);
  assert.match(branch, /runKill\(/);
  assert.doesNotMatch(branch, /[^A-Za-z_]config[,)]/, "a bare `config` here is the TDZ ReferenceError");
});

test("lab-api: the kill route deletes neither the key nor the list entry", () => {
  const start = apiSrc.indexOf('parts[2] === "kill"');
  const end = apiSrc.indexOf("POST /agent/:address/directive", start);
  assert.ok(start > 0 && end > start);
  const route = apiSrc.slice(start, end);
  assert.match(route, /handleAgentKill\(/);
  assert.doesNotMatch(route, /delete\(`agent:key/);
  assert.doesNotMatch(route, /filter\(\(u\) => u !== address\)/);
});

test("lab-api: both activation paths clear a pending kill flag", () => {
  for (const marker of ["// PUT /agent/:address — activate", "POST /agent/:address/bankr/activate"]) {
    const start = apiSrc.indexOf(marker);
    const end = apiSrc.indexOf("return json({ ok: true", start);
    assert.ok(start > 0 && end > start, marker);
    assert.match(apiSrc.slice(start, end), /delete\(`agent:kill:\$\{address\}`\)/, marker);
  }
});
