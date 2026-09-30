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
import { C } from "@/config/theme";

const NEXUS_TOKEN = "0x3D958634ab725B627919EF8F2Ed59227309fDba3";
// In-app Spot page for $NEXUS (venue=spot is explicit; a non-perp is spot-only regardless).
const SPOT_URL = `/token/${NEXUS_TOKEN}?venue=spot`;

export function BuyNexusButton({ size = "md" }: { size?: "sm" | "md" }) {
  // A bone button like every other primary action (docs/brand.md): UI face, sentence case, pill.
  const pad = size === "sm" ? "6px 13px" : "9px 16px";
  const fontSize = size === "sm" ? 12.5 : 13.5;
  return (
    <Link
      to={SPOT_URL}
      title="Buy $NEXUS on Nexus Spot"
      className="nx-press"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "var(--nx-font-ui)",
        fontSize,
        fontWeight: 600,
        color: C.canvas,
        background: C.accent,
        border: `1px solid ${C.accent}`,
        borderRadius: 15,
        padding: pad,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
    >
      Buy $NEXUS
    </Link>
  );
}
