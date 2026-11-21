// ── Health and latency checks for core lab routes (speed monitoring, borst 2026-11-21) ───────────────
// Measures response duration across the 4 key surfaces: scoreboard (/intel/axis-backtest), the Wire (/intel/wire),
// the bell (/intel/bell), and the market table (/intel/table). Used by the daily digest to surface slow responses
// or Cloudflare CPU limit errors (1102 / 503) before visitors encounter degraded crons. Pure logic tested in tests.

export const LATENCY_TARGETS = Object.freeze([
  { path: "/intel/wire", label: "Wire" },
  { path: "/intel/bell", label: "Bell" },
  { path: "/intel/table", label: "Table" },
  { path: "/intel/axis-backtest", label: "Scoreboard" },
]);

export const LATENCY_WARN_MS = 1000;
export const LATENCY_ALERT_MS = 2500;

/**
 * Formats a single latency check into a concise indicator.
 * @param {{ label: string, ms: number | null, status: number | null, ok: boolean, error?: string }} check
 */
export function formatRouteLatency(check) {
  if (!check) return "unread";
  if (!check.ok || check.status === 1102 || (check.status && check.status >= 500)) {
    return `${check.label} ${check.status ? `${check.status}` : "error"}`;
  }
  if (!Number.isFinite(check.ms)) return `${check.label} unread`;
  const time = check.ms < 1000 ? `${Math.round(check.ms)}ms` : `${(check.ms / 1000).toFixed(1)}s`;
  return `${check.label} ${time}`;
}

/**
 * Produces the daily digest line for speed and latency.
 * @param {Array<{ label: string, path: string, ms: number | null, status: number | null, ok: boolean, error?: string }>} checks
 */
export function latencyLine(checks) {
  if (!Array.isArray(checks) || !checks.length) return "Latency unread right now.";
  const degraded = checks.filter((c) => !c.ok || (Number.isFinite(c.ms) && c.ms > LATENCY_ALERT_MS) || c.status === 1102);
  const parts = checks.map(formatRouteLatency);
  if (degraded.length) {
    const names = degraded.map((d) => d.label).join(", ");
    return `⚠️ ${parts.join(" · ")} (slow: ${names})`;
  }
  return `${parts.join(" · ")} (all healthy)`;
}
