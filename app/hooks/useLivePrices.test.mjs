// Unit tests for symbol price lookup in useLivePrices. Run: node --test app/hooks/useLivePrices.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { lookupPrice } from "./useLivePrices.ts";

const mockOrderlyPrices = {
  "PERP_BTC_USDC": 59120.5,
  "PERP_ETH_USDC": 1642.1,
  "PERP_SOL_USDC": 66.82,
  "PERP_ZEC_USDC": 725.0,
  "PERP_HYPE_USDC": 57.9,
  "CUSTOM_PAIR": 1.23,
};

test("lookupPrice matches full Orderly symbol directly", () => {
  assert.equal(lookupPrice("PERP_SOL_USDC", mockOrderlyPrices), 66.82);
  assert.equal(lookupPrice("PERP_BTC_USDC", mockOrderlyPrices), 59120.5);
  assert.equal(lookupPrice("CUSTOM_PAIR", mockOrderlyPrices), 1.23);
});

test("lookupPrice normalizes bare ticker (e.g. SOL) to PERP_‹SYMBOL›_USDC", () => {
  assert.equal(lookupPrice("SOL", mockOrderlyPrices), 66.82);
  assert.equal(lookupPrice("sol", mockOrderlyPrices), 66.82);
  assert.equal(lookupPrice("BTC", mockOrderlyPrices), 59120.5);
  assert.equal(lookupPrice("btc", mockOrderlyPrices), 59120.5);
  assert.equal(lookupPrice("ETH", mockOrderlyPrices), 1642.1);
  assert.equal(lookupPrice("HYPE", mockOrderlyPrices), 57.9);
});

test("lookupPrice handles whitespace and trims", () => {
  assert.equal(lookupPrice(" SOL ", mockOrderlyPrices), 66.82);
  assert.equal(lookupPrice("  btc  ", mockOrderlyPrices), 59120.5);
});

test("lookupPrice returns null for unknown symbols or missing input", () => {
  assert.equal(lookupPrice("UNKNOWN", mockOrderlyPrices), null);
  assert.equal(lookupPrice("", mockOrderlyPrices), null);
  assert.equal(lookupPrice(null, mockOrderlyPrices), null);
  assert.equal(lookupPrice(undefined, mockOrderlyPrices), null);
});
