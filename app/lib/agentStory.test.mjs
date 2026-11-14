// app/lib/agentStory.mjs. Run: node --test app/lib/agentStory.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agentStory } from "./agentStory.mjs";

const NOW = Date.UTC(2026, 10, 14, 22);
const H = 3600e3;
const cfg = { mode: "PAPER", symbols: ["PERP_ETH_USDC", "PERP_BTC_USDC"], maxTradesPerDay: 4, maxDailyLossUsdc: 5 };
const text = (s, k) => s.lines.find((l) => l.k === k)?.text;

test("off: says so, still names what it would watch", () => {
  const s = agentStory({ config: cfg, state: null, now: NOW });
  assert.equal(s.status, "OFF");
  assert.equal(text(s, "status"), "Off. Nothing runs until you activate it.");
  assert.equal(text(s, "watching"), "Watching ETH, BTC.");
  assert.equal(text(s, "now"), undefined);
});

test("holding: the position in one line", () => {
  const s = agentStory({ config: cfg, now: NOW, state: { active: true, trades_today: 1, daily_pnl: 0.4,
    current_position: { symbol: "PERP_ETH_USDC", direction: "SHORT", entry_price: 1854.22, pnl_percent: 0.8, opened_at: NOW - 2 * H, paper: true } } });
  assert.equal(text(s, "status"), "Running on paper: simulated fills, no money moves.");
  assert.equal(text(s, "now"), "Holding a paper short on ETH since 2h ago, entered at $1,854.22 (+0.80% so far).");
  assert.equal(text(s, "today"), "1 of 4 trades today · day's P&L +$0.40 against a −$5 stop.");
});

test("flat: the brain's last check, and stale when the brain stopped checking", () => {
  const sig = (age) => ({ direction: "NONE", reason: "no signal · 11 of 11 markets: no extreme 4h move on falling OI this hour", timestamp: NOW - age });
  const fresh = agentStory({ config: cfg, now: NOW, state: { active: true, trades_today: 0, daily_pnl: 0, current_position: null, last_signal: sig(3 * 60e3) } });
  assert.equal(text(fresh, "now"), "Flat. No signal · 11 of 11 markets: no extreme 4h move on falling OI this hour (checked 3 min ago).");
  const stale = agentStory({ config: cfg, now: NOW, state: { active: true, trades_today: 0, daily_pnl: 0, current_position: null, last_signal: sig(47 * 60e3) } });
  assert.match(text(stale, "now"), /the brain may be down/);
  assert.equal(stale.lines.find((l) => l.k === "now").tone, "watch");
});

test("last action in plain words; caps say when they stop entries", () => {
  const s = agentStory({ config: cfg, now: NOW, state: { active: true, trades_today: 4, daily_pnl: -1.2, current_position: null, last_signal: null,
    paper_trades: [
      { symbol: "PERP_BTC_USDC", direction: "LONG", pnl: -1.02, reason: "SL", closed_at: new Date(NOW - 6 * H).toISOString() },
      { symbol: "PERP_ETH_USDC", direction: "SHORT", pnl: 2, reason: "TP", closed_at: new Date(NOW - 30 * H).toISOString() },
    ] } });
  assert.equal(text(s, "last"), "Last: closed a paper long on BTC 6h ago at its stop, −$1.02.");
  assert.equal(text(s, "today"), "4 of 4 trades today · day's P&L −$1.20 against a −$5 stop. Capped: no new entries until the day resets.");
});

test("live mode reads the live history; no markets = it evaluates nothing", () => {
  const s = agentStory({ config: { ...cfg, mode: "AUTONOMOUS", symbols: [] }, now: NOW,
    state: { active: true, trades_today: 0, daily_pnl: 0, current_position: null, last_signal: null, paper_trades: [{ symbol: "X", direction: "LONG", pnl: 9, reason: "TP", closed_at: new Date(NOW).toISOString() }] },
    trades: [{ symbol: "PERP_SOL_USDC", direction: "SHORT", pnl: 3.5, reason: "TRAIL", closed_at: new Date(NOW - H).toISOString() }] });
  assert.match(text(s, "status"), /^Live: it places real orders/);
  assert.equal(text(s, "watching"), "No markets picked: it evaluates nothing until you add one.");
  assert.equal(text(s, "last"), "Last: closed a short on SOL 1h ago at its trailing stop, +$3.50.");
});

test("the Agent tab leads with it", () => {
  const src = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.match(src, /agentStory\(/);
  assert.match(src, /WHAT YOUR AGENT IS DOING/);
});
