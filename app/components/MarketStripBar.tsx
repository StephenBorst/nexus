// The read on the market you're trading, one line under the LAB strip on the trade page (2026-11-14, borst:
// "trade page reads"). Funding, smart money and the tape for the coin on screen, from the drawer's own answer
// (GET /intel/market/:coin, 60 s server cache), rules app/lib/marketStrip.mjs. "Read ETH →" opens the drawer, where
// every lens carries its grade; ☆ watches the coin. Inputs only. No wallet, no key, no money.
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { marketCoin } from "@/lib/marketRead.mjs";
import { marketStrip, STRIP_TITLE } from "@/lib/marketStrip.mjs";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import { readWatch, toggleWatchCoin } from "@/lib/watchStore";
import { WATCH_EVENT } from "@/lib/watchlist.mjs";

const AGENT_API = "https://og.nexustradinglabs.com";
const REFRESH_MS = 2 * 60_000;
type Seg = { label: string; text: string; tone: string };

export default function MarketStripBar() {
  const { symbol } = useParams();
  const coin = marketCoin(symbol ?? "");
  const isMobile = useIsMobile();
  const [segs, setSegs] = useState<Seg[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [watched, setWatched] = useState(() => readWatch().coins.includes(coin));

  useEffect(() => {
    const on = () => setWatched(readWatch().coins.includes(coin));
    on();
    window.addEventListener(WATCH_EVENT, on);
    return () => window.removeEventListener(WATCH_EVENT, on);
  }, [coin]);

  useEffect(() => {
    setSegs([]); setLoaded(false);
    if (!coin) return;
    let alive = true;
    const load = async () => {
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const r = await fetch(`${AGENT_API}/intel/market/${encodeURIComponent(coin)}`);
        const j = r.ok ? await r.json() : null;
        if (alive && j) { setSegs(marketStrip(j) as Seg[]); setLoaded(true); }
      } catch { if (alive) setLoaded(true); /* keep the last read */ }
    };
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, [coin]);

  if (!coin) return null;
  const shown = segs;
  return (
    <div title={STRIP_TITLE} style={{ display: "flex", alignItems: "center", gap: 10, height: isMobile ? 30 : 30, padding: isMobile ? "0 12px" : "0 16px", background: C.canvas, borderBottom: `1px solid ${C.border}`, fontFamily: UI, fontSize: 12, color: C.text.fog, whiteSpace: "nowrap", overflow: "hidden" }}>
      <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", color: C.text.bright, flexShrink: 0 }}>{coin}</span>
      {/* On a phone the facts scroll sideways whole (2026-11-17: two of them were cut to "longs pay 4.2…" and "7 sho…"). */}
      <span className={isMobile ? "nx-noscrollbar" : undefined} style={{ display: "flex", alignItems: "baseline", gap: isMobile ? 14 : 10, minWidth: 0, flex: 1, overflowX: isMobile ? "auto" : "hidden", overflowY: "hidden", scrollbarWidth: "none" }}>
        {shown.length ? shown.map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "baseline", gap: 5, minWidth: isMobile ? "max-content" : 0, flexShrink: isMobile ? 0 : 1, overflow: "hidden", textOverflow: "ellipsis" }}>
            <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.1em", color: C.text.muted, textTransform: "uppercase", flexShrink: 0 }}>{isMobile && s.label === "Smart money" ? "Smart" : s.label}</span>
            <span style={{ color: s.tone === "watch" ? SIGNAL.watch : C.text.fog, overflow: "hidden", textOverflow: "ellipsis" }}>{s.text}</span>
          </span>
        )) : <span style={{ color: C.text.muted }}>{loaded ? "Funding, smart money, forecasts and calls on this market: open the read." : `Reading ${coin}…`}</span>}
      </span>
      <button type="button" onClick={() => toggleWatchCoin(coin)} aria-pressed={watched} title={watched ? `Stop watching ${coin}` : `Watch ${coin} on Lab home`}
        style={{ flexShrink: 0, fontFamily: UI, fontSize: 12, fontWeight: 600, background: "none", border: "none", padding: "4px 2px", cursor: "pointer", color: watched ? C.text.bright : C.text.muted }}>
        {watched ? "★" : "☆"}
      </button>
      <button type="button" onClick={() => openMarket(coin)}
        style={{ flexShrink: 0, fontFamily: UI, fontSize: 12, fontWeight: 600, background: "none", border: "none", padding: "4px 0", cursor: "pointer", color: C.text.bright }}>
        {isMobile ? "Read →" : `Read ${coin} →`}
      </button>
    </div>
  );
}
