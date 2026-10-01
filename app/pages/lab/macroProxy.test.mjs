import test from "node:test";
import assert from "node:assert/strict";
import { loadMacroProxySeries } from "./macroProxy.mjs";
import { fakeTvHistory } from "../../lib/__fixtures__/fakeTvHistory.mjs";

test("macro-proxy chart: a non-empty 30-day BTC series while Orderly answers 240 with no_data", async () => {
  const { get, calls } = fakeTvHistory({ price: (t) => 60000 + (t % 86400) / 10 });
  const nowSec = Date.UTC(2026, 9, 1, 13, 30) / 1000;
  const series = await loadMacroProxySeries({ getJson: get, nowSec });
  assert.ok(series.length >= 2, "the chart renders only with ≥2 points");
  assert.ok(calls.length === 2 && calls.every((u) => u.includes("resolution=60") && u.includes("PERP_BTC_USDC")));
  const spanDays = (series[series.length - 1].t - series[0].t) / 86400000;
  assert.ok(spanDays > 29.5, `covers the full 30 days (got ${spanDays.toFixed(2)})`);
  assert.ok(series.every((p) => p.c > 0 && Number.isFinite(p.t)));
});

test("macro-proxy chart: a failed read rejects (the card falls back to no chart)", async () => {
  const { get } = fakeTvHistory({ fail: () => true });
  await assert.rejects(loadMacroProxySeries({ getJson: get, nowSec: 2e9 }));
});
