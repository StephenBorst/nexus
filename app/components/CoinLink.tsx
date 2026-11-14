// A coin name that opens the market drawer (app/components/MarketDrawer.tsx) on tap. It inherits the surrounding
// type, so a mono table cell stays mono; the dotted underline is the only tell. Stops the tap from also triggering a
// row's own action.
import { openMarket } from "@/lib/marketDrawerEvent.mjs";

export function CoinLink({ coin, children, title }: { coin: string; children?: React.ReactNode; title?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); openMarket(coin); }}
      title={title ?? `Everything on ${coin}`}
      style={{ font: "inherit", color: "inherit", fontWeight: "inherit", letterSpacing: "inherit", background: "none", border: "none", padding: 0, margin: 0, cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3, textDecorationColor: "rgba(237,237,240,0.35)" }}
    >{children ?? coin}</button>
  );
}

export default CoinLink;
