// Public "Wallet X-Ray" — paste any wallet, get its perp record. No login, no
// wallet connect. Acquisition wedge: grade a trader who's never touched our DEX.
//
// TWO SOURCES, DELIBERATELY DIFFERENT DEPTH:
//  • Hyperliquid — public /info `userFillsByTime` (paged forward from genesis via
//    @/utils/hyperliquid) returns a per-TRADE tape, so we can render the full
//    <AnalyticsView> (hold time, timing, streaks, per-trade P&L). The raw
//    `userFills` endpoint caps at ~2,000 recent fills — grading only that slice
//    mislabels whales, so we page and disclose when the tape is still partial.
//    The `portfolio` endpoint splits allTime vs perpAllTime PnL: the HL leaderboard
//    ranks TOTAL PnL, so a wallet can show $445M there with $0 from perps
//    (vault/spot). An empty perp tape + non-perp record gets an explicit message,
//    not the misleading "no trading history".
//  • Orderly (incl. OUR venue) — the public dashboard indexer is keyed by
//    account_id and only exposes per-SYMBOL aggregates; /trades is hash-encoded
//    and /events_v2 is empty. So Orderly gets a venue/market breakdown, NOT the
//    per-trade analytics. Don't "upgrade" it to AnalyticsView — the data isn't there.
//
// ⚠️ This page deliberately uses NO Orderly private hooks — only public APIs and
// our own worker proxy. Keep it that way (see the SWR-key-collision incident).
import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { AnalyticsView } from "@/pages/lab/AnalyticsView";
import { TrackedRecordCard, type XrayTrack } from "@/components/TrackedRecordCard";
import { SectionHeader } from "@/pages/lab/components";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import type { ProcessedTrade } from "@/pages/lab/types";
import { deployDirectiveFromThesis } from "@/utils/agentPrefill";
import { THESIS_DRAFT_KEY } from "@/config/assistantTools";
import { fetchHLFillsPaged, fetchHLPortfolio, fetchHLPositions, HL_FILLS_MAX, type HLFill, type HLPosition } from "@/utils/hyperliquid";
import {
  gradeAllWindows, defaultWindow, decayRow, tradesInWindow, windowComplete, edgeGate, watchedWindow,
  hlCoinToOrderly,
} from "@/lib/xrayGrade.mjs";
import { WindowGradeCard, EdgeGateCard, PositionsPanel, type WindowKey, type WindowGrade, type WatchedWin, type DecayCell, type Gate, type PosRow, WINDOW_KEYS } from "./XrayPanels";

// Shared design tokens — same set the Arena uses, so the two pages read as one system.
const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const AGENT_API = "https://og.nexustradinglabs.com";
const ORDERLY_API = "https://api-evm.orderly.org";
const BONE = "#ededf0";
const POS = "#3ecf8e", NEG = "#f7525f";
const FOG = "#a1a1aa", MUTED = "#71717a", FAINT = "#52525b", BRIGHT = "#f4f4f5";
const BORDER = "#232327", SURFACE = "#141416", SURFACE_ALT = "#0f0f11";

const label: CSSProperties = { fontFamily: MONO, fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase", color: MUTED };

// Board-style section head — mono eyebrow + a hairline rule, mirrors the Arena board.
function SubHead({ title, note }: { title: string; note?: string }) {
  return (
    <>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.22em", color: MUTED }}>{title}</div>
        {note && <div style={{ fontFamily: MONO, fontSize: 9.5, color: FAINT }}>{note}</div>}
      </div>
      <div style={{ height: 1, background: BORDER, margin: "10px 0 14px" }} />
    </>
  );
}

type XraySymbol = {
  sym: string; realized: number; unrealized: number;
  open: boolean; side: "LONG" | "SHORT" | null; szUsd: number; entry: number;
};
type XrayVenue = {
  brokerId: string; accountId: string; isNexus: boolean;
  realized: number; unrealized: number; markets: number; marketsCapped?: boolean; wins: number; losses: number;
  profitableMarketsPct: number; openPositions: number; bySymbol: XraySymbol[];
};
type XrayResult = {
  address: string; venues: XrayVenue[];
  totalRealized: number; totalUnrealized: number; markets: number; brokersChecked: number;
  brokersFailed?: string[]; marketsCapped?: boolean;
};

const usd = (n: number) => {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(2);
  return `${n < 0 ? "-" : ""}$${s}`;
};
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// Shared with the Lab's Smart Money watchlist, ON PURPOSE — starring a wallet
// here makes it show up (and alert) over there. Same key, one list.
const WATCH_KEY = "nexus_sm_watchlist";
const loadWatch = (): string[] => { try { return JSON.parse(localStorage.getItem(WATCH_KEY) || "[]"); } catch { return []; } };

// Orderly-network record for a wallet, across every broker we probe (ours first).
async function fetchOrderlyXray(address: string): Promise<XrayResult> {
  const res = await fetch(`${AGENT_API}/smart/xray?address=${encodeURIComponent(address)}`);
  if (!res.ok) throw new Error(`Orderly x-ray ${res.status}`);
  return res.json();
}

// Public mark prices for every Orderly perp (PERP_<COIN>_USDC → mark). Doubles as the
// LISTED set: a Hyperliquid position is only copyable if its market exists here.
async function fetchOrderlyMarks(): Promise<Record<string, number>> {
  const res = await fetch(`${ORDERLY_API}/v1/public/futures`);
  if (!res.ok) throw new Error(`Orderly futures ${res.status}`);
  const d = await res.json();
  const out: Record<string, number> = {};
  for (const r of (d?.data?.rows ?? []) as Array<{ symbol: string; mark_price?: number | string }>) {
    const m = parseFloat(String(r.mark_price ?? ""));
    if (r.symbol && Number.isFinite(m) && m > 0) out[r.symbol] = m;
  }
  return out;
}

type SeriesPt = { t: number; realized: number };

const isAddress = (s: string) => /^0x[a-fA-F0-9]{40}$/.test(s.trim());

function fillsToTrades(fills: HLFill[]): ProcessedTrade[] {
  return fills
    .filter((f) => /^Close/.test(f.dir) || parseFloat(f.closedPnl || "0") !== 0)
    .map((f) => {
      const pnl = parseFloat(f.closedPnl || "0") - Math.abs(parseFloat(f.fee || "0"));
      const direction: "LONG" | "SHORT" = /Long/.test(f.dir) ? "LONG" : "SHORT";
      return {
        symbol: f.coin,
        direction,
        side: f.side,
        pnl,
        qty: parseFloat(f.sz || "0"),
        price: parseFloat(f.px || "0"),
        timestamp: f.time,
      } as ProcessedTrade;
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

export default function AnalyzePage() {
  const [params, setParams] = useSearchParams();
  const [input, setInput] = useState(params.get("address") ?? "");
  const [address, setAddress] = useState<string | null>(params.get("address"));
  const [trades, setTrades] = useState<ProcessedTrade[] | null>(null);
  const [orderly, setOrderly] = useState<XrayResult | null>(null);
  const [track, setTrack] = useState<XrayTrack | null>(null); // the graded, WATCHED record (settlement deltas over time)
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialTape, setPartialTape] = useState(false); // fills hit HL_FILLS_MAX — oldest history not graded
  const [watch, setWatch] = useState<string[]>(loadWatch);
  const [hlPos, setHlPos] = useState<HLPosition[]>([]);
  const [hlPosFailed, setHlPosFailed] = useState(false);
  const [series, setSeries] = useState<SeriesPt[] | null>(null); // watched Orderly record, daily points
  const [marks, setMarks] = useState<Record<string, number> | null>(null);
  const [win, setWin] = useState<WindowKey | null>(null);        // null = use the default (30D, or ALL fallback)
  const [loadedAt, setLoadedAt] = useState(() => Date.now());
  const navigate = useNavigate();

  const toggleWatch = (addr: string) => {
    setWatch((prev) => {
      const next = prev.includes(addr) ? prev.filter((a) => a !== addr) : [...prev, addr];
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };

  // ⚡ Copy an OPEN position into an agent directive. Same bridge Smart Money uses,
  // so the agent honors the direction verbatim and manages the exit. Default stop
  // 3% / target 6% off the observed entry — the user reviews + edits before arming.
  type CopySrc = { sym: string; side: "LONG" | "SHORT" | null; entry: number; szUsd: number };
  const copyPosition = (s: CopySrc, from: string) => {
    const p = s.entry > 0 ? s.entry : 0;
    const isLong = s.side === "LONG";
    deployDirectiveFromThesis({
      symbol: s.sym,
      direction: s.side === "SHORT" ? "SHORT" : "LONG",
      entryPrice: p,
      stopLoss: p > 0 ? (isLong ? p * 0.97 : p * 1.03) : 0,
      takeProfit1: p > 0 ? (isLong ? p * 1.06 : p * 0.94) : 0,
      source: `XRAY ${short(from)}`,
    }, navigate);
  };

  // ◆ Draft a thesis from the position instead — plan it yourself before automating.
  const draftThesis = (s: CopySrc, from: string) => {
    const p = s.entry > 0 ? s.entry : 0;
    const isLong = s.side === "LONG";
    try {
      localStorage.setItem(THESIS_DRAFT_KEY, JSON.stringify({
        symbol: s.sym,
        direction: s.side,
        entryPrice: p || undefined,
        stopLoss: p > 0 ? Number((isLong ? p * 0.97 : p * 1.03).toFixed(6)) : undefined,
        takeProfit1: p > 0 ? Number((isLong ? p * 1.06 : p * 0.94).toFixed(6)) : undefined,
        notes: `${short(from)} holds ${s.side} ${s.sym} (${usd(s.szUsd)} open) — seen via wallet x-ray.`,
      }));
    } catch { /* ignore */ }
    navigate("/lab?tab=thesis");
  };

  // Three sources in parallel — one failing must never hide the others, so this uses
  // allSettled and only surfaces an error when NEITHER venue returned anything.
  const run = useCallback(async (addr: string) => {
    if (!isAddress(addr)) { setError("Enter a valid 0x… wallet address"); return; }
    setLoading(true); setError(null); setTrades(null); setOrderly(null); setTrack(null); setPartialTape(false);
    setHlPos([]); setHlPosFailed(false); setSeries(null); setWin(null); setLoadedAt(Date.now());
    const [hl, ord, pf] = await Promise.allSettled([fetchHLFillsPaged(addr), fetchOrderlyXray(addr), fetchHLPortfolio(addr)]);
    // Live positions + marks are context, never a blocker — fail-soft, off the critical path.
    fetchHLPositions(addr).then(setHlPos).catch(() => setHlPosFailed(true));
    fetchOrderlyMarks().then(setMarks).catch(() => setMarks({}));

    const fills = hl.status === "fulfilled" ? hl.value.fills : [];
    const t = fillsToTrades(fills);
    setTrades(t);
    setPartialTape(hl.status === "fulfilled" && hl.value.truncated);
    const ox = ord.status === "fulfilled" ? ord.value : null;
    setOrderly(ox);

    // The graded WATCHED record — realized-PnL deltas over the days we've tracked this
    // wallet. It's the HEADLINE (Grok): lifetime totals flatter; the watched number is the
    // grade. Self-seeds on read; fail-soft (leaves the lifetime verdict as the only number).
    fetch(`${AGENT_API}/smart/xray/history?address=${encodeURIComponent(addr)}`)
      .then((r) => r.json()).then((x) => {
        if (x && x.track) setTrack(x.track as XrayTrack);
        if (x && Array.isArray(x.series)) setSeries(x.series as SeriesPt[]);
      })
      .catch(() => { /* no tracked record — lifetime verdict stands */ });

    const hasHL = t.length > 0;
    const hasOrderly = !!ox && ox.venues.length > 0;
    if (!hasHL && !hasOrderly) {
      const portfolio = pf.status === "fulfilled" ? pf.value : null;
      if (hl.status === "rejected" && ord.status === "rejected") {
        setError("Couldn't reach Hyperliquid or Orderly. Try again.");
      } else if (portfolio && portfolio.allTime !== 0 && portfolio.perpAllTime === 0) {
        // Leaderboard-whale case: a real Hyperliquid record, but none of it is perps
        // (vault/spot) — winners AND underwater vault records alike. Say so explicitly
        // instead of the misleading dead-end message.
        setError(
          `No perp tape on this wallet. Hyperliquid shows ${usd(portfolio.allTime)} all-time PnL — all of it non-perp (vault/spot). Nothing to grade.`,
        );
      } else if (portfolio && portfolio.perpAllTime !== 0) {
        // Realized perp PnL exists, so fills must exist too — the fills read failed.
        setError(
          `Hyperliquid shows ${usd(portfolio.perpAllTime)} perp PnL on this wallet, but no fills came back. Try again.`,
        );
      } else if (pf.status === "rejected") {
        // The portfolio read itself failed — don't fall through to the old dead-end
        // message when we simply couldn't verify the record.
        setError("Couldn't verify the full Hyperliquid record right now. Try again.");
      } else {
        setError("No perp trading history found for this wallet on Hyperliquid or the Orderly network.");
      }
    }
    setLoading(false);
  }, []);

  // Auto-run from a shared ?address= link.
  useEffect(() => { if (address && isAddress(address)) run(address); }, [address, run]);

  const submit = () => {
    const addr = input.trim();
    if (!isAddress(addr)) { setError("Enter a valid 0x… wallet address"); return; }
    setAddress(addr);
    setParams({ address: addr });
  };

  // Lifetime HL realized — the verdict's context line. Win rate etc. live per window now.
  const totalPnl = useMemo(() => (trades ? trades.reduce((s, t) => s + t.pnl, 0) : 0), [trades]);

  // ── Time-window grades + the copy gate ─────────────────────────────────────
  // Windows end at loadedAt (the moment the tape was read), so tabs don't drift.
  const grades = useMemo(
    () => (trades && trades.length ? gradeAllWindows(trades, loadedAt) as Record<WindowKey, WindowGrade> : null),
    [trades, loadedAt],
  );
  const dflt = useMemo(() => (grades ? defaultWindow(grades) as { key: WindowKey; fellBack: boolean } : { key: "30D" as WindowKey, fellBack: false }), [grades]);
  const activeWin: WindowKey = win ?? dflt.key;
  const partialKeys = useMemo(() => {
    if (!partialTape || !trades || !trades.length) return [] as WindowKey[];
    const oldestTs = trades[0].timestamp;
    return WINDOW_KEYS.filter((k) => !windowComplete(k, loadedAt, { truncated: true, oldestTs }));
  }, [partialTape, trades, loadedAt]);
  const watchedWins = useMemo(() => {
    if (!series || series.length < 2) return null;
    const out = {} as Record<WindowKey, WatchedWin>;
    for (const k of WINDOW_KEYS) out[k] = watchedWindow(series, k, loadedAt) as WatchedWin;
    return out;
  }, [series, loadedAt]);
  const decay = useMemo(() => (grades ? decayRow(grades) as DecayCell[] : null), [grades]);
  // The gate reads 30D whatever tab is showing — "is the edge alive NOW" decides copy.
  const gate: Gate = useMemo(() => edgeGate({
    hl30: grades ? grades["30D"] : null,
    watched: track && !track.building ? track : null,
  }) as Gate, [grades, track]);
  const windowTrades = useMemo(
    () => (trades && trades.length ? tradesInWindow(trades, activeWin, loadedAt) as ProcessedTrade[] : []),
    [trades, activeWin, loadedAt],
  );
  const activeGrade = grades ? grades[activeWin] : null;

  // Every open position, both venues, one table. Hyperliquid numbers are venue-reported;
  // Orderly's indexer has no leverage/liq → those stay null ("—"), never estimated.
  const posRows: PosRow[] = useMemo(() => {
    const rows: PosRow[] = hlPos.map((p) => {
      const oc = hlCoinToOrderly(p.coin);
      return {
        key: `hl:${p.coin}`, venue: "Hyperliquid", sym: p.coin, side: p.side,
        leverage: p.leverage, entry: p.entry, mark: p.mark, uPnl: p.unrealizedPnl, valueUsd: p.valueUsd,
        liq: p.liquidationPx, liqReported: true,
        copySym: oc && marks && marks[`PERP_${oc}_USDC`] ? oc : null,
      };
    });
    for (const v of orderly?.venues ?? []) {
      for (const s of v.bySymbol) {
        if (!s.open || !s.side) continue;
        rows.push({
          key: `or:${v.brokerId}:${s.sym}`, venue: `Orderly · ${v.brokerId}`, sym: s.sym, side: s.side,
          leverage: null, entry: s.entry, mark: marks?.[`PERP_${s.sym}_USDC`] ?? null, uPnl: s.unrealized, valueUsd: s.szUsd,
          liq: null, liqReported: false, copySym: s.sym,
        });
      }
    }
    return rows.sort((a, b) => b.valueUsd - a.valueUsd);
  }, [hlPos, orderly, marks]);
  const topCopy = gate.pass ? posRows.find((r) => r.copySym) ?? null : null;
  const copyRow = (r: PosRow) => {
    if (!gate.pass || !r.copySym || !address) return; // belt + braces: never copy past a locked gate
    copyPosition({ sym: r.copySym, side: r.side, entry: r.entry, szUsd: r.valueUsd }, address);
  };
  const draftRow = (r: PosRow) => {
    if (!address) return;
    draftThesis({ sym: r.copySym ?? hlCoinToOrderly(r.sym) ?? r.sym, side: r.side, entry: r.entry, szUsd: r.valueUsd }, address);
  };

  const isMobile = useIsMobile();

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: isMobile ? "20px 14px 60px" : "32px 24px 80px", color: BRIGHT }}>
      <SectionHeader
        eyebrow="WALLET X-RAY"
        title="X-ray any trader. Grade the tape."
        note="NO LOGIN · PUBLIC DATA"
      />

      <p style={{ fontFamily: UI, fontSize: 13.5, color: FOG, maxWidth: 640, lineHeight: 1.65, margin: "0 0 22px" }}>
        Paste any wallet. We read its perp record from <b style={{ color: BRIGHT }}>Hyperliquid</b> and
        from the <b style={{ color: BRIGHT }}>Orderly network</b> — including Nexus — straight off
        public data. No login. Then bring your own edge here and prove it on-chain.
      </p>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
          placeholder="0x… any wallet address"
          spellCheck={false}
          style={{
            flex: "1 1 360px", boxSizing: "border-box", background: "#08080a",
            border: `1px solid ${isAddress(input) ? BONE : BORDER}`,
            borderRadius: 4, padding: "10px 12px", color: BRIGHT, fontFamily: MONO, fontSize: 12, outline: "none",
          }}
        />
        <button
          onClick={submit}
          disabled={loading}
          className="nx-btn"
          style={{
            fontFamily: MONO, fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            color: "#0a0a0b", background: BONE, border: "none", borderRadius: 4,
            padding: "11px 20px", cursor: loading ? "default" : "pointer", opacity: loading ? 0.6 : 1,
          }}
        >
          {loading ? "ANALYZING…" : "ANALYZE →"}
        </button>
      </div>

      {error && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: NEG, marginBottom: 16 }}>{error}</div>
      )}

      {loading && (
        <div style={{ fontFamily: MONO, fontSize: 12, color: FOG }}>$ ./xray.sh --wallet {address?.slice(0, 8)}… <span style={{ color: BONE }}>reading hyperliquid + orderly…</span></div>
      )}

      {/* ── X-RAY VERDICT ── one-glance authoritative read that synthesizes BOTH
          sources (Hyperliquid tape + Orderly indexer) the moment results land, so a
          pasted wallet gives an immediate verdict instead of a wall of tables. */}
      {!loading && address && ((trades && trades.length > 0) || (orderly && orderly.venues.length > 0)) && (() => {
        const hlPnl = trades && trades.length ? totalPnl : 0;
        const orRealized = orderly ? orderly.totalRealized : 0;
        const combined = hlPnl + orRealized;
        const markets = orderly?.markets ?? 0;
        const openNow = posRows.length;
        const profitablePct = orderly && orderly.venues.length
          ? Math.round(orderly.venues.reduce((a, v) => a + v.profitableMarketsPct, 0) / orderly.venues.length) : null;
        const good = combined >= 0;
        // The WATCHED grade is the headline (Grok): realized-PnL over the days we've tracked
        // this wallet. Lifetime flatters; the watched number is what can't be faked. When we
        // have a real tracked window it leads and colors the whole verdict; lifetime demotes.
        const hasWatched = !!track && !track.building && typeof track.netRealized === "number" && (track.daysTracked ?? 0) > 0;
        const wNet = track?.netRealized ?? 0;
        const wGood = wNet >= 0;
        const srcs = [trades && trades.length ? "Hyperliquid" : null, orderly && orderly.venues.length ? "Orderly" : null].filter(Boolean).join(" + ");
        const stats = ([
          trades && trades.length ? { l: "HL TRADES · ALL", v: String(trades.length), c: BRIGHT } : null,
          markets ? { l: "MARKETS", v: orderly?.marketsCapped ? `${markets}+` : String(markets), c: BRIGHT } : null,
          profitablePct != null ? { l: "PROFITABLE MKTS", v: `${profitablePct}%`, c: BRIGHT } : null,
          { l: "OPEN NOW", v: String(openNow), c: openNow ? BRIGHT : FAINT },
        ].filter(Boolean)) as { l: string; v: string; c: string }[];
        return (
          <div className="nx-fade-in" style={{ border: `1px solid ${BORDER}`, borderLeft: `3px solid ${(hasWatched ? wGood : good) ? POS : NEG}`, borderRadius: 8, background: SURFACE_ALT, padding: "18px 20px", marginBottom: 22 }}>
            <div style={{ ...label, marginBottom: 12 }}>◆ X-RAY VERDICT · {short(address)}</div>
            {hasWatched ? (
              // Watched grade leads; lifetime is a demoted context line beneath it (Grok).
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: UI, fontSize: 24, fontWeight: 700, color: wGood ? POS : NEG, letterSpacing: "-0.01em" }}>{wGood ? "Net positive while watched" : "Underwater while watched"}</span>
                  <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: wGood ? POS : NEG }}>{wNet >= 0 ? "+" : ""}{usd(wNet)}</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>the grade · {track!.daysTracked}d tracked{track!.winWindowRate != null ? ` · ${track!.winWindowRate}% green days` : ""}</span>
                </div>
                <span style={{ fontFamily: MONO, fontSize: 10, color: FAINT }}>lifetime {combined >= 0 ? "+" : ""}{usd(combined)} realized · {srcs} · all-time, context only</span>
              </div>
            ) : (
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, flexWrap: "wrap", marginBottom: 16 }}>
                <span style={{ fontFamily: UI, fontSize: 24, fontWeight: 700, color: good ? POS : NEG, letterSpacing: "-0.01em" }}>{good ? "Net profitable" : "Underwater"}</span>
                <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: good ? POS : NEG }}>{usd(combined)}</span>
                <span style={{ fontFamily: MONO, fontSize: 10, color: MUTED }}>
                  {partialTape ? `partial tape · most recent ${(trades?.length ?? HL_FILLS_MAX).toLocaleString()} fills · ` : "all-time realized · "}{srcs}
                  {orderly?.marketsCapped ? " · Orderly markets capped at 100/venue" : ""}
                </span>
              </div>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))", gap: 12 }}>
              {stats.map((s) => (
                <div key={s.l}>
                  <div style={{ ...label, fontSize: 8, letterSpacing: "0.12em" }}>{s.l}</div>
                  <div style={{ fontFamily: MONO, fontSize: 16, fontWeight: 700, color: s.c, marginTop: 2 }}>{s.v}</div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── THE GRADE BY WINDOW → the gated CTA → live positions ─────────────────
          The window grade answers "is this edge still alive"; the CTA sits right
          under it and only opens when the 30D record clears the bar (xrayGrade.mjs). */}
      {!loading && address && ((trades && trades.length > 0) || (orderly && orderly.venues.length > 0)) && (
        <>
          <WindowGradeCard
            hasTape={!!trades && trades.length > 0}
            grades={grades}
            active={activeWin}
            onPick={setWin}
            fellBack={dflt.fellBack && win == null}
            partialKeys={partialKeys}
            watched={watchedWins}
            decay={decay}
          />
          <EdgeGateCard gate={gate}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {gate.pass && topCopy && (
                <button onClick={() => copyRow(topCopy)} className="nx-btn"
                  title="Load this position into your agent as a directive — you review and arm it; nothing executes from here"
                  style={{ background: BONE, color: "#0a0a0b", border: "none", borderRadius: 4, padding: "10px 18px", fontFamily: MONO, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em", cursor: "pointer" }}>
                  ⚡ COPY {topCopy.side} {topCopy.copySym} →
                </button>
              )}
              {gate.pass && !topCopy && (
                <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>No open position to copy right now — watch it to catch the next one.</span>
              )}
              <button
                onClick={() => toggleWatch(address)}
                title={watch.includes(address) ? "Remove from your Smart Money watchlist" : "Track this wallet in Smart Money — its record keeps accruing"}
                style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer", fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", padding: "9px 14px", color: watch.includes(address) ? BONE : MUTED }}
              >
                {watch.includes(address) ? "★ WATCHING" : "☆ WATCH"}
              </button>
            </div>
          </EdgeGateCard>
          <PositionsPanel
            rows={posRows}
            gatePass={gate.pass}
            onCopy={copyRow}
            onDraft={draftRow}
            hlFailed={hlPosFailed}
            hasOrderly={posRows.some((r) => !r.liqReported)}
          />
        </>
      )}

      {trades && trades.length > 0 && (
        <div className="nx-fade-in">
          <div style={{ fontFamily: MONO, fontSize: 11, color: FOG, marginBottom: 10 }}>
            <span style={{ color: BONE }}>{windowTrades.length}</span> closed perp trades · {activeWin} · source: Hyperliquid · {address?.slice(0, 6)}…{address?.slice(-4)}
            {partialTape && (
              <span style={{ color: MUTED }}> · partial tape — history exceeds the {HL_FILLS_MAX.toLocaleString()}-fill paging budget; grading the most recent {trades.length.toLocaleString()}</span>
            )}
          </div>
          {/* Same grading code, fills filtered to the window. Below the window's minimum
              there's no analytics grade to show — the tab reads ACCRUING above. */}
          {activeGrade && activeGrade.status === "GRADED" ? (
            <AnalyticsView orders={windowTrades} totalPnl={activeGrade.net} winRate={activeGrade.winRate ?? 0} collateral={0} />
          ) : (
            <div style={{ fontFamily: MONO, fontSize: 11, color: MUTED, padding: "14px 16px", border: `1px dashed ${BORDER}`, borderRadius: 6 }}>
              Full analytics unlock once {activeWin} has {activeGrade?.min ?? 20} closed trades ({activeGrade?.trades ?? 0} so far). Try a wider window.
            </div>
          )}
          <div style={{ marginTop: 24, padding: "16px 18px", border: `1px solid ${BORDER}`, borderRadius: 6, background: SURFACE_ALT, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ fontFamily: UI, fontSize: 13, color: BRIGHT }}>Like what you see? Build a track record nobody can fake.</div>
            <a href="/lab" className="nx-btn" style={{ background: BONE, color: "#0a0a0b", textDecoration: "none", borderRadius: 4, padding: "10px 20px", fontFamily: MONO, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em" }}>OPEN THE LAB →</a>
          </div>
        </div>
      )}

      {/* ── ORDERLY NETWORK RECORD ─────────────────────────────────────────────
          Per-market aggregates from the public dashboard indexer, resolved by a
          DERIVED account_id per broker (see worker /smart/xray). Deliberately not
          fed into <AnalyticsView>: there's no per-trade tape behind it. */}
      {orderly && orderly.venues.length > 0 && (
        <div className="nx-fade-in" style={{ marginTop: trades && trades.length ? 34 : 8 }}>
          <SubHead title="ORDERLY NETWORK RECORD" note="PUBLIC INDEXER" />
          <p style={{ fontFamily: UI, fontSize: 12.5, color: MUTED, lineHeight: 1.6, margin: "0 0 16px", maxWidth: 680 }}>
            Settled on-chain, read from Orderly&apos;s public indexer — found on{" "}
            <b style={{ color: BRIGHT }}>{orderly.venues.length}</b> of {orderly.brokersChecked} venues probed
            {orderly.brokersFailed && orderly.brokersFailed.length > 0 && (
              <> · <b style={{ color: BRIGHT }}>{orderly.brokersFailed.length}</b> failed to read ({orderly.brokersFailed.join(", ")})</>
            )}
            {orderly.marketsCapped && (
              <> · per-venue market list capped at 100 — totals may understate</>
            )}.
            These are per-market totals; Orderly doesn&apos;t publish a per-trade tape, so the
            hold-time and timing analytics above stay Hyperliquid-only.
          </p>

          {/* The accruing, self-grading record over time (Consistency Score + copy record) */}
          {address && <TrackedRecordCard address={address} />}

          {orderly.venues.map((v) => (
            <div key={v.brokerId} style={{ border: `1px solid ${BORDER}`, borderLeft: v.isNexus ? `3px solid ${BONE}` : `1px solid ${BORDER}`, borderRadius: 6, background: SURFACE_ALT, padding: "14px 16px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                <span style={{ fontFamily: MONO, fontSize: 13, color: BRIGHT, fontWeight: 700, letterSpacing: "0.04em" }}>{v.brokerId}</span>
                {v.isNexus && (
                  <span style={{ fontFamily: MONO, fontSize: 8, letterSpacing: "0.1em", color: "#0a0a0b", background: BONE, borderRadius: 3, padding: "2px 6px", fontWeight: 700 }}>THIS IS NEXUS</span>
                )}
                <span title={v.accountId} style={{ fontFamily: MONO, fontSize: 9, color: FAINT, marginLeft: "auto" }}>
                  acct {v.accountId.slice(0, 10)}…{v.accountId.slice(-6)}
                </span>
                <button
                  onClick={() => toggleWatch(orderly.address)}
                  title={watch.includes(orderly.address) ? "Remove from your Smart Money watchlist" : "Track this wallet in Smart Money"}
                  style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 3, cursor: "pointer", fontFamily: MONO, fontSize: 9, letterSpacing: "0.05em", padding: "3px 8px", color: watch.includes(orderly.address) ? BONE : MUTED }}
                >
                  {watch.includes(orderly.address) ? "★ WATCHING" : "☆ WATCH"}
                </button>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10, marginBottom: 12 }}>
                {[
                  { l: "REALIZED", v: usd(v.realized), c: v.realized >= 0 ? POS : NEG },
                  { l: "UNREALIZED", v: v.unrealized ? usd(v.unrealized) : "—", c: v.unrealized === 0 ? FAINT : v.unrealized > 0 ? POS : NEG },
                  { l: "MARKETS", v: v.marketsCapped ? `${v.markets}+` : String(v.markets), c: BRIGHT },
                  { l: "PROFITABLE MKTS", v: `${v.profitableMarketsPct}%`, c: BRIGHT },
                  { l: "OPEN NOW", v: String(v.openPositions), c: v.openPositions ? BRIGHT : FAINT },
                ].map(({ l, v: val, c }) => (
                  <div key={l}>
                    <div style={{ ...label, fontSize: 8, letterSpacing: "0.12em" }}>{l}</div>
                    <div style={{ fontFamily: MONO, fontSize: 15, color: c, fontWeight: 600, marginTop: 2 }}>{val}</div>
                  </div>
                ))}
              </div>

              {/* Columns total ~474px of minWidth — wider than a phone card, so the
                  container SCROLLS instead of clipping the right-hand columns off. */}
              <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 8, overflowX: "auto" }}>
                {v.bySymbol.slice(0, 12).map((s) => (
                  <div key={s.sym} style={{ display: "flex", alignItems: "center", gap: 10, padding: "5px 0", fontFamily: MONO, fontSize: 11, minWidth: 474 }}>
                    <span style={{ color: BRIGHT, flex: "1 1 70px", minWidth: 70 }}>{s.sym}</span>
                    <span style={{ color: s.realized >= 0 ? POS : NEG, flex: "1 1 90px", minWidth: 90, textAlign: "right" }}>{usd(s.realized)}</span>
                    <span style={{ color: FAINT, flex: "1 1 120px", minWidth: 120, textAlign: "right" }}>
                      {s.open && s.side ? `${s.side === "LONG" ? "↑" : "↓"} ${usd(s.szUsd)} open` : ""}
                    </span>
                    <span style={{ color: s.open ? (s.unrealized >= 0 ? POS : NEG) : FAINT, flex: "1 1 90px", minWidth: 90, textAlign: "right" }}>
                      {s.open && s.unrealized ? `${s.unrealized >= 0 ? "+" : ""}${usd(s.unrealized)}` : ""}
                    </span>
                    {/* Actions only on LIVE positions — a closed market has nothing to copy. */}
                    <span style={{ display: "flex", gap: 5, flexShrink: 0, minWidth: 104, justifyContent: "flex-end" }}>
                      {s.open && s.side && (
                        <>
                          <button onClick={() => draftThesis(s, orderly.address)} title="Draft a thesis from this position"
                            style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 3, color: MUTED, fontFamily: MONO, fontSize: 9, padding: "2px 7px", cursor: "pointer" }}>◆</button>
                          {/* Gated: never one-tap copy a wallet whose grade hasn't cleared the bar. */}
                          {gate.pass ? (
                            <button onClick={() => { if (gate.pass) copyPosition(s, orderly.address); }} className="nx-btn" title="Copy this position — the agent enters your direction, manages the exit, and grades it on-chain"
                              style={{ background: "none", border: `1px solid ${BORDER}`, borderRadius: 3, color: BONE, fontFamily: MONO, fontSize: 9, letterSpacing: "0.04em", padding: "2px 7px", cursor: "pointer", whiteSpace: "nowrap" }}>⚡ COPY</button>
                          ) : (
                            <span title="Copy locked — the wallet's grade hasn't cleared the bar (see the gate above)" style={{ color: FAINT, fontSize: 9, padding: "2px 4px" }}>🔒</span>
                          )}
                        </>
                      )}
                    </span>
                  </div>
                ))}
                {v.bySymbol.length > 12 && (
                  <div style={{ fontFamily: MONO, fontSize: 10, color: FAINT, paddingTop: 6 }}>+{v.bySymbol.length - 12} more markets</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Cross-verify on Orderly — the trustless bridge. Shows for any valid address
          (even with no Hyperliquid history), deep-linking the wallet into Orderly's
          official explorer (trades, deposits/withdrawals, liquidations, PnL). */}
      {address && isAddress(address) && !loading && (
        <div style={{ marginTop: trades && trades.length ? 24 : 28, padding: "16px 18px", border: `1px solid ${BORDER}`, borderRadius: 6, background: SURFACE_ALT }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.22em", color: MUTED, marginBottom: 10 }}>CROSS-VERIFY ON ORDERLY</div>
          <p style={{ fontFamily: UI, fontSize: 12.5, color: FOG, lineHeight: 1.6, margin: "0 0 14px", maxWidth: 640 }}>
            Nexus runs on <b style={{ color: BRIGHT }}>Orderly Network</b>&apos;s omnichain liquidity. Don&apos;t trust our
            numbers — independently verify this wallet&apos;s on-chain trading (executed trades, deposits &amp;
            withdrawals, liquidations, realized PnL) on Orderly&apos;s official explorer.
          </p>
          <a
            href={`https://orderly-dashboard.orderly.network/explorer?q=${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="nx-btn"
            style={{ display: "inline-block", background: SURFACE, color: BRIGHT, border: `1px solid ${BORDER}`, textDecoration: "none", borderRadius: 4, padding: "10px 18px", fontFamily: MONO, fontWeight: 700, fontSize: 11, letterSpacing: "0.08em" }}
          >
            VERIFY {address.slice(0, 6)}…{address.slice(-4)} ON ORDERLY ↗
          </a>
        </div>
      )}
    </div>
  );
}
