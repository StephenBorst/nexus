// Run: node --test workers/nexus-lab-api/routes-preflight.test.mjs
// GET /agent/:a/preflight (routes-preflight.mjs) and live fills on the tape (paperTape.mjs), against fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handlePreflight } from "./routes-preflight.mjs";
import { runPaperTape, tapeView, PTAPE_KEY } from "./paperTape.mjs";
import { liveKey } from "../../app/lib/paperTape.mjs";

const W = "0x" + "cd".repeat(20);
const NOW = Date.UTC(2026, 10, 14, 12, 41);
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [];
  return { m, puts, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); puts.push(k); }, async delete(k) { m.delete(k); } };
}
const req = (path, method = "GET") => new Request(`https://og.example${path}`, { method });

test("the route reads the record and writes nothing; a key is a yes/no, never returned", async () => {
  const env = {
    NEXUS_AGENT: kv({ [`agent:config:${W}`]: { mode: "AUTONOMOUS", signalMode: "CONFLUENCE", symbols: ["PERP_ETH_USDC"] }, [`agent:state:${W}`]: {},
      [`agent:key:${W}`]: "v1:secret-iv:secret-ct", "ops:exec:heartbeat": String(NOW - 20_000) }),
    LAB_STORE: kv(),
    GRADED_EXIT_LIVE_LIFT: "",
  };
  const res = await handlePreflight(["agent", W, "preflight"], req(`/agent/${W}/preflight`), env, { nowMs: NOW });
  assert.equal(res.status, 200);
  const raw = await res.text();
  assert.doesNotMatch(raw, /secret/, "the key never leaves");
  const body = JSON.parse(raw);
  assert.deepEqual([body.ready, body.step], [true, "ENTRY"]);
  assert.equal(env.NEXUS_AGENT.puts.length + env.LAB_STORE.puts.length, 0);
  assert.equal((await handlePreflight(["agent", "nope", "preflight"], req("/x"), env)).status, 400);
  assert.equal((await handlePreflight(["agent", W, "preflight"], req("/x", "POST"), env)).status, 405);
  assert.equal(await handlePreflight(["agent", W, "tape"], req("/x"), env), null);
  const src = readFileSync(new URL("./routes-preflight.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(src, /\.put\(|\.delete\(|fetch\(|orderlyRequest/, "read-only, and never asks Orderly");
});

test("live fills are checked on the same tape, kept apart from paper", async () => {
  const t = NOW - 2 * 3_600_000;
  const slip = [{ t, symbol: "PERP_ETH_USDC", kind: "entry", side: "BUY", mark: 100, fill: 100.2, bps: 20, order_id: "555" }];
  const env = { NEXUS_AGENT: kv({ "agent:users": [W], [`agent:state:${W}`]: { live_slip: slip } }), LAB_STORE: kv() };
  const fetchJson = async (url) => {
    const q = new URL(url).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    const ts = []; for (let x = from; x <= to; x += 60) ts.push(x);
    return { s: "ok", t: ts, o: ts.map(() => 100), h: ts.map(() => 100.5), l: ts.map(() => 99.8), c: ts.map(() => 100) };
  };
  const r = await runPaperTape(env, { fetchJson, nowMs: () => NOW });
  assert.equal(r.checked, 1);
  const rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  assert.equal(rec.checks[liveKey(slip[0])].verdict, "ON_TAPE");
  assert.equal(rec.checks[liveKey(slip[0])].kind, "live_entry");
  const view = tapeView({ live_slip: slip }, rec);
  assert.equal(view.summary.fills, 0, "paper counts don't include live fills");
  assert.equal(view.live.summary.onTape, 1);
  assert.equal(view.live.fills[0].orderId, "555");
  assert.match(view.live.line, /^1 of 1 live fills sit inside/);
});
