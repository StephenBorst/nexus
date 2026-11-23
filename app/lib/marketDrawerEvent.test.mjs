// openMarket(): the one way any tool opens the market drawer (app/lib/marketDrawerEvent.mjs).
// Run: node --test app/lib/marketDrawerEvent.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openMarket, takePendingMarket, clearPendingMarket, setMarketDock, MARKET_EVENT } from "./marketDrawerEvent.mjs";

const fakeWindow = () => {
  const t = new EventTarget();
  return { addEventListener: t.addEventListener.bind(t), removeEventListener: t.removeEventListener.bind(t), dispatchEvent: t.dispatchEvent.bind(t), CustomEvent };
};

test("fires one event with the clean coin and parks it for a drawer that mounts later", () => {
  const w = fakeWindow();
  const got = [];
  w.addEventListener(MARKET_EVENT, (e) => got.push(e.detail.coin));
  assert.equal(openMarket("PERP_eth_USDC", w), "ETH");
  assert.deepEqual(got, ["ETH"]);
  assert.equal(takePendingMarket(w), "ETH");
  assert.equal(takePendingMarket(w), "", "taken once");
  openMarket("btc", w); clearPendingMarket(w);
  assert.equal(takePendingMarket(w), "");
});

test("junk never opens the drawer", () => {
  const w = fakeWindow();
  let fired = 0;
  w.addEventListener(MARKET_EVENT, () => fired++);
  assert.equal(openMarket("<script>", w), "");
  assert.equal(openMarket("", w), "");
  assert.equal(fired, 0);
});

test("the drawer is mounted app-wide and coin names open it from the Board, Smart Money and Forecasts", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  assert.match(read("../App.tsx"), /<MarketDrawer \/>/);
  for (const f of ["DecisionBoard.tsx", "SmartMoneyView.tsx", "ForecastDivergence.tsx"]) {
    assert.match(read(`../pages/lab/${f}`), /<CoinLink coin=/, f);
  }
  const drawer = read("../components/MarketDrawer.tsx");
  assert.match(drawer, /\/intel\/market\//);
  assert.match(drawer, /MARKET_READ_FOOTER/);
  assert.match(drawer, /useEscapeKey\(close/);
});

test("the drawer opens from an alert link (?market=), on load and on an in-app tap, and offers the coin alert", () => {
  const drawer = readFileSync(new URL("../components/MarketDrawer.tsx", import.meta.url), "utf8");
  assert.match(drawer, /new URLSearchParams\(window\.location\.search\)\.get\("market"\)/);
  assert.match(drawer, /addEventListener\("popstate", onNav\)/);
  assert.match(drawer, /watchCoin\(wallet, labWallet, coin, !watched\)/);
  const push = readFileSync(new URL("./pushAlerts.ts", import.meta.url), "utf8");
  assert.match(push, /markets: false, wallets: false, prices: true \}/); // price alerts YOU set: on by default (2026-11-23)
  assert.match(push, /topics: \{ \.\.\.topics, coins: savedCoins\(\) \}/);
});

test("a docked panel (wide Lab home) takes the tap: no overlay event, nothing parked; unset = the drawer again", () => {
  const w = fakeWindow();
  const events = [], docked = [];
  w.addEventListener(MARKET_EVENT, (e) => events.push(e.detail.coin));
  setMarketDock((c) => docked.push(c), w);
  assert.equal(openMarket("sol", w), "SOL");
  assert.deepEqual(docked, ["SOL"]);
  assert.deepEqual(events, []);
  assert.equal(takePendingMarket(w), "", "a docked tap never reopens the drawer later");
  assert.equal(openMarket("??", w), "", "a refused coin reaches neither");
  setMarketDock(null, w);
  openMarket("ETH", w);
  assert.deepEqual(events, ["ETH"]);
  assert.deepEqual(docked, ["SOL"]);
});
