// The market drawer: every lens on one coin, in one panel, opened from anywhere with openMarket("ETH")
// (app/lib/marketDrawerEvent.mjs). One request to GET /intel/market/:coin (lab-api routes-market.mjs composes the
// boards server-side). Phone: a bottom sheet. Desktop: a right-hand panel. Inputs, not a verdict (house rule).
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { C, MONO, UI, RADIUS, SIGNAL } from "@/config/theme";
import { useEscapeKey } from "@/utils/a11y";
import { THESIS_DRAFT_KEY } from "@/config/assistantTools";
import { MARKET_EVENT, takePendingMarket, clearPendingMarket } from "@/lib/marketDrawerEvent.mjs";
import { MARKET_READ_FOOTER, marketCoin } from "@/lib/marketRead.mjs";
import { useAccount } from "@orderly.network/hooks";
import { useLabWallet } from "@/hooks/useLabAuth";
import { savedCoins, watchCoin, pushSupported } from "@/lib/pushAlerts";

const AGENT_API = "https://og.nexustradinglabs.com";
type Lens = { id: string; label: string; line: string; detail?: string; graded?: string; tone: "plain" | "faint" | "watch" };
type Market = { coin: string; price: number | null; change24hPct: number | null; lenses: Lens[]; unread?: string[] };

function useNarrow() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 768);
  useEffect(() => {
    const on = () => setNarrow(window.innerWidth < 768);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return narrow;
}

const fmtPrice = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 6 })}`;

export default function MarketDrawer() {
  const narrow = useNarrow();
  const navigate = useNavigate();
  const [coin, setCoin] = useState<string>("");
  const [data, setData] = useState<Market | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const { state: acct } = useAccount();
  const wallet = (acct as { address?: string })?.address ?? null;
  const labWallet = useLabWallet();
  const [watching, setWatching] = useState<string[]>(() => savedCoins());
  const [alertNote, setAlertNote] = useState("");
  const [alertBusy, setAlertBusy] = useState(false);

  const close = useCallback(() => { setCoin(""); setData(null); }, []);
  useEscapeKey(close, !!coin);

  useEffect(() => {
    const fromLink = marketCoin(new URLSearchParams(window.location.search).get("market"));
    const pending = takePendingMarket() || fromLink;
    if (pending) setCoin(pending);
    const on = (e: Event) => {
      const c = (e as CustomEvent).detail?.coin;
      clearPendingMarket();
      if (typeof c === "string" && c) setCoin(c);
    };
    window.addEventListener(MARKET_EVENT, on);
    // An alert tapped while the app is open arrives as an in-page navigation (pushTaps.ts) to ?market=ETH.
    const onNav = () => { const c = marketCoin(new URLSearchParams(window.location.search).get("market")); if (c) setCoin(c); };
    window.addEventListener("popstate", onNav);
    return () => { window.removeEventListener(MARKET_EVENT, on); window.removeEventListener("popstate", onNav); };
  }, []);

  useEffect(() => {
    if (!coin) return;
    let alive = true;
    setState("loading"); setData(null); setAlertNote("");
    fetch(`${AGENT_API}/intel/market/${encodeURIComponent(coin)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: Market) => { if (alive) { setData(d); setState("idle"); } })
      .catch(() => { if (alive) setState("error"); });
    return () => { alive = false; };
  }, [coin]);

  if (!coin) return null;

  const draftCall = () => {
    try { localStorage.setItem(THESIS_DRAFT_KEY, JSON.stringify({ symbol: coin, entryPrice: data?.price ?? undefined, notes: `From the ${coin} market drawer.` })); } catch { /* private mode */ }
    close(); navigate("/lab?tab=thesis");
  };
  const ask = () => {
    window.dispatchEvent(new CustomEvent("nexus:assistant-ask", { detail: { prompt: `Read ${coin} for me: funding, smart money, forecasts, catalysts and open calls. What would change your mind, and what's the cleanest way to put it as a graded call?` } }));
    close();
  };
  const ch = data?.change24hPct;
  const watched = watching.includes(coin);
  const toggleAlert = async () => {
    if (!wallet) { setAlertNote("Connect a wallet to get alerts on this coin."); return; }
    setAlertBusy(true); setAlertNote("");
    const r = await watchCoin(wallet, labWallet, coin, !watched);
    setAlertBusy(false);
    if (r.ok) { setWatching(savedCoins()); setAlertNote(watched ? `No more alerts on ${coin}.` : `You’ll get a ping when ${coin}’s funding breaks its range, consensus forms or flips, or a forecast swings 15+ pts.`); }
    else setAlertNote(r.error);
  };

  const panel: React.CSSProperties = narrow
    ? { position: "fixed", left: 0, right: 0, bottom: 0, maxHeight: "86dvh", borderTopLeftRadius: 14, borderTopRightRadius: 14, borderTop: `1px solid ${C.borderStrong}` }
    : { position: "fixed", top: 0, right: 0, bottom: 0, width: 440, borderLeft: `1px solid ${C.borderStrong}` };
  const btn: React.CSSProperties = { flex: 1, fontFamily: UI, fontSize: 13.5, fontWeight: 600, padding: "11px 10px", borderRadius: RADIUS.md, cursor: "pointer", border: `1px solid ${C.borderStrong}`, background: "transparent", color: C.text.bright };

  return (
    <>
      <div role="presentation" onClick={close} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 99998 }} />
      <section role="dialog" aria-modal="true" aria-label={`${coin} market`} className="nx-fade-in"
        style={{ ...panel, zIndex: 99998, background: C.surface, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "16px 18px 12px", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontFamily: UI, fontSize: 22, fontWeight: 700, color: C.text.bright }}>{coin}</span>
          {data?.price != null && <span style={{ fontFamily: MONO, fontSize: 14, color: C.text.fog }}>{fmtPrice(data.price)}</span>}
          {ch != null && <span style={{ fontFamily: MONO, fontSize: 13, color: ch >= 0 ? C.pos : C.neg }}>{ch >= 0 ? "+" : "−"}{Math.abs(ch).toFixed(2)}%</span>}
          <button type="button" onClick={close} aria-label="Close" style={{ marginLeft: "auto", background: "none", border: "none", color: C.text.muted, fontSize: 22, cursor: "pointer", lineHeight: 1 }}>×</button>
        </div>
        <div style={{ overflowY: "auto", padding: "6px 18px 10px", flex: 1 }}>
          {state === "loading" && <div style={{ fontFamily: MONO, fontSize: 12, color: C.text.muted, padding: "18px 0" }}>Reading every board on {coin}…</div>}
          {state === "error" && <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, padding: "18px 0" }}>Couldn’t read {coin} right now. Try again in a moment.</div>}
          {data?.lenses.map((l) => (
            <div key={l.id} style={{ padding: "12px 0", borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text.muted, marginBottom: 4 }}>{l.label}</div>
              <div style={{ fontFamily: UI, fontSize: 14, lineHeight: 1.5, color: l.tone === "faint" ? C.text.muted : C.text.bright }}>{l.line}</div>
              {l.detail && <div style={{ fontFamily: UI, fontSize: 13, lineHeight: 1.5, color: SIGNAL.watch, marginTop: 3 }}>{l.detail}</div>}
              {l.graded && <div style={{ fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: C.text.muted, marginTop: 4 }}>{l.graded}</div>}
            </div>
          ))}
          {data && pushSupported() && (
            <div style={{ padding: "12px 0 0" }}>
              <button type="button" disabled={alertBusy} onClick={toggleAlert}
                style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: RADIUS.md, cursor: alertBusy ? "default" : "pointer", background: "transparent", color: watched ? C.text.bright : C.text.fog, border: `1px solid ${watched ? C.accent : C.borderStrong}` }}>
                {alertBusy ? "…" : watched ? `Alerts on · ${coin}` : `Alert me on ${coin}`}
              </button>
              {alertNote && <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.fog, marginTop: 6, lineHeight: 1.5 }}>{alertNote}</div>}
            </div>
          )}
          {data && (
            <div style={{ fontFamily: UI, fontSize: 12, color: C.text.muted, padding: "12px 0 4px", lineHeight: 1.5 }}>
              {MARKET_READ_FOOTER}{data.unread && data.unread.length ? ` Unread just now: ${data.unread.join(", ")}.` : ""}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 18px calc(12px + env(safe-area-inset-bottom))", borderTop: `1px solid ${C.border}` }}>
          <button type="button" style={{ ...btn, background: C.accent, color: C.canvas, borderColor: C.accent }} onClick={() => { close(); navigate(`/perp/PERP_${coin}_USDC`); }}>Trade {coin}</button>
          <button type="button" style={btn} onClick={draftCall}>Draft a call</button>
          <button type="button" style={btn} onClick={ask}>Ask Nexus</button>
        </div>
      </section>
    </>
  );
}
