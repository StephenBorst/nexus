// openMarket(): the one way any tool opens the market drawer (app/lib/marketDrawerEvent.mjs).
// Run: node --test app/lib/marketDrawerEvent.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { openMarket, takePendingMarket, clearPendingMarket, MARKET_EVENT } from "./marketDrawerEvent.mjs";

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
  assert.match(push, /markets: false, wallets: false \}/);
  assert.match(push, /topics: \{ \.\.\.topics, coins: savedCoins\(\) \}/);
});
