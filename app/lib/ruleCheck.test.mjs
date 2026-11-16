// app/lib/ruleCheck.mjs + workers/nexus-lab-api/routes-rulecheck.mjs. Run: node --test app/lib/ruleCheck.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ruleCheck, ruleCheckLine, RULE_CHECKS, MATCH_AFTER_MS } from "./ruleCheck.mjs";
import { REGISTERED_READS } from "./readPipeline.mjs";

const H = 3600000;
const FROM = Date.parse("2026-11-17T00:00:00Z");
const check = { reads: ["shelf_breakdown_short", "bb_rsi_momentum"], coins: ["BTC", "ETH", "ZEC"], from: "2026-11-17T00:00:00Z" };
const call = (id, sym, dir, at, extra = {}) => ({ id, symbol: `PERP_${sym}_USDC`, direction: dir, publishedAt: at, isPublic: true, ...extra });

test("posted, skipped, pending and off-rule, one call per setup", () => {
  const t1 = FROM + 10 * H, t2 = FROM + 20 * H, t3 = FROM + 30 * H;
  const now = t3 + H; // t3's window is still open
  const events = [
    { coin: "ETH", read: "shelf_breakdown_short", t: t1, side: "SHORT" },
    { coin: "ETH", read: "bb_rsi_momentum", t: t1, side: "SHORT" },  // same coin/side/hour = one setup
    { coin: "BTC", read: "bb_rsi_momentum", t: t2, side: "LONG" },   // no call → skipped
    { coin: "ZEC", read: "bb_rsi_momentum", t: t3, side: "SHORT" },  // window open → pending
    { coin: "ETH", read: "bb_rsi_momentum", t: FROM - H, side: "LONG" }, // before the start: not counted
    { coin: "SOL", read: "bb_rsi_momentum", t: t1, side: "LONG" },   // not one of its coins
  ];
  const theses = [
    call("a", "ETH", "SHORT", t1 - 20 * 60000),            // inside the bar: posted
    call("b", "ETH", "SHORT", t1 + 30 * 60000),            // a second call on the same setup: off-rule
    call("c", "BTC", "SHORT", t2 + 10 * 60000),            // wrong side for the BTC setup: off-rule
    call("d", "SOL", "LONG", t1),                           // a coin it isn't checked on: off-rule
    call("e", "ETH", "LONG", FROM - 2 * H),                 // before the start: not counted
    call("f", "ETH", "SHORT", t1, { isPublic: false }),     // private: not counted
    call("g", "ETH", "SHORT", t1, { duplicateOf: "x" }),    // a marked copy: not counted
  ];
  const r = ruleCheck(events, theses, check, now);
  assert.deepEqual([r.setups, r.posted, r.skipped, r.pending, r.calls, r.offRule], [3, 1, 1, 1, 4, 3]);
  assert.deepEqual(r.reads.shelf_breakdown_short, { setups: 1, posted: 1, skipped: 0, pending: 0 });
  assert.deepEqual(r.reads.bb_rsi_momentum, { setups: 3, posted: 1, skipped: 1, pending: 1 });
  assert.deepEqual(r.recent[2], { coin: "ETH", side: "SHORT", t: t1, reads: ["shelf_breakdown_short", "bb_rsi_momentum"], state: "POSTED", call: "a" });
  assert.deepEqual(r.recentOffRule.map((c) => c.id), ["c", "b", "d"], "newest first");
});

test("the match window: from the bar's open to MATCH_AFTER_MS after its close, never earlier or later", () => {
  const t = FROM + 10 * H, ev = [{ coin: "ETH", read: "bb_rsi_momentum", t, side: "LONG" }], now = t + 10 * H;
  const at = (ms) => ruleCheck(ev, [call("x", "ETH", "LONG", ms)], check, now).posted;
  assert.equal(at(t - H), 1, "the bar's open");
  assert.equal(at(t - H - 1), 0, "before the bar");
  assert.equal(at(t + MATCH_AFTER_MS), 1);
  assert.equal(at(t + MATCH_AFTER_MS + 1), 0);
});

test("an unread coin's calls and setups are left out, and named", () => {
  const t = FROM + 10 * H;
  const r = ruleCheck([{ coin: "ZEC", read: "bb_rsi_momentum", t, side: "LONG" }], [call("z", "ZEC", "SHORT", t)], check, t + 10 * H, { unread: ["ZEC"] });
  assert.deepEqual([r.setups, r.offRule, r.unread], [0, 0, ["ZEC"]]);
  assert.match(ruleCheckLine({ ...r, calls: 1 }, t + 10 * H), /\(ZEC unread\)\.$/);
});

test("the /proof line: plain counts, before the start, nothing yet", () => {
  assert.equal(ruleCheckLine(null), null);
  const base = { from: "2026-11-17T00:00:00Z", setups: 0, calls: 0, posted: 0, skipped: 0, pending: 0, offRule: 0 };
  assert.match(ruleCheckLine(base, FROM - H), /^Rule check starts Nov 17/);
  assert.equal(ruleCheckLine(base, FROM + H), "Rule check since Nov 17: no setup on its coins yet, no call posted.");
  assert.equal(ruleCheckLine({ ...base, setups: 12, posted: 9, skipped: 2, pending: 1, calls: 10, offRule: 1 }, FROM + 99 * H),
    "Rule check since Nov 17: 12 setups on its coins · 9 posted · 2 skipped · 1 pending · 1 call off its rules.");
  assert.doesNotMatch(ruleCheckLine({ ...base, setups: 3, posted: 3, calls: 3 }, FROM + 99 * H), /proven|edge|accura|honest|trust/i);
});

test("checks only engine wallets, against registered reads, from on or after their registration", () => {
  const toml = readFileSync(new URL("../../workers/nexus-lab-api/wrangler.toml", import.meta.url), "utf8");
  const engines = /^ENGINE_CALLER_ADDRESSES = "([^"]+)"/m.exec(toml)[1].split(",").map((a) => a.trim().toLowerCase());
  for (const [w, c] of Object.entries(RULE_CHECKS)) {
    assert.ok(engines.includes(w), `${w} is an engine wallet`);
    for (const read of c.reads) {
      const reg = REGISTERED_READS.find((r) => r.axis === read);
      assert.ok(reg, `${read} is registered`);
      assert.ok(Date.parse(c.from) >= Date.parse(reg.registeredAt), `${read}: the check starts no earlier than its registration`);
    }
  }
});

test("the route runs the scoreboard's own generators on candle:hist and matches lab:{wallet}", async () => {
  const { buildRuleCheck, handleRuleCheck } = await import("../../workers/nexus-lab-api/routes-rulecheck.mjs");
  const W = "0xbce4b16be2088696d11d271ad29149f2dd97f432";
  const kv = (m) => ({ get: async (k) => m[k] ?? null, put: async (k, v) => { m[k] = v; } });
  const store = { [`lab:${W}`]: JSON.stringify({ theses: [call("q", "BTC", "LONG", FROM + 5 * H)] }) };
  const env = { LAB_STORE: kv(store), NEXUS_AGENT: kv({}) }; // no tape at all
  const r = await buildRuleCheck(env, W, { now: FROM + 50 * H });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unread, ["BTC", "ETH", "SOL", "HYPE", "ZEC"]);
  assert.equal(r.offRule, 0, "an unread coin's call is never called off-rule");
  const res = await handleRuleCheck(["engines", "rule-check", "0x" + "1".repeat(40)], new Request("https://x/"), env);
  assert.equal(res.status, 404);
  // A real tape: the route finds the same setups the scoreboard's generator finds, and a call on the first one posts.
  const { bbRsiMomentumEvents } = await import("../../workers/nexus-lab-api/explorerReads.mjs");
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tape = []; let px = 100;
  for (let i = 0; i < 1500; i++) {
    const t = FROM - 1000 * H + i * H, o = px; px *= 1 + (rnd() - 0.48) * 0.03;
    tape.push({ t, o, h: Math.max(o, px) * (1 + rnd() * 0.004), l: Math.min(o, px) * (1 - rnd() * 0.004), c: px, v: 100 + rnd() * 50 });
  }
  const evs = bbRsiMomentumEvents({ candleHist: tape }).filter((e) => e.t > FROM && e.t <= FROM + 480 * H);
  assert.ok(evs.length >= 2, `the tape fires (${evs.length})`);
  const store2 = { [`lab:${W}`]: JSON.stringify({ theses: [call("p", "ETH", evs[0].side, evs[0].t + 60000)] }) };
  const r2 = await buildRuleCheck({ LAB_STORE: kv(store2), NEXUS_AGENT: kv({ "candle:hist:PERP_ETH_USDC": JSON.stringify(tape) }) }, W, { now: FROM + 480 * H });
  assert.equal(r2.reads.bb_rsi_momentum.setups, evs.length);
  assert.deepEqual([r2.posted, r2.offRule], [1, 0]);
  assert.deepEqual(r2.unread, ["BTC", "SOL", "HYPE", "ZEC"]);
  const src = readFileSync(new URL("../../workers/nexus-lab-api/routes-rulecheck.mjs", import.meta.url), "utf8");
  assert.match(src, /EXPLORER_GENS\[read\]/, "the scoreboard's own generators, no copy");
  assert.doesNotMatch(src, /\.put\(`(?!engine:rulecheck)/, "writes nothing but its own cache");
});
