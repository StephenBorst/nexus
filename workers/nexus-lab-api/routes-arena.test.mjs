// The Arena board's PAPER record must be the LIFETIME aggregate, not the rolling
// last-50 window, and a reset must leave a visible count. Pure function under test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { arenaPaperBlock } from "./routes-arena.mjs";

const DAY = 86400000;
const agg = { trades: 120, wins: 70, grossWin: 900, grossLoss: 500, net: 400, firstTradeAt: Date.parse("2026-08-01T00:00Z"), lastTradeAt: Date.parse("2026-08-01T00:00Z") + 10 * DAY };

test("lifetime aggregate wins over the rolling 50-trade window", () => {
  // Window shows 50 trades, all losses. Lifetime says 120 trades, 70 wins, net positive.
  const losingWindow = Array.from({ length: 50 }, (_, i) => ({ pnl: -5, opened_at: new Date(i * 1000).toISOString(), closed_at: new Date(DAY + i * 1000).toISOString() }));
  const b = arenaPaperBlock({ paper_trades: losingWindow, paper_agg: agg });
  assert.equal(b.lifetime, true);
  assert.equal(b.trades, 120, "must count the whole record, not the window");
  assert.equal(b.wins, 70);
  assert.equal(b.netPnl, 400);
  assert.equal(b.daysActive, 10);
  assert.ok(b.score > 0, "score comes from the lifetime figures");
});

test("agents with no aggregate yet are labelled as a window", () => {
  const rows = [{ pnl: 3, opened_at: new Date(0).toISOString(), closed_at: new Date(DAY).toISOString() }];
  const b = arenaPaperBlock({ paper_trades: rows });
  assert.equal(b.lifetime, false);
  assert.equal(b.window, "last 50 trades");
  assert.equal(b.trades, 1);
});

test("no paper history returns null, not a zeroed record", () => {
  assert.equal(arenaPaperBlock({}), null);
  assert.equal(arenaPaperBlock({ paper_trades: [], paper_agg: null }), null);
});

test("resets are counted on the card", () => {
  assert.equal(arenaPaperBlock({ paper_agg: agg, paper_resets: 2 }).resets, 2);
  assert.equal(arenaPaperBlock({ paper_agg: agg }).resets, 0);
});

// Anchoring is paused: the root endpoint must say so, and must NOT present the last
// commit (an empty-ledger root from Oct 22) as current or live.
import { handleArena as _handleArena } from "./routes-arena.mjs";
function fakeKV(map) { return { get: async (k) => (map[k] ?? null), put: async () => {} }; }
const ANCHOR_RECORD = JSON.stringify({ root: "0x" + "ab".repeat(32), recordCount: 0, txHash: "0xa5a5", ts: 1 });
test("paper root reports anchoring paused and does not call the old commit current", async () => {
  const env = { NEXUS_AGENT: fakeKV({ "arena:paper:onchain": ANCHOR_RECORD }), ONCHAIN_ANCHOR_LIVE: "false" };
  const res = await _handleArena(["arena", "paper", "root"], new Request("https://x.test/arena/paper/root"), env);
  const body = await res.json();
  assert.equal(body.anchoring, "paused");
  assert.equal(body.onChain.anchoring, "paused");
  assert.equal(body.onChain.current, false);
  assert.match(body.onChain.note, /paused/i);
});
test("paper root reports live only when the flag is on", async () => {
  const env = { NEXUS_AGENT: fakeKV({}), ONCHAIN_ANCHOR_LIVE: "true" };
  const body = await (await _handleArena(["arena", "paper", "root"], new Request("https://x.test/arena/paper/root"), env)).json();
  assert.equal(body.anchoring, "live");
  assert.equal(body.onChain, null);
});

// Board stats: the lifetime block carries the Lab's qualifying rule (AGENT_BOARD)
// and the reset count, so the board can say "X of 10 trades to qualify".
test("paper block: lifetime carries qualify + resets", () => {
  const b = arenaPaperBlock({
    paper_resets: 2,
    paper_agg: { trades: 4, wins: 3, grossWin: 30, grossLoss: 10, net: 20, firstTradeAt: Date.now() - 5 * 86400000, lastTradeAt: Date.now() },
  });
  assert.equal(b.lifetime, true);
  assert.equal(b.resets, 2);
  assert.equal(b.qualify.eligible, false);
  const need = b.qualify.criteria[0];
  assert.equal(need.target - need.value, 6); // 10 - 4 trades still to go
});
test("paper block: window fallback has no qualify (not a lifetime record)", () => {
  const rows = [{ entry_price: 100, qty: 1, pnl: 5, opened_at: "2026-10-01T00:00:00Z", closed_at: "2026-10-02T00:00:00Z" }];
  const b = arenaPaperBlock({ paper_trades: rows });
  assert.equal(b.lifetime, false);
  assert.equal(b.qualify, null);
});

// OG card: only for an agent with a graded paper close; the SVG states the rule in words.
import { loadArenaCard } from "./routes-arena.mjs";
import { buildArenaAgentSvg } from "./ogCards.mjs";
const W = "0x" + "a1".repeat(20);
test("arena card: no record -> null (route 404s)", async () => {
  const env = { NEXUS_AGENT: fakeKV({ [`arena:profile:${W}`]: JSON.stringify({ name: "Ada" }) }) };
  assert.equal(await loadArenaCard(env, W), null);
});
test("arena card: graded agent gets a card with the qualify line and no stray colour", async () => {
  const state = { paper_resets: 0, paper_agg: { trades: 3, wins: 2, grossWin: 20, grossLoss: 5, net: 15, firstTradeAt: Date.now() - 2 * 86400000, lastTradeAt: Date.now() } };
  const env = { NEXUS_AGENT: fakeKV({ [`arena:profile:${W}`]: JSON.stringify({ name: "Ada", builder: "claude-fable-5" }), [`agent:state:${W}`]: JSON.stringify(state) }) };
  const card = await loadArenaCard(env, W);
  assert.equal(card.paper.trades, 3);
  const svg = buildArenaAgentSvg(card);
  assert.match(svg, /3 OF 10 TRADES TO QUALIFY/);
  assert.match(svg, />Ada</);
  assert.doesNotMatch(svg, /#00ff88/i);
});

// ── Operators: one board slot per operator, every wallet summed (losers included) ──
import { privateKeyToAccount } from "viem/accounts";
import { combinePaper, foldOperators } from "./routes-arena.mjs";
import { operatorJoinMessage } from "../../app/lib/arenaOperator.mjs";

const T = Date.parse("2026-10-01T00:00Z");
const lifetime = (trades, wins, net, days = 5) => ({
  paper_agg: { trades, wins, grossWin: Math.max(net, 0) + 10, grossLoss: Math.max(-net, 0) + 10, net, firstTradeAt: T, lastTradeAt: T + days * DAY },
});

test("combinePaper sums every wallet, losers included", () => {
  const b = combinePaper([lifetime(12, 9, 50), lifetime(20, 4, -80), lifetime(5, 1, -10)]);
  assert.equal(b.trades, 37);
  assert.equal(b.wins, 14);
  assert.equal(b.netPnl, -40, "the losing wallets drag the slot's net down");
  assert.equal(b.lifetime, true);
  assert.equal(b.qualify.eligible, false, "net-negative group does not qualify");
});

test("combinePaper: a group with a window-only wallet is labelled, no verdict", () => {
  const rows = [{ pnl: 3, closed_at: new Date(T).toISOString() }];
  const b = combinePaper([lifetime(12, 9, 50), { paper_trades: rows }]);
  assert.equal(b.lifetime, false);
  assert.equal(b.window, "last 50 trades per wallet");
  assert.equal(b.qualify, null);
  assert.equal(b.trades, 13);
});

test("combinePaper: resets add up across the group", () => {
  const b = combinePaper([{ ...lifetime(3, 2, 5), paper_resets: 1 }, { ...lifetime(3, 1, -5), paper_resets: 2 }]);
  assert.equal(b.resets, 3);
});

const row = (wallet, name, state) => ({
  state, liveRows: [],
  entry: { wallet, name, description: "", builder: "", createdAt: 0, active: true, mode: "PAPER", currentPosition: null, paper: arenaPaperBlock(state), live: null },
});

test("foldOperators: one slot per operator, members hidden, record summed", () => {
  const OP = "0x" + "0a".repeat(20), M1 = "0x" + "0b".repeat(20), M2 = "0x" + "0c".repeat(20), SOLO = "0x" + "0d".repeat(20);
  const groups = { [OP]: { wallets: [M1, M2], joined: {} } };
  const out = foldOperators([
    row(M1, "winner", lifetime(15, 12, 200)),
    row(OP, "Ops", lifetime(10, 5, 0)),
    row(SOLO, "Solo", lifetime(10, 6, 30)),
    row(M2, "loser", lifetime(15, 2, -300)),
  ], groups);
  assert.deepEqual(out.map((a) => a.wallet), [OP, SOLO], "members never get their own row");
  const slot = out[0];
  assert.equal(slot.name, "Ops");
  assert.equal(slot.operator.walletCount, 3);
  assert.equal(slot.paper.trades, 40);
  assert.equal(slot.paper.netPnl, -100, "the winner can't stand in for the group");
  assert.deepEqual(slot.operator.members.map((m) => m.name), ["Ops", "winner", "loser"]);
  assert.equal(out[1].operator, undefined, "an ungrouped wallet is untouched");
});

test("foldOperators: a member whose operator has no profile keeps its own row", () => {
  const OP = "0x" + "0a".repeat(20), M1 = "0x" + "0b".repeat(20);
  const out = foldOperators([row(M1, "m1", lifetime(3, 2, 5))], { [OP]: { wallets: [M1] } });
  assert.deepEqual(out.map((a) => a.wallet), [M1]);
});

// The join route with real signatures, through handleArena.
function memKV(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: async (k) => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); }, _m: m };
}
const opAcct = privateKeyToAccount("0x" + "11".repeat(32));
const mAcct = privateKeyToAccount("0x" + "22".repeat(32));
const otherAcct = privateKeyToAccount("0x" + "33".repeat(32));
const lc = (a) => a.address.toLowerCase();
const join = (env, body) => _handleArena(["arena", "operator", "join"], new Request("https://x.test/arena/operator/join", { method: "POST", body: JSON.stringify(body) }), env);
const sigs = async (op, w) => {
  const message = operatorJoinMessage(lc(op), lc(w));
  return { operator: lc(op), wallet: lc(w), operatorSig: await op.signMessage({ message }), walletSig: await w.signMessage({ message }) };
};
const registered = (...accts) => Object.fromEntries(accts.map((a) => [`arena:profile:${lc(a)}`, JSON.stringify({ name: "x" })]));

test("join: both signatures put the wallet in the operator's slot", async () => {
  const kv = memKV(registered(opAcct, mAcct));
  const res = await join({ NEXUS_AGENT: kv }, await sigs(opAcct, mAcct));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.wallets, [lc(opAcct), lc(mAcct)]);
  assert.equal(body.permanent, true);
  assert.deepEqual(JSON.parse(kv._m.get("arena:operators"))[lc(opAcct)].wallets, [lc(mAcct)]);
});

test("join: one signature is not enough (either side)", async () => {
  const kv = memKV(registered(opAcct, mAcct, otherAcct));
  const good = await sigs(opAcct, mAcct);
  const message = operatorJoinMessage(lc(opAcct), lc(mAcct));
  const forgedWallet = { ...good, walletSig: await otherAcct.signMessage({ message }) };
  const forgedOp = { ...good, operatorSig: await otherAcct.signMessage({ message }) };
  assert.equal((await join({ NEXUS_AGENT: kv }, forgedWallet)).status, 401, "an operator can't absorb a wallet it doesn't run");
  assert.equal((await join({ NEXUS_AGENT: kv }, forgedOp)).status, 401, "a wallet can't attach itself to someone's slot");
  assert.equal((await join({ NEXUS_AGENT: kv }, { ...good, walletSig: "0xzz" })).status, 401, "a malformed sig is a refusal, not a crash");
  assert.equal(kv._m.has("arena:operators"), false, "nothing written");
});

test("join: unregistered wallets are refused", async () => {
  const kv = memKV(registered(opAcct));
  assert.equal((await join({ NEXUS_AGENT: kv }, await sigs(opAcct, mAcct))).status, 404);
});

test("join: a grouped wallet can't move to another operator", async () => {
  const kv = memKV(registered(opAcct, mAcct, otherAcct));
  await join({ NEXUS_AGENT: kv }, await sigs(opAcct, mAcct));
  const res = await join({ NEXUS_AGENT: kv }, await sigs(otherAcct, mAcct));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error, "wallet_in_other_group");
});

test("board: a joined wallet shows inside its operator's row", async () => {
  const kv = memKV({
    ...registered(opAcct, mAcct),
    "arena:roster": JSON.stringify([lc(opAcct), lc(mAcct)]),
    [`agent:state:${lc(opAcct)}`]: JSON.stringify(lifetime(10, 6, 20)),
    [`agent:state:${lc(mAcct)}`]: JSON.stringify(lifetime(10, 2, -50)),
  });
  await join({ NEXUS_AGENT: kv }, await sigs(opAcct, mAcct));
  const res = await _handleArena(["arena", "agents"], new Request("https://x.test/arena/agents"), { NEXUS_AGENT: kv });
  const body = await res.json();
  assert.equal(body.count, 1);
  assert.equal(body.agents[0].wallet, lc(opAcct));
  assert.equal(body.agents[0].paper.netPnl, -30);
  assert.equal(body.agents[0].operator.walletCount, 2);
});

test("card: a grouped wallet's card names the operator slot", async () => {
  const kv = memKV({
    ...registered(opAcct, mAcct),
    [`agent:state:${lc(opAcct)}`]: JSON.stringify(lifetime(10, 2, -50)),
    [`agent:state:${lc(mAcct)}`]: JSON.stringify(lifetime(12, 10, 90)),
    "arena:operators": JSON.stringify({ [lc(opAcct)]: { wallets: [lc(mAcct)], joined: {} } }),
  });
  const card = await loadArenaCard({ NEXUS_AGENT: kv }, lc(mAcct));
  assert.equal(card.operator.walletCount, 2);
  assert.equal(card.operator.paper.netPnl, 40);
  const svg = buildArenaAgentSvg(card);
  assert.match(svg, /1 OF 2 WALLETS · OPERATOR SLOT: 22 TRADES · NET \+\$40\.00/);
});
