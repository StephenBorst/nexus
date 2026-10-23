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
