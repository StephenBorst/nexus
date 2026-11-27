// Run: node --test workers/nexus-lab-api/paperJudge.test.mjs
// The 30-trade paper judgment end to end (paperJudge.mjs): agent state in, a FINAL verdict recorded once.
import test from "node:test";
import assert from "node:assert/strict";
import { runPaperJudge, handlePaperJudge, liveJudgment, PJUDGE_KEY } from "./paperJudge.mjs";
import { PTAPE_KEY } from "./paperTape.mjs";
import { PAPER_JUDGMENTS, judgeWindow } from "../../app/lib/paperJudge.mjs";
import { entryKey, exitKeyOf } from "../../app/lib/paperTape.mjs";

const RULE = PAPER_JUDGMENTS.level_reclaim;
const W = RULE.wallet.toLowerCase();
const H = 3600000;
const T0 = Date.UTC(2026, 10, 5, 6);

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  const puts = [], gets = [];
  return { m, puts, gets, async get(k) { gets.push(k); return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); puts.push(k); } };
}
const row = (i, over = {}) => {
  const opened = T0 + i * 10 * H;
  return { id: `paper_${i}`, symbol: "PERP_ETH_USDC", direction: "LONG", entry_price: 100, exit_price: 101, sl_percent: 1, reason: "TP",
    opened_at: new Date(opened).toISOString(), closed_at: new Date(opened + 5 * H).toISOString(), ...over };
};
function setup(n, { exit = 101 } = {}) {
  const rows = Array.from({ length: n }, (_, i) => row(i, { exit_price: exit }));
  const state = { started_at: T0 - H, paper_trades: rows.slice().reverse(), paper_agg: { trades: n } };
  const checks = {};
  for (const t of rows) { checks[entryKey(t.symbol, Date.parse(t.opened_at))] = { verdict: "ON_TAPE" }; checks[exitKeyOf(t)] = { verdict: "ON_TAPE" }; }
  const config = { mode: "PAPER", signalMode: "LEVEL_RECLAIM", symbols: ["PERP_ETH_USDC"], maxTradesPerDay: 24 };
  const env = {
    NEXUS_AGENT: kv({ [`agent:state:${W}`]: state, [`agent:config:${W}`]: config }),
    LAB_STORE: kv({ [PTAPE_KEY(W)]: { v: 1, checks } }),
  };
  // One graded event a minute before each entry: every entry pairs, nothing is missed.
  const events = rows.map((t) => ({ coin: "ETH", t: Date.parse(t.opened_at) - 60000, side: "LONG" }));
  return { env, state, eventsFor: async () => events, after: judgeWindow("level_reclaim", state)?.readableAt + 1 };
}

test("before 30 trades the job only counts: no tape, funding or events read, nothing written", async () => {
  const { env, eventsFor } = setup(6);
  let asked = 0;
  const r = await runPaperJudge(env, { eventsFor: async () => { asked++; return []; } });
  assert.deepEqual(r.level_reclaim, { verdict: "ACCRUING", count: 6 });
  assert.equal(asked, 0);
  assert.equal(env.LAB_STORE.puts.length, 0);
  assert.ok(env.NEXUS_AGENT.gets.every((k) => k.startsWith("agent:state:")));
  void eventsFor;
});

test("at 30 with parity clean the verdict is recorded once, with its trades, and never rewritten", async () => {
  const { env, eventsFor, after } = setup(30);
  const r = await runPaperJudge(env, { eventsFor, nowMs: () => after });
  assert.deepEqual(r.level_reclaim, { verdict: "PASS", recorded: true, now: true });
  const rec = JSON.parse(env.LAB_STORE.m.get(PJUDGE_KEY("level_reclaim")));
  assert.equal(rec.verdict, "PASS");
  assert.equal(rec.trades.length, 30);
  assert.equal(rec.parityReport.verdict, "CLEAN");
  assert.equal(rec.parityReport.counts.matched, 30);
  assert.ok(rec.judgedAt);

  // The state moves on (31 more trades, all losers): the recorded verdict stands.
  const worse = setup(61, { exit: 90 });
  env.NEXUS_AGENT.m.set(`agent:state:${W}`, JSON.stringify(worse.state));
  const again = await runPaperJudge(env, { eventsFor, nowMs: () => after + 100 * H });
  assert.deepEqual(again.level_reclaim, { verdict: "PASS", recorded: true });
  assert.equal(env.LAB_STORE.puts.filter((k) => k === PJUDGE_KEY("level_reclaim")).length, 1, "written once");

  const res = await handlePaperJudge(["signals", "paper-judge", "level_reclaim"], new Request("https://og.example/signals/paper-judge/level_reclaim"), env);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.deepEqual([body.recorded, body.verdict, body.trades.length], [true, "PASS", 30]);
  assert.match(body.line, /^Passed at 30 trades: \+95 bps a trade/);
  // badge bar v2: the PASS carries its random-entry check, run once with it. No candle:hist here = UNREAD, the badge waits.
  assert.equal(rec.randomCheck.verdict, "UNREAD");
  assert.equal(rec.randomCheck.seed, 20261120);
  assert.match(body.badgeLine, /random-entry check is unread/);
});

test("badge bar v2: a PASS is stored with its 300 replays from the coins' hourly tape, once", async () => {
  const { env, eventsFor, after } = setup(30);
  // ETH's recorded hours across the run's window and a week past it, flat and quiet: random entries net ~ −5 bps of fees
  const bars = [];
  for (let t = T0 - 100 * H; t <= T0 + 520 * H; t += H) {
    const c = 100 * (1 + 0.004 * Math.sin(t / H / 7));
    bars.push({ t, o: c, h: c * 1.003, l: c * 0.997, c });
  }
  env.NEXUS_AGENT.m.set("candle:hist:PERP_ETH_USDC", JSON.stringify(bars));
  await runPaperJudge(env, { eventsFor, nowMs: () => after });
  const rec = JSON.parse(env.LAB_STORE.m.get(PJUDGE_KEY("level_reclaim")));
  assert.equal(rec.randomCheck.runs, 300);
  assert.equal(rec.randomCheck.means.length, 300);
  assert.equal(rec.randomCheck.judgedMeanBps, 94.975, "move − fees, no funding (+100 bps move, 2.5 + 2.525 fees)");
  assert.equal(rec.randomCheck.verdict, "BEAT");
  assert.equal(rec.randomCheck.pctBeaten, 100);
});

test("an unmatched entry is DRIFT: HELD, nothing recorded", async () => {
  const { env, after } = setup(30);
  const r = await runPaperJudge(env, { eventsFor: async () => [], nowMs: () => after });
  assert.equal(r.level_reclaim.verdict, "HELD");
  assert.equal(env.LAB_STORE.puts.length, 0);
  const j = await liveJudgment(env, "level_reclaim", { eventsFor: async () => [], nowMs: after });
  assert.equal(j.parityReport.unmatchedTrades.length, 30);
});

test("parity isn't read before its window has settled", async () => {
  const { env, eventsFor, state } = setup(30);
  let asked = 0;
  const j = await liveJudgment(env, "level_reclaim", { eventsFor: async (...a) => { asked++; return eventsFor(...a); }, nowMs: judgeWindow("level_reclaim", state).readableAt - 1 });
  assert.equal(j.verdict, "PENDING");
  assert.equal(asked, 0);
});

test("the route: 404 for a read with no judgment, 405 for a write, null for another path", async () => {
  const { env } = setup(6);
  assert.equal((await handlePaperJudge(["signals", "paper-judge", "session_momentum"], new Request("https://x/"), env)).status, 404);
  assert.equal((await handlePaperJudge(["signals", "paper-judge", "level_reclaim"], new Request("https://x/", { method: "POST" }), env)).status, 405);
  assert.equal(await handlePaperJudge(["signals", "paper-run", "level_reclaim"], new Request("https://x/"), env), null);
  const body = await (await handlePaperJudge(["signals", "paper-judge", "level_reclaim"], new Request("https://x/"), env)).json();
  assert.deepEqual([body.verdict, body.count, body.recorded], ["ACCRUING", 6, false]);
});

// borst 2026-11-27, option (a): a claimed paper wallet replaces its read's house run in the judgment.
test("a read with a claimed wallet: its house run is not judged, and the route has no judgment for it yet", async () => {
  const { PAPER_CLAIMS_KEY } = await import("../../app/lib/paperClaim.mjs");
  const claims = { btc_lead_lag: { axis: "btc_lead_lag", wallet: "0x" + "7".repeat(40), at: "2026-11-28T00:00:00Z", startedAt: "2026-11-27T23:00:00Z" } };
  const env = { NEXUS_AGENT: kv({}), LAB_STORE: kv({ [PAPER_CLAIMS_KEY]: claims }) };
  const r = await runPaperJudge(env, { eventsFor: async () => [] });
  assert.ok(!("btc_lead_lag" in r), "the house run is not judged once a wallet is claimed");
  assert.ok("rsi_reset_deep" in r, "other house runs still are");
  assert.ok(!env.NEXUS_AGENT.gets.includes("agent:state:0x97371cec6dc63aa0e9c0747110e5e3042b6217a5"));
  const res = await handlePaperJudge(["signals", "paper-judge", "btc_lead_lag"], new Request("https://og.test/x"), env);
  assert.equal(res.status, 404);
  // without the claim it is the house run's judgment, as before
  const env2 = { NEXUS_AGENT: kv({}), LAB_STORE: kv({}) };
  const res2 = await handlePaperJudge(["signals", "paper-judge", "btc_lead_lag"], new Request("https://og.test/x"), env2);
  assert.equal((await res2.json()).wallet, "0x97371cec6dc63aa0e9c0747110e5e3042b6217a5");
});

test("claims that can't be read: the hourly job records nothing (never a house run judged in a claimed wallet's place)", async () => {
  const env = { NEXUS_AGENT: kv({}), LAB_STORE: { ...kv({}), async get() { throw new Error("kv down"); } } };
  await assert.rejects(runPaperJudge(env, { eventsFor: async () => [] }), /claims_unread/);
});
