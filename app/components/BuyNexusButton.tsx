/**
 * BuyNexusButton — "Buy $NEXUS" CTA.
 *
 * Primary buy = Nexus Spot (in-app). The token terminal opens on the $NEXUS pool with the venue
 * on Spot, where Fabric fills it (10 bps, exact approve) or falls back to an honest Uniswap
 * deep-link if Fabric misses the v4 pool. No bounce to an external tab / GeckoTerminal. ($NEXUS is
 * a Uniswap v4 pool DexScreener can't index, so the terminal resolves it from GeckoTerminal — see
 * nexusCuratedPair in pages/token/data.ts.)
 */
import { Link } from "react-router-dom";

const NEXUS_TOKEN = "0x3D958634ab725B627919EF8F2Ed59227309fDba3";
// In-app Spot page for $NEXUS (venue=spot is explicit; a non-perp is spot-only regardless).
const SPOT_URL = `/token/${NEXUS_TOKEN}?venue=spot`;

export function BuyNexusButton({ size = "md" }: { size?: "sm" | "md" }) {
  const pad = size === "sm" ? "5px 10px" : "8px 14px";
  const fontSize = size === "sm" ? 10 : 12;
  return (
    <Link
      to={SPOT_URL}
      title="Buy $NEXUS on Nexus Spot"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--nx-font-mono)",
        fontSize,
        fontWeight: "bold",
        letterSpacing: "0.06em",
        color: "#141416",
        background: "#ededf0",
        border: "1px solid #ededf0",
        borderRadius: 3,
        padding: pad,
        textDecoration: "none",
        whiteSpace: "nowrap",
        boxShadow: "0 0 12px rgba(237,237,240,0.25)",
      }}
    >
      BUY $NEXUS
    </Link>
  );
}
