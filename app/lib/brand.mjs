// ── The brand, as data — every surface that can't import theme.ts reads it from here ──
// Share cards and link-preview images are drawn by the lab-api worker (SVG → PNG), which
// can't import the app's theme.ts. They used to type their own colours, and three drifted
// back to the retired neon-green palette. This file is their one source; brand.test.mjs
// pins every value to app/config/theme.ts and fails any card that paints a colour not in it.
//
// THE RULE (docs/brand.md has the long form):
//   • surfaces black, type bone — the landing's canvas + greys, nothing tinted;
//   • bone is the ACCENT MARK (the top rule on every card, a section marker, an active tab),
//     never a button, never body text; buttons stay bone;
//   • green/red mean money and price only: P&L, a WIN/LOSS result, a price move, the Buy/Sell
//     sides. A LONG label, a take-profit level, a count, a live dot: monochrome.
export const BRAND = Object.freeze({
  canvas: "#0a0a0b",
  surface: "#141416",
  panel: "#0f0f11",
  border: "#232327",
  borderStrong: "#33333a",
  bright: "#f4f4f5", // headline type (bone)
  bone: "#ededf0",   // accent-white: badges, outlines, CTAs
  fog: "#a1a1aa",
  muted: "#71717a",
  faint: "#52525b",
  brand: "#ededf0",  // the accent mark (theme.ts C.brand = bone, the landing's --brand)
  win: "#3ecf8e",    // money won / price up / Buy — nothing else
  loss: "#f7525f",   // money lost / price down / Sell — nothing else
});

// Colour for a signed money figure: green above zero, red below, bone at zero or unknown.
export function moneyColor(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return BRAND.bright;
  return v > 0 ? BRAND.win : BRAND.loss;
}

// The accent mark every share card carries: a 3px bone rule across the top edge.
export function cardTopRule(width = 1200) {
  return `<rect width="${width}" height="3" fill="${BRAND.brand}"/>`;
}
