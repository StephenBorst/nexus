// ── USD display formatting for stat tiles ────────────────────────────────────
// A 6-figure P&L ("+$148617.53") is 11+ glyphs of mono at 16px — wider than a stat
// tile's track — so it overflowed its grid cell and ran into the neighbouring value
// ("+$148617.5376.0%"). Tiles get the COMPACT form (never overflows, stays readable
// at phone width) and carry the exact number in a title attribute, so nothing is lost.
// Pure + dependency-free.

// Exact, grouped: "+$148,617.53" — for tooltips and anywhere with room.
export function fmtUsdExact(n) {
  if (n == null || n === "") return "—";   // Number(null) is 0 — don't print $0.00 for "no data"
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "+";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Compact, fixed-width-ish: "+$148.6k" / "+$1.49M" / "+$842.10".
// Threshold is 10k because below that the exact form is already short enough to fit.
export function fmtUsdCompact(n) {
  if (n == null || n === "") return "—";   // Number(null) is 0 — don't print $0.00 for "no data"
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  const sign = v < 0 ? "-" : "+";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${sign}$${(a / 1e3).toFixed(1)}k`;
  return `${sign}$${a.toFixed(2)}`;
}

// Unsigned compact (avg win / avg loss tiles, where the label carries the direction).
export function fmtUsdCompactAbs(n) {
  const s = fmtUsdCompact(Math.abs(Number(n) || 0));
  return s.startsWith("+") ? s.slice(1) : s;
}
