import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePrivateQuery } from "@orderly.network/hooks";
import { deployToAgent } from "@/utils/agentPrefill";
import { Sparkline } from "@/pages/lab/components";
import { C } from "@/config/theme";
import { bareTicker } from "@/utils/utils";
import { pressKey } from "@/utils/a11y";
import type { OrderlyPositionRow } from "@/utils/orderlyTypes";
import { marketFlag, flaggedMarkets, flagLine, flagLabel, lsWords, fundingBreadth, positionUpnl, fundingSide, LS_HEAVY_LONG, LS_HEAVY_SHORT } from "@/lib/intelTape.mjs";

// ─── Constants ────────────────────────────────────────────────
// Palette is DERIVED from the shared design tokens, never re-typed as hex — that's
// how "#f7525f instead of #f7525f" drift got in here before. Change a colour in
// app/config/theme.ts and this follows automatically.
const REFRESH_INTERVAL = 60; // seconds
// `: string` matters — C is `as const`, so its members are NON-widening literal
// types; without the annotation `let x = YELLOW` locks to "#fbbf24" and any
// reassignment fails to compile.
const TEAL:   string = C.accent; // neutral accent (headers, slight-bullish, bars)
const GREEN:  string = C.pos;    // genuine UP/positive: gainers, +change, bullish, greed
const RED:    string = C.neg;    // loss / down
const YELLOW: string = C.warn;   // CAUTION ONLY — crowding, tension, squeeze risk
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

interface DerivAsset { funding: number; oi: number } // 8-hour %, USD

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

// Crowding/dominance are DESCRIPTIVE readings: bone (emphasis by tone), never amber or green/red.
const lsColor = (ls: number | null) =>
  ls === null ? DIM : (ls > LS_HEAVY_LONG || ls < LS_HEAVY_SHORT) ? TEAL : MUTED;

// ─── Sub-components ───────────────────────────────────────────
function BarBlock({ value, total = 100, color = TEAL, len = 18 }: { value: number; total?: number; color?: string; len?: number }) {
  const filled = Math.round(Math.min(1, Math.max(0, value / total)) * len);
  return (
    <span style={{ letterSpacing: "1px" }}>
      <span style={{ color }}     >{"▓".repeat(filled)}</span>
      <span style={{ color: "rgba(255,255,255,0.12)" }}>{"░".repeat(len - filled)}</span>
    </span>
  );
}

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

  // ── Derived data ────────────────────────────────────────────
  const getDerivData = (sym: string): DerivAsset | null => {
    const a = hlAssets?.find(h => h.name === sym);
    return a ? { funding: a.funding, oi: a.oi } : null;
  };

  const btcD = getDerivData("BTC"), ethD = getDerivData("ETH"), solD = getDerivData("SOL");

  // Markets past a stated line (intelTape.mjs), furthest past first. No confidence score.
  const signals = flaggedMarkets(hlAssets ?? [], 8) as HLAsset[];

  const topPositions = (hlAssets ?? []).slice(0, 12);

  const breadth = fundingBreadth(hlAssets ?? []);

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

  const grid3: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: isMobile ? "1fr" : "1.1fr 0.9fr",
    gap: "10px",
    marginBottom: "10px",
  };

  // ── Render helpers ───────────────────────────────────────────
  const renderDeriv = (sym: string, data: DerivAsset | null, ls: number | null) => {
    const fc = !data ? DIM : BRIGHT;
    return (
      <div key={sym} style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
          <span style={{ color: BRIGHT, fontWeight: 700, width: "40px" }}>{sym}</span>
          {data && <span style={{ color: DIM, fontSize: "11px" }}>{flagLabel(marketFlag(hlAssets?.find((h) => h.name === sym)).kind)}</span>}
          <button onClick={() => deployToAgent({ symbols: [`PERP_${sym}_USDC`] }, `the ${sym} funding read`, undefined, navigate)}
            title={`Set the agent to watch ${sym}. It trades your rules.`}
            style={{ marginLeft: "auto", background: "none", border: "1px solid #33333a", color: "#ededf0", fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "3px 8px", borderRadius: "3px", cursor: "pointer" }}>
            ⚡ Agent
          </button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", rowGap: "2px", columnGap: "8px", fontSize: "12px" }}>
          <div>
            <span style={{ color: DIM }}>FUNDING 8H  </span><span style={{ color: fc }}>{data ? fmtFunding(data.funding) : "—"}</span>
            {/* Funding percentile-vs-history lives in the "FUNDING vs ITS OWN HISTORY"
                gauges above — de-duped from this dense row. */}
          </div>
          <div><span style={{ color: DIM }}>OI  </span><span style={{ color: MUTED }}>{data ? fmtOI(data.oi) : "—"}</span></div>
          <div><span style={{ color: DIM }}>L/S  </span><span style={{ color: lsColor(ls) }}>{ls !== null ? ls.toFixed(2) : "—"}</span></div>
          <div><span style={{ color: lsColor(ls), fontSize: "11px" }}>{lsWords(ls)}</span></div>
        </div>
      </div>
    );
  };

  // ── JSX ─────────────────────────────────────────────────────
  return (
    <div className="nx-stagger" style={page}>

      {/* ── Header ─────────────────────────────────────────── */}
      {/* Standalone: an editorial header (eyebrow → serif), matching the rest of the Lab.
          Embedded in the Lab, MarketIntelView already provides the header — so we show only
          a thin live-status line here (no duplicate title). */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "16px", flexWrap: "wrap", gap: "8px" }}>
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

      {/* ── How to read this — plain-language, once, for everyone ──────────── */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start", marginBottom: "10px", padding: "10px 12px", border: "1px solid rgba(255,255,255,0.06)", borderLeft: `2px solid ${MUTED}`, borderRadius: "6px", background: "rgba(255,255,255,0.02)" }}>
        <span style={{ color: MUTED, fontSize: "12px", flexShrink: 0 }}>?</span>
        <span style={{ color: DIM, fontSize: "12px", lineHeight: 1.5, fontFamily: "var(--nx-font-ui, sans-serif)" }}>
          <b style={{ color: BRIGHT }}>How to read this:</b> public numbers, each with its source. Up top, the whole
          market’s inputs side by side. Below, markets past a stated line: funding stretched, or open interest high
          against volume. None of it is graded here, and nothing adds them up into a call.
        </span>
      </div>

      {/* ── The tape: each input on its own (it used to be weighted into one BULLISH/BEARISH score) ── */}
      <Card style={{ marginBottom: "10px" }}>
        <SectionTitle>THE TAPE · INPUTS, NOT A VERDICT</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, 1fr)", gap: "14px" }}>
          <div>
            <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>FEAR / GREED</div>
            <div style={{ color: BRIGHT, fontWeight: 600, fontSize: "15px" }}>{fearGreed ? fearGreed.value : "—"}</div>
            <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>{fearGreed ? `“${fearGreed.label}” · alternative.me` : "unread"}</div>
            {fearGreed && <div style={{ marginTop: "3px" }}><BarBlock value={fearGreed.value} total={100} color={MUTED} len={12} /></div>}
          </div>
          <div>
            <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>BTC DOMINANCE</div>
            <div style={{ color: BRIGHT, fontWeight: 600, fontSize: "15px" }}>{globalData ? `${globalData.btcDom.toFixed(1)}%` : "—"}</div>
            <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>{globalData ? `ETH ${globalData.ethDom.toFixed(1)}% · CoinGecko` : "unread"}</div>
          </div>
          <div>
            <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>TOTAL MCAP 24H</div>
            <div style={{ color: globalData ? globalData.mcapChange24h > 0 ? GREEN : globalData.mcapChange24h < 0 ? RED : MUTED : DIM, fontWeight: 600, fontSize: "15px" }}>
              {globalData ? fmtPct(globalData.mcapChange24h) : "—"}
            </div>
            <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>{globalData ? `$${(globalData.totalMcap / 1e12).toFixed(2)}T · CoinGecko` : "unread"}</div>
          </div>
          <div>
            <div style={{ color: DIM, fontSize: "10px", marginBottom: "3px" }}>FUNDING · ORDERLY</div>
            <div style={{ color: BRIGHT, fontWeight: 600, fontSize: "15px" }}>{breadth.total ? `${breadth.positive} of ${breadth.total}` : "—"}</div>
            <div style={{ color: DIM, fontSize: "11px", marginTop: "2px" }}>
              {breadth.total ? `markets where longs pay${avgFunding10 !== null ? ` · top 10 avg ${fmtFunding(avgFunding10)}/8h` : ""}` : "unread"}
            </div>
          </div>
        </div>
        <div style={{ color: DIM, fontSize: "11px", marginTop: "12px", lineHeight: 1.5, fontFamily: "var(--nx-font-ui, sans-serif)" }}>
          Four public numbers, not added up. None is a graded read: the graded ones are on /proof.
        </div>
      </Card>

      {/* ── ALERTS — the crowding/OI signals as Signal Cards ──────────────── */}
      {signals.length > 0 && (
        <div style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "2px 0 10px" }}>
            <span style={{ color: BRIGHT, fontFamily: "var(--nx-font-mono)", fontSize: "12px", fontWeight: 700, letterSpacing: "0.12em" }}>PAST A STATED LINE</span>
            <span style={{ color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "10px" }}>{signals.length}</span>
            <span style={{ flex: 1, height: 1, background: C.border }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)", gap: "12px" }}>
            {signals.map(a => {
              const fl = marketFlag(a);
              const funding = fl.kind === "CROWDED_LONGS" || fl.kind === "CROWDED_SHORTS";
              const metric = funding ? { n: fmtFunding(a.funding), label: "Funding 8h" } : { n: `${fl.ratio.toFixed(1)}×`, label: "OI ÷ 24h volume" };
              return (
                <div role="link" tabIndex={0} key={a.name} className="nx-card-interactive" onClick={() => navigate(`/perp/${a.symbol}`)} onKeyDown={pressKey(() => navigate(`/perp/${a.symbol}`))} title={`Open ${a.name}`}
                  style={{ position: "relative", border: `1px solid ${C.border}`, borderLeft: `2px solid ${C.borderStrong}`, borderRadius: "8px", padding: "14px", background: `linear-gradient(180deg, ${C.surface}, ${C.surfaceAlt})`, cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
                    <span style={{ color: BRIGHT, fontFamily: "var(--nx-font-mono)", fontWeight: 700, fontSize: "14px" }}>{a.name}</span>
                    <span style={{ color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "10px", letterSpacing: "0.08em", textTransform: "uppercase" }}>{flagLabel(fl.kind)}</span>
                    <span style={{ marginLeft: "auto", color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "10px", letterSpacing: "0.08em" }}>NOT GRADED</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "flex-end", gap: "8px" }}>
                    <div>
                      <div style={{ color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "10px", letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: "3px" }}>{metric.label}</div>
                      <div style={{ color: BRIGHT, fontFamily: "var(--nx-font-mono)", fontSize: "26px", fontWeight: 600, lineHeight: 0.9 }}>{metric.n}</div>
                    </div>
                    <span style={{ marginLeft: "auto", color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "10px" }}>OI {fmtOI(a.oi)}</span>
                  </div>
                  <p style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: "12.5px", lineHeight: 1.5, color: MUTED, margin: "12px 0 0", padding: "9px 11px", background: "rgba(237,237,240,0.03)", border: `1px solid ${C.border}`, borderRadius: "6px" }}>
                    {flagLine(a.name, a)}
                  </p>
                  <div style={{ display: "flex", gap: "8px", marginTop: "12px" }}>
                    <button onClick={(e) => { e.stopPropagation(); navigate(`/perp/${a.symbol}`); }}
                      style={{ flex: 1, background: "none", border: `1px solid ${C.borderStrong}`, color: C.accent, fontFamily: "var(--nx-font-ui)", fontSize: 12, fontWeight: 600, padding: "8px", borderRadius: "6px", cursor: "pointer" }}>→ Open {a.name}</button>
                    <button onClick={(e) => { e.stopPropagation(); deployToAgent({ symbols: [a.symbol] }, `${a.name} (${flagLabel(fl.kind).toLowerCase()})`, undefined, navigate); }}
                      title={`Set the agent to watch ${a.name}`}
                      style={{ background: "none", border: `1px solid ${C.border}`, color: MUTED, fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "8px 10px", borderRadius: "6px", cursor: "pointer" }}>⚡ Agent</button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Funding vs its own history — percentile gauges for the majors ──── */}
      {(() => {
        const majors = (["BTC", "ETH", "SOL"] as const)
          .map((sym) => ({ sym, f: contexts[sym]?.funding, data: getDerivData(sym) }))
          .filter((m): m is typeof m & { f: { pct: number } } => m.f?.pct != null);
        if (!majors.length) return null;
        return (
          <div style={{ marginBottom: "10px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "10px", margin: "2px 0 10px" }}>
              <span style={{ color: DIM, fontFamily: "var(--nx-font-mono)", fontSize: "11px", fontWeight: 700, letterSpacing: "0.12em" }}>FUNDING vs ITS OWN HISTORY</span>
              <span style={{ color: C.text.faint, fontFamily: "var(--nx-font-mono)", fontSize: "10px" }}>the majors</span>
              <span style={{ flex: 1, height: 1, background: C.border }} />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "12px" }}>
              {majors.map(({ sym, f, data }) => {
                const pct = Math.max(0, Math.min(100, f.pct));
                const stretched = f.pct >= 85 || f.pct <= 15;
                const cap = f.pct >= 85 ? "unusually high · the crowd is stretched long"
                  : f.pct <= 15 ? "unusually low · stretched short"
                  : "normal · nothing stretched";
                return (
                  <div key={sym} style={{ border: `1px solid ${C.border}`, borderRadius: "10px", padding: "14px", background: C.surfaceAlt }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ color: BRIGHT, fontFamily: "var(--nx-font-mono)", fontSize: "13px", fontWeight: 700 }}>{sym}</span>
                      <span style={{ color: MUTED, fontFamily: "var(--nx-font-mono)", fontSize: "10px" }}>{data ? `${fmtFunding(data.funding)}/8h` : "—"}</span>
                    </div>
                    <div style={{ position: "relative", height: "6px", borderRadius: "4px", background: C.inset, border: `1px solid ${C.border}`, margin: "11px 0 8px" }}>
                      <div style={{ position: "absolute", top: "-1px", bottom: "-1px", width: "2px", background: stretched ? YELLOW : C.accent, left: `${pct}%` }} />
                    </div>
                    <div style={{ fontFamily: "var(--nx-font-ui, sans-serif)", fontSize: "11.5px", lineHeight: 1.45, color: MUTED }}>
                      <b style={{ color: stretched ? YELLOW : BRIGHT }}>{f.pct}th percentile</b> — {cap}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

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

            {/* ── Main 3-col grid ─────────────────────────────────── */}
      <div style={grid3}>

        {/* ── Derivatives Intelligence ──────────────────────── */}
        <Card>
          <SectionTitle>DERIVATIVES INTELLIGENCE · ORDERLY NETWORK</SectionTitle>

          {renderDeriv("BTC", btcD, lsRatios["BTC"] ?? null)}
          {renderDeriv("ETH", ethD, lsRatios["ETH"] ?? null)}
          {renderDeriv("SOL", solD, lsRatios["SOL"] ?? null)}

          {alsoActive.length > 0 && (
            <div style={{ marginTop: "6px" }}>
              <div style={{ color: DIM, fontSize: "10px", letterSpacing: "0.1em", marginBottom: "6px" }}>ALSO ACTIVE · FUNDING 8H</div>
              {alsoActive.map(a => (
                <div key={a.name} style={{ display: "flex", justifyContent: "space-between", marginBottom: "3px", fontSize: "12px" }}>
                  <span style={{ color: MUTED }}>{a.name}</span>
                  <span style={{ color: a.funding >= 0 ? GREEN : RED }}>{fmtFunding(a.funding)}</span>
                </div>
              ))}
            </div>
          )}

          <div style={{ color: DIM, fontSize: "10px", marginTop: "12px", letterSpacing: "0.05em" }}>
            {"// "}VIA OKX · ORDERLY NETWORK
          </div>
        </Card>

        {/* ── Movers 24H ────────────────────────────────────── */}
        <Card>
          <SectionTitle>MOVERS 24H</SectionTitle>

          <div style={{ marginBottom: "12px" }}>
            <div style={{ color: GREEN, fontSize: "10px", letterSpacing: "0.08em", marginBottom: "6px" }}>▲ GAINERS</div>
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
                  <Sparkline points={g.spark} color="#3ecf8e" />
                  <span style={{ color: GREEN, fontSize: "12px", fontWeight: 600, width: 52, textAlign: "right" }}>+{g.change24h.toFixed(1)}%</span>
                </span>
              </a>
            )) ?? <div style={{ color: DIM, fontSize: "12px" }}>Loading…</div>}
          </div>

          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "10px" }}>
            <div style={{ color: RED, fontSize: "10px", letterSpacing: "0.08em", marginBottom: "6px" }}>▼ LOSERS</div>
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
                  <Sparkline points={l.spark} color="#f7525f" />
                  <span style={{ color: RED, fontSize: "12px", fontWeight: 600, width: 52, textAlign: "right" }}>{l.change24h.toFixed(1)}%</span>
                </span>
              </a>
            )) ?? <div style={{ color: DIM, fontSize: "12px" }}>Loading…</div>}
          </div>

          <div style={{ color: DIM, fontSize: "10px", marginTop: "12px", letterSpacing: "0.05em" }}>
            {"// "}VIA COINGECKO
          </div>
        </Card>

        {/* Live Signals were promoted to the full-width ◆ ALERTS cards above. */}

      </div>

            {/* ── Long/Short Positioning ──────────────────────────────── */}
      <Card style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
          <SectionTitle style={{ marginBottom: 0 }}>LONG / SHORT POSITIONING</SectionTitle>
          <span style={{ color: DIM, fontSize: "10px" }}>VIA OKX ACCOUNT RATIO</span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, 1fr)", gap: "10px" }}>
          {(["BTC", "ETH", "SOL"] as const).map(sym => {
            const ls = lsRatios[sym] ?? null;
            const status = ls === null ? "UNREAD" : lsWords(ls);
            const sc = lsColor(ls);
            const longPct  = ls !== null ? Math.min(0.92, ls / (ls + 1)) : 0.5;
            const shortPct = 1 - longPct;
            const desc = ls === null ? "OKX’s ratio didn’t load."
              : `${Math.round(longPct * 100)}% of OKX accounts with a position are long. A count of accounts, not of size.`;
            return (
              <div key={sym} style={{ padding: "10px 12px", background: "rgba(255,255,255,0.02)", border: `1px solid ${ls === null ? "rgba(255,255,255,0.05)" : (ls > LS_HEAVY_LONG || ls < LS_HEAVY_SHORT) ? "rgba(237,237,240,0.18)" : "rgba(255,255,255,0.06)"}` }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                  <span style={{ color: BRIGHT, fontWeight: 700, fontSize: "14px" }}>{sym}</span>
                  <span style={{ color: sc, fontSize: "10px", letterSpacing: "0.07em", fontWeight: 700 }}>{status}</span>
                </div>

                {/* L/S bar */}
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ display: "flex", height: "6px", borderRadius: "2px", overflow: "hidden", gap: "1px" }}>
                    <div style={{ flex: longPct, background: "#d4d4d8", opacity: ls !== null ? 0.7 : 0.2 }} />
                    <div style={{ flex: shortPct, background: "#52525b", opacity: ls !== null ? 0.9 : 0.2 }} />
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: "3px", fontSize: "10px" }}>
                    <span style={{ color: "#d4d4d8" }}>L {ls !== null ? `${Math.round(longPct * 100)}%` : "—"}</span>
                    <span style={{ color: "#71717a" }}>S {ls !== null ? `${Math.round(shortPct * 100)}%` : "—"}</span>
                  </div>
                </div>

                <div style={{ fontSize: "11px", color: DIM, lineHeight: 1.4 }}>{desc}</div>
                <div style={{ marginTop: "6px", fontSize: "10px", color: MUTED }}>
                  L/S RATIO: <span style={{ color: sc }}>{ls !== null ? ls.toFixed(3) : "—"}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ color: DIM, fontSize: "10px", marginTop: "8px" }}>
          {"// "}MORE ACCOUNTS LONG = ratio above {LS_HEAVY_LONG}; MORE ACCOUNTS SHORT = below {LS_HEAVY_SHORT}. A count of accounts on OKX, not graded.
        </div>
      </Card>

            {/* ── Position Intelligence ───────────────────────────── */}
      <Card style={{ marginBottom: "10px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px", flexWrap: "wrap", gap: "4px" }}>
          <SectionTitle style={{ marginBottom: 0 }}>TOP MARKETS BY OPEN INTEREST</SectionTitle>
          <span style={{ color: DIM, fontSize: "10px" }}>ORDERLY NETWORK · {timestamp || "—"}</span>
        </div>
        {!isMobile && (
          <div style={{ display: "grid", gridTemplateColumns: "70px 90px 80px 80px 1fr", gap: "4px", marginBottom: "4px" }}>
            {["MARKET", "FUNDING 8H", "OI", "OI ÷ VOL", "PAST A LINE"].map(h => (
              <div key={h} style={{ color: DIM, fontSize: "10px", letterSpacing: "0.08em", paddingBottom: "4px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                {h}
              </div>
            ))}
          </div>
        )}
        {topPositions.map(asset => {
          const fl = marketFlag(asset);
          const flag = fl.kind === "NONE" ? "—" : flagLabel(fl.kind);
          return isMobile ? (
            <div key={asset.name} style={{ padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", marginBottom: "2px" }}>
                <span style={{ color: BRIGHT, fontWeight: 700 }}>{asset.name}</span>
                <span style={{ color: fl.kind === "NONE" ? DIM : TEAL, fontSize: "11px", textAlign: "right" }}>{flag}</span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", color: DIM, fontSize: "11px" }}>
                <span>FUND <span style={{ color: MUTED }}>{fmtFunding(asset.funding)}</span></span>
                <span>OI <span style={{ color: MUTED }}>{fmtOI(asset.oi)}</span></span>
                <span>OI÷VOL <span style={{ color: MUTED }}>{fl.ratio.toFixed(1)}×</span></span>
              </div>
            </div>
          ) : (
            <div key={asset.name} style={{ display: "grid", gridTemplateColumns: "70px 90px 80px 80px 1fr", gap: "4px", padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,0.04)", fontSize: "12px", alignItems: "center" }}>
              <div style={{ color: BRIGHT, fontWeight: 700 }}>{asset.name}</div>
              <div style={{ color: MUTED }}>{fmtFunding(asset.funding)}</div>
              <div style={{ color: MUTED }}>{fmtOI(asset.oi)}</div>
              <div style={{ color: MUTED }}>{fl.ratio.toFixed(1)}×</div>
              <div style={{ color: fl.kind === "NONE" ? DIM : TEAL, fontSize: "11px" }}>{flag}</div>
            </div>
          );
        })}
        {topPositions.length === 0 && (
          <div style={{ color: DIM, padding: "20px 0", textAlign: "center", fontSize: "12px" }}>
            {loading ? "Loading Orderly’s markets…" : "Orderly’s market list didn’t load."}
          </div>
        )}
        <div style={{ color: DIM, fontSize: "10px", marginTop: "8px" }}>
          {"// "}LINES: FUNDING ABOVE +0.08% OR BELOW −0.03% PER 8H · OI ABOVE 1.5× (0.9×) 24H VOLUME ON MARKETS TRADING OVER $100K.
        </div>
      </Card>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "4px", color: DIM, fontSize: "10px", letterSpacing: "0.05em", marginTop: "4px" }}>
        <div>DATA: COINGECKO · OKX · ORDERLY NETWORK · ALTERNATIVE.ME</div>
        <div>AUTO-REFRESH: {REFRESH_INTERVAL}s · {countdown}s AGO</div>
      </div>

    </div>
  );
}
