// Run: node --test workers/nexus-lab-api/paperTape.test.mjs
// The tape check end to end (paperTape.mjs): agent state in, evidence out, against an injected Orderly.
import test from "node:test";
import assert from "node:assert/strict";
import { runPaperTape, handlePaperTape, walletsForRun, pruneChecks, proofPaperWallets, PTAPE_KEY, TAPE_SETTLE_MS, TAPE_GIVE_UP_MS } from "./paperTape.mjs";
import { entryKey, exitKey, exitKeyOf } from "../../app/lib/paperTape.mjs";

const M = 60;
const W = "0x" + "ab".repeat(20);
const NOW = Date.UTC(2026, 10, 13, 14, 41);
const T_IN = Date.UTC(2026, 10, 13, 12, 0, 20);         // entry: 100 traded in that minute
const T_OUT = Date.UTC(2026, 10, 13, 13, 0, 30);        // exit: 110 never traded near then

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [];
  return { m, puts, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); puts.push(k); }, async delete(k) { m.delete(k); } };
}
// Orderly: ETH trades 99.5–100.5 around the entry minute and 104–105 around the exit minute.
function orderly({ fail = false, empty = false } = {}) {
  const calls = [];
  const fetchJson = async (url) => {
    calls.push(url);
    if (fail) throw new Error("orderly 429");
    const q = new URL(url).searchParams;
    const from = Number(q.get("from")), to = Number(q.get("to"));
    if (empty) return { s: "no_data" };
    const t = []; for (let x = from; x <= to; x += M) t.push(x);
    const near = (x) => (Math.abs(x * 1000 - T_IN) < 10 * M * 1000 ? [100.5, 99.5] : [105, 104]);
    return { s: "ok", t, o: t.map((x) => near(x)[1]), h: t.map((x) => near(x)[0]), l: t.map((x) => near(x)[1]), c: t.map((x) => near(x)[1]) };
  };
  return { fetchJson, calls };
}
const row = (over = {}) => ({ id: "paper_1", symbol: "PERP_ETH_USDC", direction: "LONG", entry_price: 100, exit_price: 110,
  opened_at: new Date(T_IN).toISOString(), closed_at: new Date(T_OUT).toISOString(), reason: "TP", ...over });
const envWith = (state, users = [W]) => ({
  NEXUS_AGENT: kv({ "agent:users": users, [`agent:state:${W}`]: state }),
  LAB_STORE: kv(),
});

test("each fill is checked against its minute and the evidence kept: the bar and its public request", async () => {
  const env = envWith({ paper_trades: [row()] });
  const o = orderly();
  const r = await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW });
  assert.deepEqual([r.wallets, r.fills, r.checked, r.written], [1, 2, 2, 1]);
  const rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  const entry = rec.checks[entryKey("PERP_ETH_USDC", T_IN)], exit = rec.checks[exitKey("paper_1")];
  assert.equal(entry.verdict, "ON_TAPE");
  assert.equal(exit.verdict, "OFF", "110 never traded: the exit is off the tape");
  assert.ok(exit.bps > 400, "with its distance");
  assert.match(entry.source, /^https:\/\/api-evm\.orderly\.org\/tv\/history\?symbol=PERP_ETH_USDC&resolution=1&from=\d+&to=\d+$/);
  assert.equal(entry.bar.length, 5, "the bar as Orderly served it");
  assert.equal(env.NEXUS_AGENT.puts.length, 0, "the checker never writes agent state");

  // A second run asks Orderly nothing: a finished minute's check is final.
  const before = o.calls.length;
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW + 3_600_000 });
  assert.equal(o.calls.length, before);
});

test("a fill whose minute may still be printing waits; a refused read is retried; an old empty one is NO_DATA", async () => {
  const fresh = envWith({ current_position: { symbol: "PERP_ETH_USDC", paper: true, entry_price: 100, opened_at: NOW - TAPE_SETTLE_MS + 1000 } });
  assert.equal((await runPaperTape(fresh, { fetchJson: orderly().fetchJson, nowMs: () => NOW })).checked, 0);

  const refused = envWith({ paper_trades: [row()] });
  const r = await runPaperTape(refused, { fetchJson: orderly({ fail: true }).fetchJson, nowMs: () => NOW });
  assert.deepEqual([r.checked, r.retried, refused.LAB_STORE.m.has(PTAPE_KEY(W))], [0, 2, false]);

  const recent = envWith({ paper_trades: [row()] });
  assert.equal((await runPaperTape(recent, { fetchJson: orderly({ empty: true }).fetchJson, nowMs: () => NOW })).checked, 0, "Orderly may be behind: retry");
  const old = envWith({ paper_trades: [row()] });
  await runPaperTape(old, { fetchJson: orderly({ empty: true }).fetchJson, nowMs: () => T_OUT + TAPE_GIVE_UP_MS + 1 });
  const rec = JSON.parse(old.LAB_STORE.m.get(PTAPE_KEY(W)));
  assert.equal(rec.checks[exitKey("paper_1")].verdict, "NO_DATA");
});

test("a DCA average entry is never sent to Orderly; live (non-paper) positions are ignored", async () => {
  const env = envWith({ paper_trades: [row({ entry_avg: true })], current_position: { symbol: "PERP_BTC_USDC", paper: false, entry_price: 1, opened_at: NOW - 3_600_000 } });
  const o = orderly();
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW });
  assert.equal(o.calls.length, 1, "only the exit");
});

test("the route serves every fill with its verdict, the summary line and the rule", async () => {
  const env = envWith({ paper_trades: [row()] });
  await runPaperTape(env, { fetchJson: orderly().fetchJson, nowMs: () => NOW });
  const res = await handlePaperTape(["agent", W, "tape"], new Request(`https://og.example/agent/${W}/tape`), env);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.fills.map((f) => [f.kind, f.verdict]), [["exit", "OFF"], ["entry", "ON_TAPE"]]);
  assert.deepEqual([body.summary.judged, body.summary.onTape, body.summary.off], [2, 1, 1]);
  assert.match(body.line, /^1 of 2 paper fills traded inside/);
  assert.match(body.rule, /index price, not a trade/);
  assert.equal((await handlePaperTape(["agent", "0x" + "00".repeat(20), "tape"], new Request("https://x/"), env)).status, 404);
  assert.equal((await handlePaperTape(["agent", "nope", "tape"], new Request("https://x/"), env)).status, 400);
  assert.equal(await handlePaperTape(["agent", W, "parity"], new Request("https://x/"), env), null, "not this route");
});

test("wallet order: /proof's paper wallets always, then a rotating slice of the rest", () => {
  const users = Array.from({ length: 5 }, (_, i) => "0x" + String(i).repeat(40));
  const a = walletsForRun(["0xPROOF".padEnd(42, "0").toLowerCase()], users, 0, 2);
  assert.equal(a.wallets.length, 3);
  assert.equal(a.next, 2);
  const b = walletsForRun(["0xPROOF".padEnd(42, "0").toLowerCase()], users, 4, 2);
  assert.deepEqual(b.wallets.slice(1), [users[4], users[0]], "wraps around");
  assert.ok(proofPaperWallets().includes("0x95e26e980e300c34360933b849457f42c6bd7622"), "the level_reclaim paper wallet");
});

test("pruning keeps every fill the state still shows, then the newest others", () => {
  const checks = { a: { t: 1 }, b: { t: 5 }, c: { t: 3 }, live: { t: 0 } };
  assert.deepEqual(Object.keys(pruneChecks(checks, [{ key: "live" }], 2)), ["live", "b"]);
});

test("an old fill Orderly keeps refusing is recorded NO_DATA with the reason after 3 runs, never retried forever", async () => {
  const env = envWith({ paper_trades: [row()] });
  const o = orderly({ fail: true });
  const old = () => T_OUT + TAPE_GIVE_UP_MS + 3_600_000;
  const r1 = await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: old });
  assert.equal(r1.retried, 2);
  let rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  assert.equal(rec.tries[exitKeyOf(row())], 1, "the refusal is counted");
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: old });
  const r3 = await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: old });
  assert.equal(r3.gaveUp, 2);
  rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  const c = rec.checks[exitKeyOf(row())];
  assert.equal(c.verdict, "NO_DATA");
  assert.match(c.reason, /^Orderly refused 3 times: orderly 429/);
  assert.equal(rec.tries, undefined, "no counters left behind");
  const calls = o.calls.length;
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: old });
  assert.equal(o.calls.length, calls, "settled: Orderly isn't asked again");
});

test("a young fill's refusals don't count toward giving up", async () => {
  const env = envWith({ paper_trades: [row()] });
  const o = orderly({ fail: true });
  for (let i = 0; i < 4; i++) await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW });
  assert.equal(env.LAB_STORE.m.has(PTAPE_KEY(W)), false, "nothing recorded: it just waits");
});

test("a stop exit is checked for its trigger too, and one checked before the trigger existed is asked again once", async () => {
  // LONG from 100, 2% stop = 98. ETH around the exit traded 104–105 in this fake: the stop never traded.
  const env = envWith({ paper_trades: [row({ reason: "SL", sl_percent: 2, exit_price: 97.9 })] });
  const o = orderly();
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW });
  let rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  const c = rec.checks[exitKeyOf(row())];
  assert.equal(c.trigger.verdict, "MARK_ONLY");
  assert.equal(c.trigger.side, "STOP");
  assert.equal(c.trigger.span.length, 3, "the bars it judged are kept");

  // An old-style check (no trigger) gets one more look; a refusal then keeps the check it has.
  delete rec.checks[exitKeyOf(row())].trigger;
  env.LAB_STORE.m.set(PTAPE_KEY(W), JSON.stringify(rec));
  await runPaperTape(env, { fetchJson: orderly({ fail: true }).fetchJson, nowMs: () => NOW });
  rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  assert.equal(rec.checks[exitKeyOf(row())].verdict, "OFF", "kept as it was");
  await runPaperTape(env, { fetchJson: o.fetchJson, nowMs: () => NOW });
  rec = JSON.parse(env.LAB_STORE.m.get(PTAPE_KEY(W)));
  assert.equal(rec.checks[exitKeyOf(row())].trigger.verdict, "MARK_ONLY");
  const res = await (await handlePaperTape(["agent", W, "tape"], new Request("https://x/"), env)).json();
  assert.equal(res.fills.find((f) => f.kind === "exit").trigger.verdict, "MARK_ONLY");
  assert.equal(res.summary.markOnly, 1);
});
