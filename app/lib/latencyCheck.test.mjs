// Run: node --test app/lib/latencyCheck.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { formatRouteLatency, latencyLine, LATENCY_TARGETS } from "./latencyCheck.mjs";

test("targets list has core 4 surfaces", () => {
  const paths = LATENCY_TARGETS.map((t) => t.path);
  assert.ok(paths.includes("/intel/wire"));
  assert.ok(paths.includes("/intel/bell"));
  assert.ok(paths.includes("/intel/table"));
  assert.ok(paths.includes("/intel/axis-backtest"));
});

test("formatRouteLatency formats healthy ms cleanly", () => {
  assert.equal(formatRouteLatency({ label: "Wire", ms: 170, status: 200, ok: true }), "Wire 170ms");
  assert.equal(formatRouteLatency({ label: "Scoreboard", ms: 1250, status: 200, ok: true }), "Scoreboard 1.3s");
});

test("formatRouteLatency flags 1102, 500+ and network errors", () => {
  assert.equal(formatRouteLatency({ label: "Scoreboard", ms: 30000, status: 1102, ok: false }), "Scoreboard 1102");
  assert.equal(formatRouteLatency({ label: "Bell", ms: 1500, status: 503, ok: false }), "Bell 503");
  assert.equal(formatRouteLatency({ label: "Table", ms: null, status: null, ok: false, error: "timeout" }), "Table error");
  assert.equal(formatRouteLatency(null), "unread");
});

test("latencyLine summarizes all healthy", () => {
  const checks = [
    { label: "Wire", ms: 170, status: 200, ok: true },
    { label: "Bell", ms: 300, status: 200, ok: true },
    { label: "Table", ms: 130, status: 200, ok: true },
    { label: "Scoreboard", ms: 500, status: 200, ok: true },
  ];
  assert.equal(latencyLine(checks), "Wire 170ms · Bell 300ms · Table 130ms · Scoreboard 500ms (all healthy)");
});

test("latencyLine warns on slow or failing routes", () => {
  const checks = [
    { label: "Wire", ms: 2800, status: 200, ok: true },
    { label: "Bell", ms: 300, status: 200, ok: true },
    { label: "Table", ms: 130, status: 200, ok: true },
    { label: "Scoreboard", ms: 37000, status: 1102, ok: false },
  ];
  const line = latencyLine(checks);
  assert.ok(line.startsWith("⚠️ "));
  assert.ok(line.includes("slow: Wire, Scoreboard"));
});

test("latencyLine handles empty or missing data", () => {
  assert.equal(latencyLine([]), "Latency unread right now.");
  assert.equal(latencyLine(null), "Latency unread right now.");
});
