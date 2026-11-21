import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePrivateQuery } from "@orderly.network/hooks";
import { deployToAgent } from "@/utils/agentPrefill";
import { Sparkline } from "@/pages/lab/components";
import { C, SIGNAL } from "@/config/theme";
import { bareTicker } from "@/utils/utils";
import { pressKey } from "@/utils/a11y";
import type { OrderlyPositionRow } from "@/utils/orderlyTypes";
import { marketFlag, flaggedMarkets, flagLabel, positionUpnl, fundingSide, LS_HEAVY_LONG, LS_HEAVY_SHORT, stretchedCount, fundingPast,
  FUNDING_LONGS_PCT, FUNDING_SHORTS_PCT, OI_CONC_X, OI_ELEV_X, PCT_LOW, PCT_HIGH } from "@/lib/intelTape.mjs";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import Fold from "@/pages/proof/Fold";
import { IntelStrip, LineCard, MajorCard, RatioCell, FlagBadge } from "./IntelVisuals";

// ─── Constants ────────────────────────────────────────────────
// Palette is DERIVED from the shared design tokens, never re-typed as hex — that's
// how "#f7525f instead of #f7525f" drift got in here before. Change a colour in
// app/config/theme.ts and this follows automatically.
const REFRESH_INTERVAL = 60; // seconds
// `: string` matters — C is `as const`, so its members are NON-widening literal
// types; without the annotation `let x = YELLOW` locks to "#fbbf24" and any
// reassignment fails to compile.
const TEAL:   string = C.accent; // neutral accent (headers, slight-bullish, bars)
const GREEN:  string = C.pos;    // your own unrealised P&L only (an outcome); the market inputs here stay ink
const RED:    string = C.neg;    // loss / down
// Regime scale reads by TONE, not hue: the label already says bullish/bearish, so only
// the extremes take colour (GREEN/RED) and the middle stays neutral. No blue — that is
// reserved for teaching copy (Coachmark/Telegram) and nothing else.
const DIM:    string = C.text.muted;
const MUTED:  string = C.text.fog;
const BRIGHT: string = C.text.bright;

// ─── Types ────────────────────────────────────────────────────
interface FearGreedData  { value: number; label: string }
interface GlobalData     { btcDom: number; ethDom: number; mcapChange24h: number; totalMcap: number }
interface Mover          { symbol: string; change24h: number; spark: number[] }

// One Orderly market's public numbers. What stands out is derived from these by
// app/lib/intelTape.mjs (a stated threshold), never stored as a "signal" or a "confidence".
interface HLAsset {
  name: string;      // symbol shorthand e.g. "BTC"
  symbol: string;    // full e.g. "PERP_BTC_USDC"
  funding: number;   // 8-hour % already
  oi: number;        // USD
  volume: number;    // 24 h USD
  markPx: number;
}


// ─── API helpers ──────────────────────────────────────────────
async function fetchFearGreed(): Promise<FearGreedData> {
  const r = await fetch("https://api.alternative.me/fng/?limit=1");
  const d = await r.json();
  return { value: parseInt(d.data[0].value), label: d.data[0].value_classification };
}

async function fetchGlobal(): Promise<GlobalData> {
  const r = await fetch("https://api.coingecko.com/api/v3/global");
  const d = await r.json();
  return {
    btcDom:       d.data.market_cap_percentage.btc,
    ethDom:       d.data.market_cap_percentage.eth,
    mcapChange24h: d.data.market_cap_change_percentage_24h_usd,
    totalMcap:    d.data.total_market_cap.usd,
  };
}

async function fetchMovers(): Promise<{ gainers: Mover[]; losers: Mover[] }> {
  const [gRes, lRes] = await Promise.all([
    fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=price_change_percentage_24h_desc&per_page=8&page=1&sparkline=true"),
    fetch("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=price_change_percentage_24h_asc&per_page=8&page=1&sparkline=true"),
  ]);
  const [gData, lData] = await Promise.all([gRes.json(), lRes.json()]);
  // Stablecoins peg to $1 — they're noise in a movers list ("USDC -0.0%"), so drop them.
  const STABLES = new Set(["USDT", "USDC", "DAI", "USDE", "FDUSD", "TUSD", "BUSD", "USDS", "PYUSD", "USDD", "GUSD", "FRAX", "LUSD"]);
  // CoinGecko's 7d sparkline is hourly (~168 pts); downsample to ~24 for a crisp
  // small line. Fails soft to [] if the field is absent.
  // CoinGecko /coins/markets row — only the fields read here.
  type CgCoin = { symbol?: string; price_change_percentage_24h?: number | null; sparkline_in_7d?: { price?: number[] } };
  const toSpark = (c: CgCoin): number[] => {
    const arr: number[] = Array.isArray(c?.sparkline_in_7d?.price) ? c.sparkline_in_7d.price : [];
    if (arr.length <= 24) return arr;
    const step = Math.ceil(arr.length / 24);
    return arr.filter((_, i) => i % step === 0);
  };
  const toMover = (c: CgCoin): Mover => ({ symbol: String(c.symbol ?? "").toUpperCase(), change24h: c.price_change_percentage_24h ?? 0, spark: toSpark(c) });
  const notStable = (c: CgCoin) => !STABLES.has(String(c.symbol || "").toUpperCase());
  return {
    gainers: (gData as CgCoin[]).filter((c) => (c.price_change_percentage_24h ?? 0) > 0 && notStable(c)).slice(0, 6).map(toMover),
    losers:  (lData as CgCoin[]).filter((c) => (c.price_change_percentage_24h ?? 0) < 0 && notStable(c)).slice(0, 6).map(toMover),
  };
}

async function fetchOrderlyFutures(): Promise<HLAsset[]> {
  // Orderly Network public futures API (our own venue)
  const r = await fetch("https://api-evm.orderly.org/v1/public/futures");
  const d = await r.json();
  if (!d.success || !d.data?.rows) return [];
  // 24h_amount is USD notional; 24h_volume is BASE units (OI in USD ÷ base volume made every
  // market look concentrated once).
  return (d.data.rows as Record<string, string | undefined>[])
    .map((row) => {
      const sym     = row.symbol as string;
      const markPx  = parseFloat(row.mark_price  || row.index_price || "0");
      const volBase = parseFloat(row["24h_volume"] || "0");
      return {
        name: bareTicker(sym), symbol: sym, markPx,
        oi: parseFloat(row.open_interest || "0") * markPx,
        volume: parseFloat(row["24h_amount"] || "0") || volBase * markPx,
        funding: parseFloat(row.last_funding_rate || row.estimated_funding_rate || "0") * 100,
      };
    })
    .filter((a) => a.oi > 10_000)
    .sort((a, b) => b.oi - a.oi)
    .slice(0, 30);
}

// ─── Formatters ───────────────────────────────────────────────
const fmtFunding = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(4)}%`;
const fmtOI      = (v: number) => v >= 1e9 ? `$${(v/1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v/1e6).toFixed(0)}M` : `$${v.toFixed(0)}`;
const fmtPct     = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

// The top-markets table's columns (desktop).
const TABLE_COLS = "80px 96px 90px 240px minmax(0, 1fr)";

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div className="nx-spotlight" style={{
      background: "#141416",
      border: "1px solid rgba(255,255,255,0.07)",
      borderRadius: "2px",
      padding: "14px 16px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ color: DIM, fontSize: "10px", letterSpacing: "0.12em", marginBottom: "12px", opacity: 0.9 }}>
      {children}
    </div>
  );
}

// ─── Responsive hook ──────────────────────────────────────────
function useIsMobile(bp = 768) {
  const [mob, setMob] = useState(() => typeof window !== "undefined" ? window.innerWidth < bp : false);
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${bp - 1}px)`);
    setMob(mq.matches);
    const h = (e: MediaQueryListEvent) => setMob(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [bp]);
  return mob;
}

// A "why?" chip on a mover — opens the Nexus copilot and asks it to explain
// the move (explain_move tool → live move + cited headlines). Lives inside the
// mover <a>, so it must swallow the click to avoid also opening the chart link.
function WhyChip({ ticker }: { ticker: string }) {
  return (
    <button
      type="button"
      title={`Ask Nexus why ${ticker} is moving`}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();
        window.dispatchEvent(new CustomEvent("nexus:assistant-ask", {
          detail: { prompt: `Why is ${ticker} moving right now? Use explain_move and cite the headlines.` },
        }));
      }}
      style={{
        flexShrink: 0, background: "transparent", border: "1px solid rgba(255,255,255,0.14)",
        color: MUTED, fontSize: "9px", letterSpacing: "0.05em", padding: "1px 5px",
        borderRadius: 4, cursor: "pointer", fontFamily: "inherit", lineHeight: 1.4,
      }}
      onMouseEnter={(e) => { e.currentTarget.style.color = "#ededf0"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.35)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.color = MUTED; e.currentTarget.style.borderColor = "rgba(255,255,255,0.14)"; }}
    >
      why?
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────
export default function IntelPage({ embedded = false }: { embedded?: boolean }) {
  const isMobile = useIsMobile();
  const navigate = useNavigate();

  const [fearGreed,  setFearGreed]  = useState<FearGreedData | null>(null);
  const [globalData, setGlobalData] = useState<GlobalData    | null>(null);
  const [movers,     setMovers]     = useState<{ gainers: Mover[]; losers: Mover[] } | null>(null);
  const [hlAssets,   setHlAssets]   = useState<HLAsset[]     | null>(null);
  const [lsRatios,   setLsRatios]   = useState<Record<string, number | null>>({});
  const [loading,    setLoading]    = useState(true);
  const [countdown,  setCountdown]  = useState(REFRESH_INTERVAL);
  const [timestamp,  setTimestamp]  = useState("");
  const [contexts,   setContexts]   = useState<Record<string, { funding?: { pct?: number | null } }>>({});

  // Funding/OI percentile-vs-history (Brighter-Data-style context) for the majors.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out: Record<string, { funding?: { pct?: number | null } }> = {};
      await Promise.all(["BTC", "ETH", "SOL"].map(async (sym) => {
        try {
          const r = await fetch(`https://og.nexustradinglabs.com/signals/context/PERP_${sym}_USDC`);
          if (r.ok) out[sym] = await r.json();
        } catch { /* fail-soft */ }
      }));
      if (!cancelled) setContexts(out);
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Live positions from Orderly (wallet must be connected) ──
  const { data: posData } = usePrivateQuery("/v1/positions", { revalidateOnFocus: false }) as { data: { rows?: OrderlyPositionRow[] } | null };
  const openPositions: OrderlyPositionRow[] = posData?.rows ?? [];

  const longNotional  = openPositions.filter(p => p.position_qty > 0).reduce((s: number, p) => s + Math.abs(p.position_value ?? p.position_qty * (p.mark_price ?? 0)), 0);
  const shortNotional = openPositions.filter(p => p.position_qty < 0).reduce((s: number, p) => s + Math.abs(p.position_value ?? p.position_qty * (p.mark_price ?? 0)), 0);
  const totalNotional = longNotional + shortNotional;
  const portfolioLongPct: number | null = totalNotional > 0 ? Math.round((longNotional / totalNotional) * 100) : null;

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [fg, gd, mv, hl] = await Promise.allSettled([
        fetchFearGreed(),
        fetchGlobal(),
        fetchMovers(),
        fetchOrderlyFutures(),
      ]);
      if (fg.status === "fulfilled") setFearGreed(fg.value);
      if (gd.status === "fulfilled") setGlobalData(gd.value);
      if (mv.status === "fulfilled") setMovers(mv.value);
      if (hl.status === "fulfilled") setHlAssets(hl.value);

      // Real long/short ACCOUNT ratio via our OKX proxy (Binance 451s from most
      // regions incl. the US; OKX is open + not geo-fenced). Funding/OI already come
      // from Orderly (getDerivData), so we no longer need Binance for those either.
      try {
        const r = await fetch("https://og.nexustradinglabs.com/proxy/ls?symbols=BTC,ETH,SOL");
        if (r.ok) {
          const d = await r.json();
          setLsRatios(d?.ls ?? {});
        }
      } catch { /* fail-soft — L/S renders "—" */ }

      setTimestamp(new Date().toLocaleTimeString());
      setCountdown(REFRESH_INTERVAL);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  useEffect(() => {
    const iv = setInterval(fetchAll, REFRESH_INTERVAL * 1000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  useEffect(() => {
    const t = setInterval(() => setCountdown(p => (p > 0 ? p - 1 : REFRESH_INTERVAL)), 1000);
    return () => clearInterval(t);
  }, []);

  // Markets past a stated line (intelTape.mjs), furthest past first. No confidence score.
  const signals = flaggedMarkets(hlAssets ?? [], 8) as HLAsset[];

  const topPositions = (hlAssets ?? []).slice(0, 12);

  const top10 = (hlAssets ?? []).slice(0, 10);
  const avgFunding10 = top10.length
    ? top10.reduce((s, a) => s + a.funding, 0) / top10.length
    : null;

  const alsoActive = (hlAssets ?? [])
    .filter(a => !["BTC","ETH","SOL"].includes(a.name) && Math.abs(a.funding) > 0.015)
    .sort((a, b) => Math.abs(b.funding) - Math.abs(a.funding))
    .slice(0, 5);

  // ── Styles ──────────────────────────────────────────────────
  const page: React.CSSProperties = {
    background: embedded ? "transparent" : "#0f0f11",
    minHeight: embedded ? undefined : "100svh",
    padding: embedded ? (isMobile ? "8px 0" : "4px 0") : (isMobile ? "12px" : "16px 20px"),
    fontFamily: "'Courier New', Courier, monospace",
    color: BRIGHT,
    fontSize: "13px",
    boxSizing: "border-box",
  };

  // ── JSX ─────────────────────────────────────────────────────
  // Visual-first (borst 2026-11-21, same rules as /proof; rules in app/lib/intelTape.mjs, pieces in IntelVisuals.tsx):
  // the strip (Fear/Greed · funding breadth · past a line) → markets past a stated line as cards → the majors (funding
  // WITH its percentile, the account ratio, a badge when stretched) → your positions → the top markets table → "More"
  // (how to read, market-wide inputs, also active, movers, sources). Same numbers and sources; nothing added up.
  const majorsList = (["BTC", "ETH", "SOL"] as const).map((sym) => ({ sym, a: hlAssets?.find((h) => h.name === sym), ctx: contexts[sym], ls: lsRatios[sym] ?? null }));
  const pastCount = stretchedCount(hlAssets ?? []);
  const sectionHead = (title: string, n?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "4px 0 10px" }}>
      <span style={{ color: BRIGHT, fontFamily: "var(--nx-font-ui)", fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{title}</span>
      {n && <span style={{ color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "11px" }}>{n}</span>}
      <span style={{ flex: 1, height: 1, background: C.border }} />
    </div>
  );

  return (
    <div className="nx-stagger" style={page}>

      {/* ── Header ─────────────────────────────────────────── */}
      {/* Standalone: an editorial header (eyebrow → serif), matching the rest of the Lab.
          Embedded in the Lab, MarketIntelView already provides the header — so we show only
          a thin live-status line here (no duplicate title). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "12px", flexWrap: "wrap", gap: "8px" }}>
        {!embedded ? (
          <div>
            <div style={{ fontSize: "9px", color: "#71717a", fontFamily: "var(--nx-font-mono)", letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: "5px" }}>Read the tape</div>
            <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: "24px", fontWeight: 600, color: C.text.bright, lineHeight: 1.1, letterSpacing: "-0.02em" }}>Market Terminal</div>
          </div>
        ) : <span />}
        <div style={{ color: DIM, fontSize: "10px", fontFamily: "var(--nx-font-mono)", display: "flex", alignItems: "center", gap: "8px", letterSpacing: "0.05em" }}>
          {timestamp && <span>updated {timestamp}</span>}
          {loading ? <span style={{ color: TEAL }}>⟳ live</span> : <span>{countdown}s</span>}
        </div>
      </div>

      {/* ── 1 · The strip: three visuals, one line (sticky on desktop) ── */}
      <IntelStrip fg={fearGreed} assets={hlAssets} isMobile={isMobile} />

      {/* ── 2 · Markets past a stated line, furthest past first ── */}
      <section style={{ marginBottom: "16px" }}>
        {sectionHead("Past a stated line", hlAssets ? (pastCount.total > signals.length ? `${signals.length} of ${pastCount.total}, furthest past first` : `${pastCount.total}`) : undefined)}
        {signals.length > 0 ? (
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, minmax(0, 1fr))", gap: "12px" }}>
            {signals.map((a) => (
              <LineCard key={a.name} a={a}
                onOpen={() => openMarket(a.name)}
                onTrade={() => navigate(`/perp/${a.symbol}`)}
                onAgent={() => deployToAgent({ symbols: [a.symbol] }, `${a.name} (${flagLabel(marketFlag(a).kind).toLowerCase()})`, undefined, navigate)} />
            ))}
          </div>
        ) : (
          <div style={{ color: DIM, fontFamily: "var(--nx-font-ui)", fontSize: "13px", padding: "10px 2px" }}>
            {hlAssets ? "No market is past a line right now." : loading ? "Reading Orderly’s markets…" : "Orderly’s market list didn’t load."}
          </div>
        )}
      </section>

      {/* ── 3 · The majors: funding never alone (its percentile beside it), the account ratio, a badge when stretched ── */}
      <section style={{ marginBottom: "16px" }}>
        {sectionHead("The majors")}
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: "12px" }}>
          {majorsList.map(({ sym, a, ctx, ls }) => (
            <MajorCard key={sym} sym={sym} a={a} ctx={ctx} ls={ls}
              onOpen={() => openMarket(sym)}
              onAgent={() => deployToAgent({ symbols: [`PERP_${sym}_USDC`] }, `the ${sym} funding read`, undefined, navigate)} />
          ))}
        </div>
      </section>

      {/* ── Your positions: unrealised P&L computed from the row (Orderly's unsettled_pnl is
          realised-but-unsettled, not this) and the funding each one pays or receives. ── */}
      {portfolioLongPct !== null && (() => {
        const netLong  = portfolioLongPct;
        const netShort = 100 - netLong;
        return (
          <Card style={{ marginBottom: "10px" }}>
            <SectionTitle style={{ marginBottom: "10px" }}>YOUR POSITIONS</SectionTitle>
            <div style={{ marginBottom: "12px" }}>
              <div style={{ color: DIM, fontSize: "10px", marginBottom: "4px", letterSpacing: "0.06em" }}>NET EXPOSURE (NOTIONAL)</div>
              <div style={{ display: "flex", height: "8px", borderRadius: "2px", overflow: "hidden", gap: "1px", marginBottom: "4px" }}>
                <div style={{ flex: netLong, background: "#d4d4d8", opacity: 0.75 }} />
                <div style={{ flex: netShort, background: "#52525b", opacity: 0.9 }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px" }}>
                <span style={{ color: MUTED }}>LONG {netLong}%</span>
                <span style={{ color: MUTED }}>SHORT {netShort}%</span>
              </div>
            </div>
            <div style={{ fontSize: "12px", color: MUTED, lineHeight: 1.6 }}>
              {openPositions.filter((p) => p.position_qty !== 0).slice(0, 6).map((p) => {
                const sym  = bareTicker(p.symbol);
                const dir  = p.position_qty > 0 ? "LONG" : "SHORT";
                const upnl = positionUpnl(p);
                const mkt  = hlAssets?.find((h) => h.symbol === p.symbol);
                const side = mkt ? fundingSide(p.position_qty, mkt.funding) : null;
                return (
                  <div key={p.symbol} style={{ padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)" }}>
                    <div style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
                      <span style={{ color: BRIGHT }}>{sym}</span>
                      <span style={{ color: DIM, fontSize: "10px" }}>{dir}</span>
                      <span style={{ marginLeft: "auto", color: upnl == null ? DIM : upnl >= 0 ? GREEN : RED }}>
                        {upnl == null ? "—" : `${upnl >= 0 ? "+" : "−"}${Math.abs(upnl).toFixed(2)} USDC`}
                      </span>
                    </div>
                    {mkt && side && (
                      <div style={{ color: DIM, fontSize: "11px" }}>
                        {side === "pays" ? "pays" : "receives"} {fmtFunding(Math.abs(mkt.funding))}/8h funding{marketFlag(mkt).kind !== "NONE" ? ` · ${flagLabel(marketFlag(mkt).kind).toLowerCase()}` : ""}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{ color: DIM, fontSize: "10px", marginTop: "8px" }}>
              {"// "}UNREALISED = SIZE × (MARK − AVG OPEN). FUNDING FROM ORDERLY’S LAST RATE.
            </div>
          </Card>
        );
      })()}


      {/* ── 4 · Top markets by open interest: funding coloured by state, OI ÷ volume as a mark, the line as a badge ── */}
      <Card style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px", flexWrap: "wrap", gap: "4px" }}>
          <SectionTitle style={{ marginBottom: 0 }}>TOP MARKETS BY OPEN INTEREST</SectionTitle>
          <span style={{ color: DIM, fontSize: "10px" }}>ORDERLY NETWORK · {timestamp || "—"}</span>
        </div>
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: TABLE_COLS, gap: "8px", marginBottom: "4px" }}>
            {["MARKET", "FUNDING 8H", "OI", "OI ÷ 24H VOL", "PAST A LINE"].map(h => (
              <div key={h} style={{ color: DIM, fontSize: "10px", letterSpacing: "0.08em", paddingBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {h}
              </div>
            ))}
          </div>
        )}
        {topPositions.map(asset => {
          const fl = marketFlag(asset);
          const fPast = fundingPast(asset);
          const oiPast = fl.kind === "HIGH_CONCENTRATION" || fl.kind === "ELEVATED_OI";
          const open = () => openMarket(asset.name);
          return isMobile ? (
            <div key={asset.name} role="button" tabIndex={0} onClick={open} onKeyDown={pressKey(open)} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "12px", cursor: "pointer" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                <span style={{ color: BRIGHT, fontWeight: 700 }}>{asset.name}</span>
                <FlagBadge kind={fl.kind} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "auto auto minmax(0, 1fr)", alignItems: "center", gap: "4px 12px", color: DIM, fontSize: "11px" }}>
                <span>FUND <span style={{ color: fPast ? SIGNAL.watch : MUTED }}>{fmtFunding(asset.funding)}</span></span>
                <span>OI <span style={{ color: MUTED }}>{fmtOI(asset.oi)}</span></span>
                <RatioCell ratio={fl.ratio} past={oiPast} />
              </div>
            </div>
          ) : (
            <div key={asset.name} role="button" tabIndex={0} onClick={open} onKeyDown={pressKey(open)} style={{ display: "grid", gridTemplateColumns: TABLE_COLS, gap: "8px", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "12px", alignItems: "center", cursor: "pointer" }}>
              <div style={{ color: BRIGHT, fontWeight: 700 }}>{asset.name}</div>
              <div style={{ color: fPast ? SIGNAL.watch : MUTED }}>{fmtFunding(asset.funding)}</div>
              <div style={{ color: MUTED }}>{fmtOI(asset.oi)}</div>
              <RatioCell ratio={fl.ratio} past={oiPast} />
              <div><FlagBadge kind={fl.kind} /></div>
            </div>
          );
        })}
        {topPositions.length === 0 && (
          <div style={{ color: DIM, padding: "20px 0", textAlign: "center", fontSize: "12px" }}>
            {loading ? "Loading Orderly’s markets…" : "Orderly’s market list didn’t load."}
          </div>
        )}
      </Card>

      {/* ── 5 · More: how to read, the market-wide inputs, also active, movers, the lines, the sources ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, marginBottom: "10px" }}>
        <Fold title="More" note="How to read this, BTC dominance and total market cap, also active, 24h movers, the lines and the sources.">
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ color: DIM, fontSize: "12px", lineHeight: 1.5, fontFamily: "var(--nx-font-ui, sans-serif)" }}>
              <b style={{ color: BRIGHT }}>How to read this:</b> public numbers, each with its source. Up top, the whole
              market’s inputs side by side. Then markets past a stated line: funding stretched, or open interest high
              against volume. None of it is graded here, and nothing adds them up into a call.
            </div>
            <Card>
              <SectionTitle>MARKET-WIDE INPUTS</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(2, minmax(0, 1fr))", gap: "14px" }}>
                <div>
                  <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>BTC DOMINANCE</div>
                  <div style={{ color: BRIGHT, fontWeight: 600, fontSize: "15px" }}>{globalData ? `${globalData.btcDom.toFixed(1)}%` : "—"}</div>
                  <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>{globalData ? `ETH ${globalData.ethDom.toFixed(1)}% · CoinGecko` : "unread"}</div>
                </div>
                <div>
                  <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>TOTAL MCAP 24H</div>
                  <div style={{ color: globalData ? BRIGHT : DIM, fontWeight: 600, fontSize: "15px" }}>{globalData ? fmtPct(globalData.mcapChange24h) : "—"}</div>
                  <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>{globalData ? `$${(globalData.totalMcap / 1e12).toFixed(2)}T · CoinGecko` : "unread"}</div>
                </div>
              </div>
              {avgFunding10 !== null && <div style={{ color: DIM, fontSize: "11px", marginTop: "10px" }}>Top 10 by OI, average funding {fmtFunding(avgFunding10)}/8h · Orderly</div>}
            </Card>
            {alsoActive.length > 0 && (
              <Card>
                <SectionTitle>ALSO ACTIVE · FUNDING 8H</SectionTitle>
                {alsoActive.map(a => (
                  <div key={a.name} role="button" tabIndex={0} onClick={() => openMarket(a.name)} onKeyDown={pressKey(() => openMarket(a.name))} style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", fontSize: "12px", cursor: "pointer" }}>
                    <span style={{ color: MUTED }}>{a.name}</span>
                    <span style={{ color: fundingPast(a) ? SIGNAL.watch : MUTED }}>{fmtFunding(a.funding)}</span>
                  </div>
                ))}
              </Card>
            )}
            {/* ── Movers 24H ────────────────────────────────────── */}
        <Card>
          <SectionTitle>MOVERS 24H</SectionTitle>

          <div style={{ marginBottom: "12px" }}>
            <div style={{ color: MUTED, fontSize: "10px", letterSpacing: "0.08em", marginBottom: "6px" }}>▲ GAINERS</div>
            {movers?.gainers.map(g => (
              <a
                key={g.symbol}
                href={`https://www.tradingview.com/chart/?symbol=${g.symbol}USDT`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", padding: "2px 4px", textDecoration: "none", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: MUTED, fontSize: "12px", flexShrink: 0 }}>{g.symbol}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <WhyChip ticker={g.symbol} />
                  <Sparkline points={g.spark} color={MUTED} />
                  <span style={{ color: BRIGHT, fontSize: "12px", fontWeight: 600, width: 52, textAlign: "right" }}>+{g.change24h.toFixed(1)}%</span>
                </span>
              </a>
            )) ?? <div style={{ color: DIM, fontSize: "12px" }}>Loading…</div>}
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
            <div style={{ color: MUTED, fontSize: "10px", letterSpacing: "0.08em", marginBottom: "6px" }}>▼ LOSERS</div>
            {movers?.losers.map(l => (
              <a
                key={l.symbol}
                href={`https://www.tradingview.com/chart/?symbol=${l.symbol}USDT`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ display: "flex", justifyContent: "space-between", padding: "2px 4px", textDecoration: "none", cursor: "pointer" }}
                onMouseEnter={e => (e.currentTarget.style.background = "rgba(255,255,255,0.03)")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
              >
                <span style={{ color: MUTED, fontSize: "12px", flexShrink: 0 }}>{l.symbol}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  <WhyChip ticker={l.symbol} />
                  <Sparkline points={l.spark} color={MUTED} />
                  <span style={{ color: BRIGHT, fontSize: "12px", fontWeight: 600, width: 52, textAlign: "right" }}>{l.change24h.toFixed(1)}%</span>
                </span>
              </a>
            )) ?? <div style={{ color: DIM, fontSize: "12px" }}>Loading…</div>}
          </div>

          <div style={{ color: DIM, fontSize: "10px", marginTop: "12px", letterSpacing: "0.05em" }}>
            {"// "}VIA COINGECKO
          </div>
        </Card>
            <div style={{ color: DIM, fontSize: "10px", lineHeight: 1.6 }}>
              {"// "}LINES: FUNDING ABOVE +{FUNDING_LONGS_PCT}% OR BELOW {FUNDING_SHORTS_PCT}% PER 8H · OI ABOVE {OI_CONC_X}× ({OI_ELEV_X}×) 24H VOLUME ON MARKETS TRADING OVER $100K · MAJORS’ FUNDING PERCENTILE TICKS AT {PCT_LOW}TH / {PCT_HIGH}TH.<br />
              {"// "}MORE ACCOUNTS LONG = ratio above {LS_HEAVY_LONG}; MORE ACCOUNTS SHORT = below {LS_HEAVY_SHORT}. A count of accounts on OKX, not graded.<br />
              {"// "}DATA: COINGECKO · OKX · ORDERLY NETWORK · ALTERNATIVE.ME · AUTO-REFRESH {REFRESH_INTERVAL}s
            </div>
          </div>
        </Fold>
      </div>

    </div>
  );
}
