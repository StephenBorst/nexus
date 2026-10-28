// ── Best price across our two EVM routers for a USDC buy (spanDEX vs Flash market) ──────────────
// Each router states what the user receives after its own fees: spanDEX's outAmount (our 10 bps is
// taken from the output by its router, so the quote is already net; network gas is paid separately
// by the wallet) and Flash's `to.amount` (net of Definitive's fee, ours AND gas, which Flash pays and
// prices in). So the comparison is each router's own "you receive" estimate, said that way.
// A gap under SAME_BPS reads as "about the same": estimates move between quote and fill.

export const SAME_BPS = 5;

/**
 * @param {{ spandexRaw: string | null, flashHuman: string | null, decimals: number | null }} a
 *   spandexRaw = spanDEX outAmount in base units; flashHuman = Flash to.amount in token units.
 * @returns {{ spandex: number | null, flash: number | null, best: "spandex" | "flash" | "same" | null, edgePct: number | null }}
 */
export function pickBest({ spandexRaw, flashHuman, decimals }) {
  let spandex = null;
  if (spandexRaw != null && /^\d+$/.test(String(spandexRaw)) && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36) {
    const n = Number(BigInt(spandexRaw)) / 10 ** decimals;
    spandex = Number.isFinite(n) && n > 0 ? n : null;
  }
  const f = Number(flashHuman);
  const flash = flashHuman != null && flashHuman !== "" && Number.isFinite(f) && f > 0 ? f : null;
  if (spandex == null || flash == null) return { spandex, flash, best: spandex != null ? "spandex" : flash != null ? "flash" : null, edgePct: null };
  const hi = Math.max(spandex, flash), lo = Math.min(spandex, flash);
  const edgeBps = (hi / lo - 1) * 10_000;
  if (edgeBps < SAME_BPS) return { spandex, flash, best: "same", edgePct: Math.round(edgeBps) / 100 };
  return { spandex, flash, best: spandex > flash ? "spandex" : "flash", edgePct: Math.round(edgeBps) / 100 };
}

/** The ticket's one line, or null when there's nothing to compare. */
export function bestLine(r, symbol) {
  if (!r || r.best == null || r.spandex == null || r.flash == null) return null;
  if (r.best === "same") return `About the same price on spanDEX and Flash (est.).`;
  const name = r.best === "flash" ? "Flash" : "spanDEX";
  return `Best price now: ${name} · ${r.edgePct.toFixed(2)}% more ${symbol} (est.)`;
}
