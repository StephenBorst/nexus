// ── Stretched-funding scan — shared by the Smart Money scanner and the copilot get_conviction tool ──
// Pure: the funding-fade board (mispriced markets) with the other inputs beside each market (smart money's lean, the
// graded callers' lean, the market's own reversion history). 2026-11-15 (house rule: inputs, never a tally or crown):
// rows are ordered by how stretched funding is, NOT by how many inputs agree; there is no conviction label. `extra` /
// `against` stay as plain counts for the copilot to describe. The plain fade's own grade comes from the scoreboard.

const bare = (s) => String(s || "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

// The economic floor for a FADE (Grok) — a stretch on a trivial funding band (−0.66%/yr) is
// not a crowded position worth fading, so it never earns a fade badge OR a scanner rank. ONE
// literal, the file of truth: briefing.ts re-exports THIS, and the ticket + Board import it
// from there. Below the floor a market isn't a fade candidate at all.
export const FADE_FUNDING_FLOOR_PCT_YR = 10;

export function rankConviction(markets, smMap = {}, callerMap = {}, limit = 8) {
  const rows = (markets || [])
    .filter((m) => m && (m.direction === "LONG" || m.direction === "SHORT") && Math.abs(Number(m.fundingAnnualPct) || 0) >= FADE_FUNDING_FLOOR_PCT_YR)
    .map((m) => {
      const coin = bare(m.coin);
      const dir = m.direction;
      const reads = [{ label: "funding", ok: true }];
      const s = smMap[coin];
      // Each read's OWN side, so a surface says which way it leans instead of a ✓/✗.
      if (s && (s.side === "LONG" || s.side === "SHORT")) reads.push({ label: "smart", ok: s.side === dir, side: s.side });
      const c = callerMap[coin];
      if (c && (c.side === "LONG" || c.side === "SHORT")) reads.push({ label: "callers", ok: c.side === dir, side: c.side });
      const extra = reads.filter((r) => r.label !== "funding" && r.ok).length;
      const against = reads.filter((r) => !r.ok).length;
      // This market's own reversion history (edgeQuality, the one clock the ticket/card cite): a fact, not a grade.
      const eq = m.edgeQuality;
      const revertedPct = eq && Number.isFinite(eq.revertedPct) ? eq.revertedPct : null;
      const samples = eq && Number.isFinite(eq.samples) ? eq.samples : null;
      const histTier = eq && eq.tier ? eq.tier : "UNPROVEN";
      const histWeak = !!eq && (eq.tier === "TRAP" || (revertedPct != null && revertedPct <= 42));
      return { coin, direction: dir, fundingAnnualPct: Number(m.fundingAnnualPct) || 0, extra, against, reads, revertedPct, samples, histTier, histWeak };
    });
  rows.sort((a, b) => Math.abs(b.fundingAnnualPct) - Math.abs(a.fundingAnnualPct));
  return rows.slice(0, limit);
}

/** "Smart money short" / "Graded callers long": an input's lean in words. */
export function leanWord(read) {
  const who = read.label === "smart" ? "Smart money" : read.label === "callers" ? "Graded callers" : read.label;
  return `${who} ${String(read.side || "").toLowerCase()}`;
}
