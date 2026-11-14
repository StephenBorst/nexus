// The owner's Telegram digest + instant alerts (app/lib/opsDigest.mjs rules, opsDigest.mjs runner).
// Run: node --test opsDigest.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pendingItems, alertsFor, alertText, digestText, digestDue, receiversFrom, digestState, verdictSteps,
  DIGEST_STATE_KEY, DIGEST_DAY_KEY, DIGEST_HOUR_UTC, DIGEST_RUN_MINUTE,
} from "../../app/lib/opsDigest.mjs";
import { runOpsDigest, gatherFacts } from "./opsDigest.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";
import { LIVE_PLAN_SIGS_KEY } from "../../app/lib/livePlanSign.mjs";
import { LIVE_PLAN_TEXT } from "../../app/lib/livePlanText.mjs";

const NOW = Date.parse("2026-11-14T16:49:00Z");
const LR = "0x95e26e980e300c34360933b849457f42c6bd7622";

test("pending: register (a setup exists), wire (none yet), sign (a claimed page unsigned)", () => {
  const p = pendingItems([
    { axis: "level_reclaim", stage: "PAPER", wallet: LR, hasSetup: true, signed: null },
    { axis: "session_fade", stage: "TRADEABLE", wallet: null, hasSetup: true, signed: null },
    { axis: "spot_absorb", stage: "TRADEABLE", wallet: null, hasSetup: false, signed: null },
    { axis: "btc_lead_lag", stage: "PAPER", wallet: "0x" + "7".repeat(40), hasSetup: true, signed: false },
  ]);
  assert.deepEqual(p.map((x) => x.key), ["register:session_fade", "wire:spot_absorb", "sign:btc_lead_lag"]);
  assert.match(p[1].text, /Ask Claude to build it/);
});

const facts = (over = {}) => ({
  asOf: NOW, boardAsOf: "2026-11-14T15:53:00Z",
  stages: { level_reclaim: "PAPER", oi_div_reversal_4h: "PAPER", rsi_reset_deep: "REGISTERED", session_momentum: "RETIRED" },
  paper: [
    { axis: "level_reclaim", count: 7, target: 30, parity: "CLEAN", verdict: null, open: null,
      closed24h: [{ n: 7, coin: "XRP", side: "LONG", reason: "TP", r: 1.52, rBasis: "fill", tape: { entry: "ON_TAPE", exit: "NEAR" } }],
      quiet: { text: "no signal · 11 of 11 markets: no reclaim this hour", stale: false } },
    { axis: "oi_div_reversal_4h", count: 0, target: 30, parity: "NO_DATA", verdict: null, closed24h: [], quiet: null,
      open: { coin: "ETH", side: "SHORT", openedAt: "2026-11-14T09:00:00.000Z" } },
  ],
  pending: [], receivers: null, ...over,
});

test("first run alerts nothing (no burst of 'news'); a stage move, a drift and a verdict alert once", () => {
  assert.deepEqual(alertsFor(null, facts()), []);
  const prev = digestState(facts());
  assert.deepEqual(alertsFor(prev, facts()), [], "nothing changed, nothing sent");
  const moved = facts({ stages: { ...facts().stages, rsi_reset_deep: "LEAD" } });
  assert.deepEqual(alertsFor(prev, moved).map((a) => a.text), ["rsi_reset_deep: REGISTERED → LEAD."]);
  const drift = facts();
  drift.paper[0] = { ...drift.paper[0], parity: "DRIFT", parityNote: "1 paper entry with no graded event, 0 graded events missed unexplained" };
  const d = alertsFor(prev, drift);
  assert.equal(d.length, 1);
  assert.match(d[0].text, /level_reclaim paper parity reads DRIFT: 1 paper entry with no graded event.*waits until it's explained/);
  assert.deepEqual(alertsFor(digestState(drift), drift), [], "a drift alerts once, not every hour");
  assert.match(alertsFor(digestState(drift), facts())[0].text, /CLEAN again/);
  const judged = facts();
  judged.paper[0] = { ...judged.paper[0], verdict: "PASS" };
  assert.match(alertsFor(prev, judged)[0].text, /judgment is recorded: PASS\. It licenses nothing by itself\./);
});

test("a first-run drift still alerts: it blocks right now", () => {
  const drift = facts();
  drift.paper[1] = { ...drift.paper[1], parity: "UNVERIFIABLE" };
  assert.equal(alertsFor(null, drift).length, 1);
});

test("a new pending item alerts once; an unread board alerts nothing about stages", () => {
  const prev = digestState(facts());
  const now = facts({ pending: [{ key: "sign:x", text: "Sign x's 30-trade rules on /ops/revenue." }] });
  assert.deepEqual(alertsFor(prev, now).map((a) => a.key), ["pending:sign:x"]);
  assert.deepEqual(alertsFor(digestState(now), now), []);
  assert.deepEqual(alertsFor(prev, facts({ stages: null, pending: [] })), []);
});

test("the digest: what needs you, each paper run in R with its tape, the board; no paper dollars", () => {
  const t = digestText(facts({ receivers: { usdc: 312.4, nexus: 4_200_000, eth: 0.031, unread: 0 } }));
  assert.match(t, /^<b>Nexus · daily digest<\/b> · 2026-11-14/);
  assert.match(t, /Nothing waiting on you\./);
  assert.match(t, /level_reclaim · 7 of 30 · parity CLEAN/);
  assert.match(t, /#7 XRP LONG · target · \+1\.52R · tape ✓\/≈/);
  assert.match(t, /waiting: no signal · 11 of 11 markets: no reclaim this hour/);
  assert.match(t, /open: ETH SHORT since 2026-11-14 09:00 UTC/);
  assert.match(t, /PAPER: level_reclaim, oi_div_reversal_4h · REGISTERED 1 · RETIRED 1/);
  assert.match(t, /312\.40 USDC · 4\.20M \$NEXUS · 0\.0310 ETH\./);
  assert.match(t, /Worth a sweep to the treasury Safe when you're ready\. Nothing moves on its own\./);
  assert.doesNotMatch(t.replace(/312\.40 USDC/, ""), /\$\d/, "no dollar figures for paper");
  assert.match(digestText(facts({ stages: null })), /Scoreboard unread right now: no stage claims\./);
});

test("after a PASS: the steps in order, what's done marked, the first open one is next", () => {
  const plan = { doc: "docs/research/live-plan-level-reclaim.md", signed: false };
  const fresh = verdictSteps({ axis: "level_reclaim", verdict: "PASS" }, { plan });
  assert.match(fresh.head, /level_reclaim PASSED its 30-trade judgment \(https:\/\/trade\.nexustradinglabs\.com\/proof\/paper\/level_reclaim\)/);
  assert.deepEqual(fresh.steps.map((s) => s.state), ["next", "later", "later", "later", "later"]);
  assert.match(fresh.steps[0].text, /sign it on https:\/\/trade\.nexustradinglabs\.com\/ops\/revenue\. Signing arms nothing\..*live-plan-level-reclaim\.md/);
  assert.match(fresh.steps[2].text, /GRADED_EXIT_LIVE_LIFT, in person/);
  assert.match(fresh.steps[3].text, /\$10 mechanics test.*preflight\?wallet=<the new wallet>/);
  const signed = verdictSteps({ axis: "level_reclaim", verdict: "PASS" }, { plan: { ...plan, signed: true } });
  assert.deepEqual(signed.steps.map((s) => s.state), ["done", "next", "later", "later", "later"]);
  const W = "0x" + "c".repeat(40);
  const armed = verdictSteps({ axis: "level_reclaim", verdict: "PASS" }, { plan: { ...plan, signed: true }, liftWallet: W });
  assert.deepEqual(armed.steps.map((s) => s.state), ["done", "done", "done", "next", "later"]);
  assert.match(armed.steps[3].text, new RegExp(`preflight\\?wallet=${W}`));
  const noPlan = verdictSteps({ axis: "oi_div_reversal_4h", verdict: "PASS" });
  assert.match(noPlan.steps[0].text, /Have Claude draft oi_div_reversal_4h's live plan: none exists yet/);
});

test("after a FAIL or RESET: nothing goes live, one next step; no verdict = no steps", () => {
  const f = verdictSteps({ axis: "level_reclaim", verdict: "FAIL" });
  assert.match(f.head, /FAILED.*Nothing goes live\./);
  assert.match(f.steps[0].text, /gap question/);
  assert.match(verdictSteps({ axis: "x", verdict: "RESET" }).steps[0].text, /new dated rules page/);
  assert.equal(verdictSteps({ axis: "x", verdict: null }), null);
  assert.equal(verdictSteps({ axis: "x", verdict: "HELD" }), null);
});

test("a PASS alert points at the next step; the digest lists every step under Needs you", () => {
  const prev = digestState(facts());
  const judged = facts();
  judged.paper[0] = { ...judged.paper[0], verdict: "PASS", plan: { doc: "docs/research/live-plan-level-reclaim.md", signed: false }, liftWallet: null };
  assert.match(alertsFor(prev, judged)[0].text, /PASS\. It licenses nothing by itself\. Next: refresh and sign the live plan on \/ops\/revenue \(it arms nothing\)/);
  const t = digestText(judged);
  assert.doesNotMatch(t, /Nothing waiting on you/);
  assert.match(t, /· level_reclaim PASSED its 30-trade judgment/);
  assert.match(t, / {2}1\. \[next\] Refresh the live plan/);
  assert.match(t, / {2}2\. \[ \] Fund a NEW dedicated wallet/);
  assert.match(t, / {2}5\. \[ \] After 10 live trades/);
  const failed = facts();
  failed.paper[0] = { ...failed.paper[0], verdict: "FAIL" };
  assert.match(alertsFor(prev, failed)[0].text, /FAIL\. It licenses nothing by itself\. Nothing goes live\./);
});

test("served text is escaped for Telegram HTML", () => {
  const f = facts();
  f.paper[0].quiet = { text: "<b>x</b> & y", stale: true };
  const t = digestText(f);
  assert.ok(t.includes("&lt;b&gt;x&lt;/b&gt; &amp; y (stale: the brain may be down)"));
  assert.equal(alertText([]), null);
  assert.equal(alertText([{ text: "a <b>" }]), "<b>Nexus · heads up</b>\n· a &lt;b&gt;");
});

test("receivers: tokens summed outside the Safe; unread counted, never 0", () => {
  const rev = { groups: [
    { id: "subs", rows: [{ sym: "USDC", amount: 200 }, { sym: "USDC", amount: 12.5 }, { sym: "$NEXUS", amount: 1e6 }] },
    { id: "x402", rows: [{ sym: "$NEXUS", amount: 3e6 }, { sym: "ETH", amount: 0.01 }, { sym: "USDC", amount: null }] },
    { id: "treasury", rows: [{ sym: "USDC", amount: 99999 }] },
  ] };
  const got = receiversFrom(rev);
  assert.deepEqual({ ...got, unreadRows: undefined }, { usdc: 212.5, nexus: 4e6, eth: 0.01, unread: 1, unreadRows: undefined });
  assert.equal(got.unreadRows.length, 1);
  assert.equal(receiversFrom(null), null);
});

test("the digest names each unread balance (a failed read is never a zero)", () => {
  const rev = { groups: [
    { id: "subs", rows: [{ sym: "USDC", chain: "arb", amount: null }, { sym: "$NEXUS", chain: "base", amount: 5e6 }] },
    { id: "x402", rows: [{ sym: "$NEXUS", chain: "base", amount: null }] },
    { id: "treasury", rows: [{ sym: "USDC", chain: "arb", amount: null }] },
  ] };
  const r = receiversFrom(rev);
  assert.deepEqual(r.unreadRows, ["subs receiver USDC on Arbitrum", "Bankr wallet $NEXUS on Base"], "the Safe isn't a receiver");
  const t = digestText(facts({ receivers: r }));
  assert.match(t, /5\.00M \$NEXUS\.\nUnread: subs receiver USDC on Arbitrum, Bankr wallet \$NEXUS on Base\./);
  const none = digestText(facts({ receivers: { usdc: 0, nexus: 0, eth: 0, unread: 2, unreadRows: ["a", "b"] } }));
  assert.match(none, /<b>Receivers, not swept<\/b>\nUnread: a, b\./);
  assert.match(digestText(facts({ receivers: { usdc: 0, nexus: 0, eth: 0, unread: 0, unreadRows: [] } })), /Nothing waiting\./);
});

test("timing: once a day from 15:00 UTC, on the :49 run (after the :47 judge)", () => {
  assert.equal(DIGEST_HOUR_UTC, 15);
  assert.equal(DIGEST_RUN_MINUTE, 49);
  assert.equal(digestDue(Date.parse("2026-11-14T14:49:00Z"), false), false);
  assert.equal(digestDue(Date.parse("2026-11-14T15:49:00Z"), false), true);
  assert.equal(digestDue(Date.parse("2026-11-14T15:49:00Z"), true), false);
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /if \(minute === DIGEST_RUN_MINUTE\) \{/);
});

// ── The runner on KV fixtures: what it reads, sends and stores ───────────────────────────────────
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async list() { return { keys: [] }; } };
}
const KEY = "axisbt:test";
const board = (stages) => ({ asOf: "2026-11-14T15:53:00Z", pipeline: { reads: Object.entries(stages).map(([axis, stage]) => ({ axis, stage })) } });
const cfg = { mode: "PAPER", signalMode: "LEVEL_RECLAIM", exitContract: "R_CONTRACT", symbols: ["PERP_XRP_USDC"] };
const env = (stages = { level_reclaim: "PAPER", oi_div_reversal_4h: "PAPER" }) => ({
  TELEGRAM_TOKEN: "t", OPS_TELEGRAM_CHAT_ID: "42",
  LAB_STORE: kv({ [KEY]: board(stages) }),
  NEXUS_AGENT: kv({
    [`agent:state:${LR}`]: { started_at: NOW - 5 * 86400_000, paper_trades: [], current_position: null },
    [`agent:config:${LR}`]: cfg,
    [`agent:signal:${LR}`]: { direction: "NONE", reason: "no signal · 11 of 11 markets: quiet", timestamp: NOW - 120_000 },
  }),
});
const tg = (ok = true) => { const sent = []; return { sent, fetchImpl: async (url, init) => { sent.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok })); } }; };
const noEvents = async () => [];
const noRevenue = async () => ({ groups: [] });

test("the runner reads only, sends to the owner's chat, and remembers what it saw", async () => {
  const e = env();
  const f = await gatherFacts(e, { scorecardKey: KEY, nowMs: NOW, eventsFor: noEvents });
  const lr = f.paper.find((p) => p.axis === "level_reclaim");
  assert.equal(lr.quiet.text, "no signal · 11 of 11 markets: quiet");
  assert.equal(f.paper.find((p) => p.axis === "oi_div_reversal_4h").unread, true, "no state = unread, never zeros");
  const t = tg();
  const r = await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW, fetchImpl: t.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(r.digest, true);
  assert.equal(t.sent.length, 2, "first run: hello + the digest, no alert burst");
  assert.match(t.sent[0].text, /digest is on/);
  assert.match(t.sent[1].text, /daily digest/);
  assert.equal(t.sent[0].chat_id, "42");
  assert.equal(t.sent[0].parse_mode, "HTML");
  assert.ok(e.LAB_STORE.m.has(DIGEST_STATE_KEY));
  assert.ok(e.LAB_STORE.m.has(DIGEST_DAY_KEY("2026-11-14")));
  const again = tg();
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW + 3600_000, fetchImpl: again.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(again.sent.length, 0, "an hour later, nothing new: nothing sent");
  for (const k of e.NEXUS_AGENT.m.keys()) assert.ok(k.startsWith("agent:"), "agent keys are only read");
});

test("the runner hands a PASS its plan (signed or not) and the armed wallet for its mode, read from the lift var", async () => {
  const e = env();
  e.LAB_STORE.m.set(PJUDGE_KEY("level_reclaim"), JSON.stringify({ verdict: "PASS" }));
  let lr = (await gatherFacts(e, { scorecardKey: KEY, nowMs: NOW, eventsFor: noEvents })).paper.find((p) => p.axis === "level_reclaim");
  assert.deepEqual(lr.plan, { doc: LIVE_PLAN_TEXT.level_reclaim.doc, signed: false });
  assert.equal(lr.liftWallet, null, "the lift is empty: nothing armed");
  e.LAB_STORE.m.set(LIVE_PLAN_SIGS_KEY, JSON.stringify({ level_reclaim: { [LIVE_PLAN_TEXT.level_reclaim.sha256]: { by: LR } } }));
  const W = "0x" + "c".repeat(40);
  e.GRADED_EXIT_LIVE_LIFT = `${W}@LEVEL_RECLAIM`;
  lr = (await gatherFacts(e, { scorecardKey: KEY, nowMs: NOW, eventsFor: noEvents })).paper.find((p) => p.axis === "level_reclaim");
  assert.equal(lr.plan.signed, true);
  assert.equal(lr.liftWallet, W);
  const other = (await gatherFacts(e, { scorecardKey: KEY, nowMs: NOW, eventsFor: noEvents })).paper.find((p) => p.axis === "oi_div_reversal_4h");
  assert.equal(other.plan, undefined, "no verdict = no after-verdict facts");
});

test("a failed send keeps the old state, so the alert goes out next run (never lost, never doubled)", async () => {
  const e = env();
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW, fetchImpl: tg().fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  e.LAB_STORE.m.set(KEY, JSON.stringify(board({ level_reclaim: "PAPER", oi_div_reversal_4h: "RETIRED" })));
  const down = tg(false);
  const r = await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW + 3600_000, fetchImpl: down.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(r.sent, false);
  const up = tg();
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW + 7200_000, fetchImpl: up.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(up.sent.length, 1);
  assert.match(up.sent[0].text, /oi_div_reversal_4h: PAPER → RETIRED\./);
  const after = tg();
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW + 3 * 3600_000, fetchImpl: after.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(after.sent.length, 0);
});

test("a hello that doesn't land is retried next run; nothing is remembered until it does", async () => {
  const e = env();
  const early = Date.parse("2026-11-14T10:49:00Z"); // before the digest hour: hello only
  const down = tg(false);
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => early, fetchImpl: down.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(e.LAB_STORE.m.has(DIGEST_STATE_KEY), false);
  const up = tg();
  await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => early + 3600_000, fetchImpl: up.fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(up.sent.length, 1);
  assert.match(up.sent[0].text, /digest is on/);
  assert.ok(e.LAB_STORE.m.has(DIGEST_STATE_KEY));
});

test("no token or chat = no send, nothing remembered as sent", async () => {
  const e = { ...env(), TELEGRAM_TOKEN: undefined };
  const r = await runOpsDigest(e, { scorecardKey: KEY, nowMs: () => NOW, fetchImpl: tg().fetchImpl, eventsFor: noEvents, revenue: noRevenue });
  assert.equal(r.digest, false);
  assert.equal(e.LAB_STORE.m.has(DIGEST_DAY_KEY("2026-11-14")), false);
});
