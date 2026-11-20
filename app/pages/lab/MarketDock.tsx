// THE COIN DOCK (wide Lab home, borst 2026-11-20: "Wire, table, and coin panel side by side so one coin stays on
// screen"). The market drawer's own body (MarketPanel) docked beside the table. While it is on screen, every coin tap
// in the terminal (a table row, a Wire coin, a board's coin link, ⌘K) fills it instead of opening the overlay
// (setMarketDock, app/lib/marketDrawerEvent.mjs). It opens on the first watched coin, else BTC. Inputs, not a verdict.
import { useEffect, useState } from "react";
import { C } from "@/config/theme";
import { MarketPanel } from "@/components/MarketDrawer";
import { setMarketDock } from "@/lib/marketDrawerEvent.mjs";
import { readWatch } from "@/lib/watchStore";

export function MarketDock({ top = 72 }: { top?: number }) {
  const [coin, setCoin] = useState<string>(() => readWatch().coins[0] || "BTC");
  useEffect(() => {
    setMarketDock((c: string) => setCoin(c));
    return () => setMarketDock(null);
  }, []);
  return (
    <MarketPanel key={coin} coin={coin} frame={{ position: "sticky", top, maxHeight: `calc(100vh - ${top + 16}px)`, border: `1px solid ${C.borderStrong}`, borderRadius: 10 }} />
  );
}

export default MarketDock;
