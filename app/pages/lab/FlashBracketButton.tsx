// ── Thesis → Spot express (Flash exec lives on the Spot terminal now, not the thesis) ─────
// Two honest touches on a thesis card:
//   1. On a SHORT fade, one line — a Flash spot BUY would be wrong-way, so a short expresses
//      on the Orderly perp book. (We never mount a buy-to-short button.)
//   2. "Express on Spot →" opens /token/{SYM}?venue=spot with the side prefilled — LONG→Buy,
//      SHORT→Sell — where the Spot terminal offers Fabric / Flash / the Uniswap deep-link.
// (Kept the export name for the existing thesis-card mount; it is no longer a bracket button.)
import { useNavigate } from "react-router-dom";

const bareOf = (s: string) => s.replace(/^PERP_/, "").replace(/_USDC$/, "").toUpperCase();

export function FlashBracketButton({ symbol, direction }: { symbol: string; direction: "LONG" | "SHORT" }) {
  const navigate = useNavigate();
  const sym = bareOf(symbol);
  const spotSide = direction === "LONG" ? "buy" : "sell"; // never buy-to-short
  const href = `/token/${encodeURIComponent(sym)}?venue=spot&side=${spotSide}`;
  const express = (
    <a href={href} onClick={(e) => { e.preventDefault(); navigate(href); }}
      title={`Open ${sym} on the Spot terminal with ${spotSide === "buy" ? "Buy" : "Sell"} prefilled (Fabric / Flash / Uniswap).`}
      style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.04em", color: "#3ecf8e", textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 36, padding: "6px 6px", whiteSpace: "nowrap" }}>
      Express on Spot →
    </a>
  );
  if (direction !== "LONG") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: "var(--nx-font-ui)", fontSize: 9.5, color: "#52525b", display: "inline-flex", alignItems: "center", minHeight: 36, padding: "6px 4px", whiteSpace: "nowrap", lineHeight: 1.3 }}>
          Flash is spot-long — this fade is SHORT → Orderly
        </span>
        {express}
      </span>
    );
  }
  return express;
}
