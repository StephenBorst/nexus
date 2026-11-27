// Quick Trade's money rules (quickTradeRules.mjs). Run: node --test app/lib/quickTradeRules.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { needsConfirm, maxNotionalFor, leverageChange, liqLine, placedResult } from "./quickTradeRules.mjs";

test("two taps for a big OR a high-leverage order (a 50x $90 order used to fire on one)", () => {
  assert.equal(needsConfirm({ notional: 90, lev: 5 }), false);
  assert.equal(needsConfirm({ notional: 90, lev: 50 }), true);
  assert.equal(needsConfirm({ notional: 150, lev: 2 }), true);
  assert.equal(needsConfirm({ notional: 100, lev: 9 }), false);
});

test("Max keeps 5% for fees and the move while it fills", () => {
  assert.equal(maxNotionalFor(1000, 5), 4750);
  assert.equal(maxNotionalFor(0, 5), 0);
  assert.equal(maxNotionalFor(null, 5), 0);
});

test("leverage: change unless THIS market is already at it; unknown current = set it", () => {
  assert.equal(leverageChange(5, 5), null);
  assert.equal(leverageChange(5, 20), 5);
  assert.equal(leverageChange(5, undefined), 5);
  assert.equal(leverageChange(0, 5), null);
});

test("liquidation: Orderly's estimate in words, the distance by side, none = said", () => {
  const l = liqLine({ estLiqPrice: 90, mark: 100, side: "BUY" });
  assert.equal(l.line, "Orderly estimates liquidation at $90, 10.0% from the mark, after this order. Cross margin: it moves with everything else you hold.");
  assert.equal(l.warn, false);
  assert.equal(liqLine({ estLiqPrice: 104, mark: 100, side: "SELL" }).warn, true, "within 5% is a warning");
  assert.match(liqLine({ estLiqPrice: null, mark: 100, side: "BUY" }).line, /no liquidation price/);
});

test("the result reads Orderly's success; 'sent', never 'filled'", () => {
  assert.deepEqual(placedResult({ success: true }, { side: "BUY", qty: 0.01, coin: "BTC" }),
    { ok: true, text: "Market long 0.01 BTC sent to Orderly. It shows under Open positions once it fills." });
  const r = placedResult({ success: false, message: "insufficient margin" }, { side: "SELL", qty: 1, coin: "ETH" });
  assert.equal(r.ok, false);
  assert.equal(r.text, "Orderly refused the ETH short: insufficient margin. Nothing was placed.");
});

test("the ticket sets THIS market's leverage, shows no home-made liquidation price, and keeps direction in ink", () => {
  const src = readFileSync(new URL("../pages/lab/QuickTrade.tsx", import.meta.url), "utf8");
  assert.match(src, /useSymbolLeverage\(symbol\)/);
  assert.match(src, /useLeverageBySymbol\(symbol, marginMode\)/);
  assert.match(src, /updateSymbolLeverage\(\{ leverage: change, symbol, margin_mode: marginMode \}\)/);
  assert.doesNotMatch(src, /\buseLeverage\(\)/, "the account-wide leverage is not the one an order fills at");
  assert.doesNotMatch(src, /liqDistPct|liqLong|liqShort/, "the isolated-margin guess is gone");
  assert.match(src, /estLiqPrice/);
  assert.match(src, /placedResult\(res/);
  assert.doesNotMatch(src, /isLong \? "#3ecf8e" : "#f7525f"/);
  assert.doesNotMatch(src, /background: tooSmall \? "#241012" : "#f7525f"/);
});
