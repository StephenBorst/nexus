// chartThin.mjs: big records thin to a drawable size without moving the shape.
// Run: node --test app/lib/chartThin.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { thinSeries, bucketBars, extent, BAR_MAX, LINE_MAX } from "./chartThin.mjs";

test("small data passes through untouched", () => {
  const p = [0, 1, -2, 3];
  assert.equal(thinSeries(p), p);
  const b = bucketBars([1, -1], ["a", "b"]);
  assert.deepEqual(b, { values: [1, -1], labels: ["a", "b"], size: 1 });
});

test("the equity line: ≤ LINE_MAX, exact ends, the low and the high survive", () => {
  const p = [0];
  for (let i = 1; i < 20000; i++) p.push(p[i - 1] + Math.sin(i / 37) * 3 + (i === 12345 ? -900 : 0));
  const t = thinSeries(p);
  assert.ok(t.length <= LINE_MAX, `${t.length}`);
  assert.equal(t[0], p[0]);
  assert.equal(t[t.length - 1], p[p.length - 1]);
  assert.equal(extent(t).lo, extent(p).lo, "the deepest drawdown point is kept");
  assert.equal(extent(t).hi, extent(p).hi, "the peak is kept");
});

test("bars: ≤ BAR_MAX, sums conserved, each bucket names its trade range", () => {
  const v = Array.from({ length: 16932 }, (_, i) => (i % 3 ? 1.5 : -2));
  const b = bucketBars(v, undefined);
  assert.ok(b.values.length <= BAR_MAX);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum(b.values) - sum(v)) < 1e-6);
  assert.equal(b.labels[0], `Trades 1–${b.size} · ${b.size} trades · ${b.values[0] >= 0 ? "+" : "-"}$${Math.abs(b.values[0]).toFixed(2)}`);
  assert.match(b.labels[b.labels.length - 1], /–16932 · /);
});

test("extent never spreads (the stack limit), and the charts use the thinned data", () => {
  const big = new Array(300000).fill(0).map((_, i) => i - 5);
  assert.deepEqual(extent(big), { lo: -5, hi: 299994 });
  const comp = readFileSync(new URL("../pages/lab/components.tsx", import.meta.url), "utf8");
  assert.match(comp, /thinSeries\(/, "PnlChart thins its points");
  assert.match(comp, /bucketBars\(/, "PnlBars buckets its bars");
  const av = readFileSync(new URL("../pages/lab/AnalyticsView.tsx", import.meta.url), "utf8");
  assert.match(av, /bucketBars\(/, "the per-trade legend says when a bar is several trades");
});
