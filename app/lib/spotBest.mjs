// ── Best price across our two EVM routers for a USDC buy (spanDEX vs Flash market) ──────────────
// Each router states what the user receives after its own fees: spanDEX's outAmount (our 10 bps is
// taken from the output by its router, so the quote is already net) and Flash's `to.amount` (net of
// Definitive's fee, ours AND gas, which Flash pays and prices in). With spanDEX the wallet pays the
// network gas on top, so when the worker could estimate that gas (in the bought token) it comes off
// spanDEX's number before the two are compared: both "after gas". Without an estimate the old
// comparison stands and the line says Flash's number alone includes gas.
// A gap under SAME_BPS reads as "about the same": estimates move between quote and fill.

export const SAME_BPS = 5;

/**
 * @param {{ spandexRaw: string | null, flashHuman: string | null, decimals: number | null, gasToken?: number | null }} a
 *   spandexRaw = spanDEX outAmount in base units; flashHuman = Flash to.amount in token units;
 *   gasToken = estimated network gas for the spanDEX swap, in the bought token's units (null = unknown).
 * @returns {{ spandex: number | null, flash: number | null, spandexAfterGas: number | null, gasIncluded: boolean,
 *             best: "spandex" | "flash" | "same" | null, edgePct: number | null }}
 */
export function pickBest({ spandexRaw, flashHuman, decimals, gasToken = null }) {
  let spandex = null;
  if (spandexRaw != null && /^\d+$/.test(String(spandexRaw)) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
    const n = Number(BigInt(spandexRaw)) / 10 ** decimals;
    spandex = Number.isFinite(n) && n > 0 ? n : null;
  }
  const f = Number(flashHuman);
  const flash = flashHuman != null && flashHuman !== "" && Number.isFinite(f) && f > 0 ? f : null;
  const g = Number(gasToken);
  const gasIncluded = spandex != null && gasToken != null && Number.isFinite(g) && g >= 0;
  const spandexAfterGas = gasIncluded ? spandex - g : null;
  const base = { spandex, flash, spandexAfterGas, gasIncluded };
  if (spandex == null || flash == null) return { ...base, best: spandex != null ? "spandex" : flash != null ? "flash" : null, edgePct: null };
  const sx = gasIncluded ? spandexAfterGas : spandex;
  if (sx <= 0) return { ...base, best: "flash", edgePct: null }; // gas eats the whole spanDEX output
  const hi = Math.max(sx, flash), lo = Math.min(sx, flash);
  const edgeBps = (hi / lo - 1) * 10_000;
  if (edgeBps < SAME_BPS) return { ...base, best: "same", edgePct: Math.round(edgeBps) / 100 };
  return { ...base, best: sx > flash ? "spandex" : "flash", edgePct: Math.round(edgeBps) / 100 };
}

/** The ticket's one line, or null when there's nothing to compare. */
export function bestLine(r, symbol) {
  if (!r || r.best == null || r.spandex == null || r.flash == null) return null;
  if (r.best === "same") return `About the same price on spanDEX and Flash (est.).`;
  const name = r.best === "flash" ? "Flash" : "spanDEX";
  if (r.edgePct == null) return `Best price now: ${name} (est.)`;
  return `Best price now: ${name} · ${r.edgePct.toFixed(2)}% more ${symbol} (est.)`;
}

/** The note after the line: what the comparison counts. */
export function bestGasNote(r) {
  if (!r) return "";
  if (!r.gasIncluded) return "Flash incl. gas";
  const usd = Number(r.gasUsd);
  return Number.isFinite(usd) && usd > 0
    ? `both after gas · spanDEX gas ≈ $${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`
    : "both after gas";
}
