// Analytics tab + its charts/sections (your record, where the money goes, breakdowns,
// top assets, performance). Extracted from index.tsx (god-file split).
// Rules (oldest → newest rows, signed dollars, peak hours gated by sample, weekday/weekend, the 500 cap) live in
// app/lib/analyticsRules.mjs + app/lib/tradeLog.mjs (tested). Green/red only on money that won or lost.
import { useMemo } from "react";
import type { ProcessedTrade, ThesisTrade } from "./types";
import { cardStyle, labelStyle } from "./styles";
import { ProcessSection, PlanAdherenceCard } from "./ProcessView";
import { OperatorProfileCard } from "./OperatorProfile";
import { WalletRiskCard } from "@/components/RiskRecordCard";
import { TrackedRecordCard } from "@/components/TrackedRecordCard";
import { formatPnl, formatPnlCompact, formatUsdCompact } from "./helpers";
import { PnlChart, PnlBars, EmptyState, CountUp, SectionHeader } from "./components";
import { YourRecordCard, MoneyGoesCard, LensRecordCard } from "./StatsCards";
import { Collapsible } from "./Collapsible";
import { useIsMobile } from "./useIsMobile";
import { computeEdge } from "@/config/edge";
import { bucketBars } from "@/lib/chartThin.mjs";
import { bareTicker } from "@/utils/utils";
import { chronological, perfRows, peakHours, weekSplit, wonWords, signed } from "@/lib/analyticsRules.mjs";
import { coverageLine } from "@/lib/tradeLog.mjs";
import { SLICE_MIN_TRADES } from "@/lib/tradeStats.mjs";

// ─── Breakdown Row ────────────────────────────────────────
function BreakdownRow({ orders }: { orders: ProcessedTrade[] }) {
  const isMobile = useIsMobile();
  const holdTime = useMemo(() => {
    const buckets = [
      { label: "<1h", maxMs: 3600000, pnl: 0, count: 0, wins: 0 },
      { label: "1-4h", maxMs: 14400000, pnl: 0, count: 0, wins: 0 },
      { label: "4-12h", maxMs: 43200000, pnl: 0, count: 0, wins: 0 },
      { label: "12-24h", maxMs: 86400000, pnl: 0, count: 0, wins: 0 },
      { label: "1-3d", maxMs: 259200000, pnl: 0, count: 0, wins: 0 },
      { label: "3d+", maxMs: Infinity, pnl: 0, count: 0, wins: 0 },
    ];
    orders.forEach((o) => {
      if (!o.openTimestamp || !o.timestamp) return;
      const held = o.timestamp - o.openTimestamp;
      const bucket = buckets.find((b, i) => {
        const prev = i === 0 ? 0 : buckets[i - 1].maxMs;
        return held >= prev && held < b.maxMs;
      });
      if (bucket) { bucket.count++; bucket.pnl += o.pnl; if (o.pnl > 0) bucket.wins++; }
    });
    return buckets;
  }, [orders]);

  const weekday = useMemo(() => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const data = days.map((d) => ({ label: d, trades: 0, wins: 0, pnl: 0 }));
    orders.forEach((o) => {
      const day = new Date(o.timestamp).getDay();
      data[day].trades++; data[day].pnl += o.pnl;
      if (o.pnl > 0) data[day].wins++;
    });
    // Weekend win rate used to paint anything above 0% green and print "0.0%" with no weekend trades.
    return { days: data, split: weekSplit(orders) };
  }, [orders]);

  const leverage = useMemo(() => {
    const levsWithData = orders.filter((o) => o.leverage && o.leverage > 0);
    const avgLev = levsWithData.length ? levsWithData.reduce((s, o) => s + (o.leverage ?? 0), 0) / levsWithData.length : 0;
    const buckets = [
      { label: "1-5x", min: 1, max: 5, trades: 0, wins: 0, pnl: 0 },
      { label: "5-10x", min: 5, max: 10, trades: 0, wins: 0, pnl: 0 },
      { label: "10-25x", min: 10, max: 25, trades: 0, wins: 0, pnl: 0 },
      { label: "25-50x", min: 25, max: 50, trades: 0, wins: 0, pnl: 0 },
      { label: "50x+", min: 50, max: Infinity, trades: 0, wins: 0, pnl: 0 },
    ];
    levsWithData.forEach((o) => {
      const b = buckets.find((b) => (o.leverage ?? 0) >= b.min && (o.leverage ?? 0) < b.max);
      if (b) { b.trades++; b.pnl += o.pnl; if (o.pnl > 0) b.wins++; }
    });
    return { buckets: buckets.filter((b) => b.trades > 0), avgLev: avgLev.toFixed(1) };
  }, [orders]);

  const maxDayTrades = Math.max(...weekday.days.map((d) => d.trades), 1);

  return (
    <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 8 }}>
      <div style={cardStyle}>
        <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "var(--nx-font-mono)" }}>&#9632; HOLD TIME</div>
        {holdTime.map((b) => (
          <div key={b.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
            <div style={{ fontSize: 10, color: "#52525b", fontFamily: "var(--nx-font-mono)", width: 40 }}>{b.label}</div>
            <div style={{ flex: 1, height: 20, background: "#0a0a0b", borderRadius: 3, overflow: "hidden" }}>
              {b.count > 0 && (
                <div style={{ height: "100%", background: "#33333a", width: `${(b.count / orders.length) * 100}%`, display: "flex", alignItems: "center", paddingLeft: 6 }}>
                  <span style={{ fontSize: 9, color: "#ededf0", fontFamily: "var(--nx-font-mono)" }}>{b.count} ({Math.round((b.count / orders.length) * 100)}%)</span>
                </div>
              )}
            </div>
            <div style={{ fontSize: 10, color: !b.count ? "#71717a" : b.pnl > 0 ? "#3ecf8e" : b.pnl < 0 ? "#f7525f" : "#a1a1aa", fontFamily: "var(--nx-font-mono)", minWidth: 64, textAlign: "right", whiteSpace: "nowrap" }}>
              {b.count > 0 ? formatPnl(b.pnl) : "—"}
            </div>
          </div>
        ))}
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "var(--nx-font-mono)" }}>&#9632; WEEKDAY BREAKDOWN</div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 80, marginBottom: 12 }}>
          {weekday.days.map((d) => (
            <div key={d.label} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              {d.trades > 0 && <div style={{ fontSize: 8, color: "#ededf0", fontFamily: "var(--nx-font-mono)" }}>{Math.round((d.wins / d.trades) * 100)}%</div>}
              <div style={{ width: "100%", height: d.trades > 0 ? `${(d.trades / maxDayTrades) * 60}px` : "4px", background: d.trades > 0 ? "#33333a" : "#141416", borderRadius: 3, border: "1px solid #232327" }} />
              <div style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>{d.label}</div>
            </div>
          ))}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          {([["WEEKDAYS", weekday.split.weekday], ["WEEKENDS", weekday.split.weekend]] as const).map(([label, p], i) => (
            <div key={label} style={{ textAlign: i ? "right" : "left", minWidth: 0 }}>
              <div style={{ fontSize: 9, color: "#71717a", fontFamily: "var(--nx-font-mono)", letterSpacing: "0.16em" }}>{label}</div>
              <div style={{ fontSize: 16, color: "#ededf0", fontFamily: "var(--nx-font-mono)" }}>{p.winRate == null ? "—" : `${p.winRate}% won`}</div>
              <div style={{ fontSize: 10, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)" }}>{p.trades} {p.trades === 1 ? "trade" : "trades"}{p.trades ? <> · <span style={{ color: p.pnl > 0 ? "#3ecf8e" : p.pnl < 0 ? "#f7525f" : "#a1a1aa" }}>{signed(p.pnl)}</span></> : null}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={cardStyle}>
        <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "var(--nx-font-mono)" }}>&#9632; LEVERAGE ANALYSIS</div>
        {leverage.buckets.length === 0
          ? <div style={{ fontSize: 11, color: "#71717a", fontFamily: "var(--nx-font-mono)" }}>no leverage data available</div>
          : leverage.buckets.map((b) => (
            <div key={b.label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: "#fff", fontFamily: "var(--nx-font-mono)" }}>{b.label}</span>
                <span style={{ fontSize: 10, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>{b.trades} trades {b.trades ? `${Math.round((b.wins / b.trades) * 100)}%` : ""}</span>
              </div>
              <div style={{ height: 4, background: "#232327", borderRadius: 2 }}>
                <div style={{ height: 4, background: "#71717a", borderRadius: 2, width: `${(b.trades / orders.length) * 100}%` }} />
              </div>
              <div style={{ fontSize: 10, color: b.pnl >= 0 ? "#3ecf8e" : "#f7525f", fontFamily: "var(--nx-font-mono)", marginTop: 3 }}>{formatPnl(b.pnl)}</div>
            </div>
          ))
        }
        <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px solid #232327", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>AVG LEVERAGE</span>
          <span style={{ fontSize: 16, color: "#ededf0", fontFamily: "var(--nx-font-mono)" }}>{leverage.avgLev}x</span>
        </div>
      </div>
    </div>
  );
}

// ─── Top Assets ───────────────────────────────────────────
function TopAssets({ orders }: { orders: ProcessedTrade[] }) {
  const assets = useMemo(() => {
    const map: Record<string, { pnl: number; trades: number; wins: number }> = {};
    orders.forEach((o) => {
      const sym = bareTicker(o.symbol);
      if (!map[sym]) map[sym] = { pnl: 0, trades: 0, wins: 0 };
      map[sym].pnl += o.pnl; map[sym].trades++;
      if (o.pnl > 0) map[sym].wins++;
    });
    return Object.entries(map).sort((a, b) => Math.abs(b[1].pnl) - Math.abs(a[1].pnl)).slice(0, 6);
  }, [orders]);

  if (!assets.length) return null;

  return (
    <div style={{ ...cardStyle, marginTop: 8 }}>
      <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "var(--nx-font-mono)" }}>&#9632; TOP ASSETS</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: 8 }}>
        {assets.map(([sym, data]) => {
          const wr = Math.round((data.wins / data.trades) * 100);
          return (
            <div key={sym} style={{ background: "#0a0a0b", border: "1px solid #232327", borderRadius: 6, padding: "10px 12px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, color: "#fff", fontWeight: "bold", fontFamily: "var(--nx-font-mono)" }}>{sym}</span>
                <span style={{ fontSize: 10, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)" }}>{data.trades} {data.trades === 1 ? "trade" : "trades"}</span>
              </div>
              <div style={{ fontSize: 16, color: data.pnl >= 0 ? "#3ecf8e" : "#f7525f", fontFamily: "var(--nx-font-mono)", fontWeight: "bold", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{formatPnlCompact(data.pnl)}</div>
              <div style={{ fontSize: 10, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)" }}>{wr}% won</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Timing (streaks, peak hours) ─
// Sharpe / Sortino are gone (2026-11-26): dollar P&L of trades with different sizes and gaps isn't an evenly spaced
// return series, and YOUR RECORD above already carries expectancy, profit factor, payoff and drawdown. Peak hours
// rank only hours with enough trades, by net dollars (analyticsRules.mjs peakHours); the strip shows how many trades
// each hour holds, in ink.
function TimingAndRisk({ orders }: { orders: ProcessedTrade[] }) {
  const isMobile = useIsMobile();
  const stats = useMemo(() => {
    if (!orders.length) return null;
    const sorted = [...orders].sort((a, b) => a.timestamp - b.timestamp);
    let run = 0, sign = 0, bestWin = 0, worstLoss = 0;
    for (const o of sorted) {
      const s = o.pnl > 0 ? 1 : o.pnl < 0 ? -1 : 0;
      if (s === 0) continue;
      if (s === sign) run += 1; else { sign = s; run = 1; }
      if (sign === 1) bestWin = Math.max(bestWin, run);
      if (sign === -1) worstLoss = Math.max(worstLoss, run);
    }
    const current = run * sign; // signed: + win streak, - loss streak
    const { hours, peak, thin } = peakHours(orders);
    return { current, bestWin, worstLoss, hours, peak, thin };
  }, [orders]);

  if (!stats) return null;
  const maxHourTrades = Math.max(...stats.hours.map((h) => h.trades), 1);
  const fmtHr = (h: number) => `${String(h).padStart(2, "0")}:00`;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginTop: 8 }}>
      {/* Streaks */}
      <div style={cardStyle}>
        <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 14, fontFamily: "var(--nx-font-mono)" }}>&#9632; STREAKS</div>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>CURRENT</div>
          <div style={{ fontSize: 28, fontWeight: "bold", fontFamily: "var(--nx-font-mono)", color: stats.current >= 0 ? "#3ecf8e" : "#f7525f" }}>
            {Math.abs(stats.current)} {stats.current >= 0 ? "W" : "L"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>BEST WIN</div>
            <div style={{ fontSize: 18, color: "#ededf0", fontFamily: "var(--nx-font-mono)" }}>{stats.bestWin}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>WORST LOSS</div>
            <div style={{ fontSize: 18, color: "#f7525f", fontFamily: "var(--nx-font-mono)" }}>{stats.worstLoss}</div>
          </div>
        </div>
      </div>

      {/* Peak hours + heatmap */}
      <div style={{ ...cardStyle, gridColumn: isMobile ? "auto" : "span 2" }}>
        <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 12, fontFamily: "var(--nx-font-mono)" }}>&#9632; BEST HOURS <span style={{ color: "#71717a" }}>(close time, local · ≥ {SLICE_MIN_TRADES} trades, by net $)</span></div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(24, 1fr)", gap: 2, marginBottom: 12 }}>
          {stats.hours.map((b) => {
            const wr = b.trades ? Math.round((b.wins / b.trades) * 100) : 0;
            return (
              <div key={b.h} title={`${fmtHr(b.h)}. ${b.trades} trades, ${wr}% won, ${signed(b.pnl)}`} style={{
                height: 22, borderRadius: 2, background: b.trades ? "#a1a1aa" : "#141416",
                border: "1px solid #141416", opacity: b.trades ? Math.max(0.15, b.trades / maxHourTrades) : 1,
              }} />
            );
          })}
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {stats.peak.length === 0
            ? <span style={{ fontSize: 11, color: "#a1a1aa", fontFamily: "var(--nx-font-ui)", lineHeight: 1.5 }}>{stats.thin ? `No hour has ${SLICE_MIN_TRADES} trades yet, so none is named. The strip shows where your trades closed.` : "No hour with enough trades made money."}</span>
            : stats.peak.map((b) => (
              <div key={b.h} style={{ background: "#141416", border: "1px solid #232327", borderRadius: 6, padding: "6px 10px" }}>
                <div style={{ fontSize: 12, color: "#fff", fontFamily: "var(--nx-font-mono)" }}>{fmtHr(b.h)}-{fmtHr((b.h + 1) % 24)}</div>
                <div style={{ fontSize: 9, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)" }}>{wonWords(b.wins, b.trades)} · <span style={{ color: "#3ecf8e" }}>{signed(b.pnl)}</span></div>
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

// ─── Analytics View ──────────────────────────────────────
// ─── Your Edge — the makes-you-a-better-trader synthesis ─────────────────────
// Turns the user's OWN realized record into a coach's read (strongest/weakest
// symbol, long-vs-short, ready strengths/leaks) via the shared computeEdge, and
// hands it to the copilot for the human synthesis. Same edge the get_my_edge tool
// reads — one source of truth. Renders nothing until there are closed trades.
function YourEdgeCard({ orders }: { orders: ProcessedTrade[] }) {
  const isMobile = useIsMobile();
  const edge = useMemo(
    () => computeEdge(orders.map((o) => ({ symbol: o.symbol, pnl: o.pnl, side: o.side || o.direction }))),
    [orders]
  );
  if (!edge) return null;
  const { by_side, best_symbol, worst_symbol, better_side, sample_note } = edge;

  const symTile = (title: string, s: typeof best_symbol, tone: "pos" | "neg") => (
    <div style={{ flex: 1, minWidth: 0, border: "1px solid #232327", borderRadius: 6, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, color: "#52525b", letterSpacing: "0.08em", fontFamily: "var(--nx-font-mono)" }}>{title}</div>
      {s ? (
        <>
          <div style={{ fontSize: 18, color: "#f4f4f5", fontFamily: "var(--nx-font-mono)", marginTop: 2 }}>{s.symbol}</div>
          <div style={{ fontSize: 11, color: tone === "pos" ? "#3ecf8e" : "#f7525f", fontFamily: "var(--nx-font-mono)", marginTop: 2 }}>
            {s.winRatePct}% · {formatPnlCompact(s.pnl)} · {s.trades} trades
          </div>
        </>
      ) : <div style={{ fontSize: 13, color: "#52525b", fontFamily: "var(--nx-font-mono)", marginTop: 4 }}>—</div>}
    </div>
  );

  const sideTile = (label: "LONG" | "SHORT") => {
    const se = by_side[label];
    const on = better_side === label && se.trades > 0;
    return (
      <div style={{ flex: 1, minWidth: 0, border: `1px solid ${on ? "#33333a" : "#232327"}`, borderRadius: 6, padding: "10px 12px", background: on ? "rgba(237,237,240,0.03)" : "transparent" }}>
        <div style={{ fontSize: 9, color: on ? "#ededf0" : "#52525b", letterSpacing: "0.08em", fontFamily: "var(--nx-font-mono)" }}>{label}{on ? " ◂ stronger" : ""}</div>
        <div style={{ fontSize: 18, color: "#f4f4f5", fontFamily: "var(--nx-font-mono)", marginTop: 2 }}>{se.trades ? `${se.winRatePct}%` : "—"}</div>
        <div style={{ fontSize: 11, color: se.pnl >= 0 ? "#3ecf8e" : "#f7525f", fontFamily: "var(--nx-font-mono)", marginTop: 2 }}>{se.trades ? `${formatPnlCompact(se.pnl)} · ${se.trades} trades` : "no data"}</div>
      </div>
    );
  };

  return (
    <div className="nx-fade-in nx-spotlight" style={{ ...cardStyle, marginBottom: 8 }}>
      <div style={labelStyle}>&#9670; WHERE YOU DO BEST</div>
      <div style={{ fontSize: 10, color: "#71717a", fontFamily: "var(--nx-font-mono)", marginTop: -2, marginBottom: 10 }}>where you actually make money. From your own closed trades</div>
      <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: 8, marginBottom: 8 }}>
        {symTile("STRONGEST SYMBOL", best_symbol, "pos")}
        {symTile("WEAKEST SYMBOL", worst_symbol, "neg")}
        {sideTile("LONG")}
        {sideTile("SHORT")}
      </div>
      {/* The strengths / leaks list lived here too, on a 3-trade floor, and could disagree with WHERE THE MONEY GOES
          below (5 trades, deduped). One list now: that card. */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 10 }}>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("nexus:assistant-ask", { detail: { prompt: "Use get_my_edge. Break down my edge, tell me exactly what to trade more of, what to cut, and how to fix my weak spots." } }))}
          style={{ background: "transparent", border: "1px solid #232327", borderRadius: 6, color: "#a1a1aa", fontFamily: "var(--nx-font-ui)", fontSize: 12.5, padding: "7px 11px", cursor: "pointer" }}
          onMouseEnter={(e) => { e.currentTarget.style.color = "#ededf0"; e.currentTarget.style.borderColor = "#33333a"; }}
          onMouseLeave={(e) => { e.currentTarget.style.color = "#a1a1aa"; e.currentTarget.style.borderColor = "#232327"; }}
        >◆ ask nexus to coach me on this</button>
        <span style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)" }}>{sample_note}</span>
      </div>
    </div>
  );
}

export function AnalyticsView({ orders: rawOrders, totalPnl, winRate, collateral, theses = [], wallet = null }: { orders: ProcessedTrade[]; totalPnl: number; winRate: number; collateral: number; theses?: ThesisTrade[]; wallet?: string | null; }) {
  // Oldest → newest by close time, once: the curve and the bars used to plot Orderly's own order under an
  // "oldest → newest" label.
  const orders = useMemo(() => chronological(rawOrders) as ProcessedTrade[], [rawOrders]);
  const perf = useMemo(() => perfRows(orders), [orders]);
  const winCount = useMemo(() => orders.filter((o) => o.pnl > 0).length, [orders]);
  const coverage = coverageLine(orders.length);
  // Per-trade bars: a big record is summed into <= 400 bars first (chartThin.mjs), so labels are built only when each
  // bar is one trade (17k date strings + 17k SVG bars froze the X-Ray on a market-making wallet).
  const bars = useMemo(() => {
    const vals = orders.map((o) => o.pnl);
    const b = bucketBars(vals, undefined) as { values: number[]; labels?: string[]; size: number };
    if (b.size > 1) return b;
    return { ...b, labels: orders.map((o) => {
      const sym = bareTicker(o.symbol);
      const d = o.timestamp ? new Date(o.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
      return `${sym} ${o.direction}${d ? ` · ${d}` : ""} · ${o.pnl >= 0 ? "+" : "-"}$${Math.abs(o.pnl).toFixed(2)}`;
    }) };
  }, [orders]);
  const cumulativePnl = useMemo(() => { let r = 0; return [0, ...orders.map((o) => { r += o.pnl; return r; })]; }, [orders]);
  const isMobile = useIsMobile();

  return (
    <div className="nx-stagger" style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      <SectionHeader
        eyebrow="Grade · Analytics"
        title="Performance Analytics"
        note={<a href="/analyze" style={{ color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 12, textDecoration: "none", border: "1px solid #232327", borderRadius: 6, padding: "5px 10px" }}>▶ X-ray any wallet</a>}
      />
      {/* SYNTHESIS FIRST — one point of view, before the instrument panel. Everything
          below is the evidence for it. */}
      <OperatorProfileCard wallet={wallet} theses={theses} orders={orders} />
      <WalletRiskCard wallet={wallet} />

      {/* Your OWN on-chain Tracked Record — graded by the exact same methodology the
          Smart Money x-ray applies to any wallet (realized-PnL consistency over time).
          "We grade every wallet, including yours." Hidden until a wallet is connected. */}
      {wallet && <TrackedRecordCard address={wallet} />}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, marginBottom: 8 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>TOTAL PNL</div>
          <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "var(--nx-font-mono)", color: !orders.length ? "#71717a" : totalPnl >= 0 ? "#3ecf8e" : "#f7525f", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{orders.length ? <CountUp value={totalPnl} format={formatPnlCompact} /> : "—"}</div>
          <div style={{ fontSize: 10, color: "#52525b", marginTop: 4, fontFamily: "var(--nx-font-mono)" }}>realized</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>WIN RATE</div>
          <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "var(--nx-font-mono)", color: "#d4d4d8", fontVariantNumeric: "tabular-nums" }}>{orders.length ? <CountUp value={winRate} format={(v) => `${v.toFixed(1)}%`} /> : "—"}</div>
          <div style={{ fontSize: 10, color: "#71717a", marginTop: 4, fontFamily: "var(--nx-font-mono)" }}>{orders.length ? `${winCount} of ${orders.length} won` : "no trades"}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>TRADES</div>
          <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "var(--nx-font-mono)", color: "#f4f4f5", fontVariantNumeric: "tabular-nums" }}>{orders.length ? <CountUp value={orders.length} format={(v) => `${Math.round(v)}`} /> : 0}</div>
          <div style={{ fontSize: 10, color: "#52525b", marginTop: 4, fontFamily: "var(--nx-font-mono)" }}>closed</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>BALANCE</div>
          <div style={{ fontSize: 22, fontWeight: "bold", fontFamily: "var(--nx-font-mono)", color: "#f4f4f5", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{collateral > 0 ? <CountUp value={collateral} format={formatUsdCompact} /> : "—"}</div>
          <div style={{ fontSize: 10, color: "#52525b", marginTop: 4, fontFamily: "var(--nx-font-mono)" }}>usdc</div>
        </div>
      </div>

      {coverage && <div style={{ fontSize: 11, color: "#a1a1aa", fontFamily: "var(--nx-font-mono)", margin: "0 2px 8px", lineHeight: 1.5 }}>{coverage}</div>}
      <YourEdgeCard orders={orders} />
      {/* Measured, not scored: the record in dollars + the slices costing and paying you (app/lib/tradeStats.mjs). */}
      <YourRecordCard orders={orders} />
      <MoneyGoesCard orders={orders} />
      {/* Calls vs trades: did you trade the plan you wrote? Lifted out of the deep fold 2026-11-14 (it was the
          most useful read on this tab for an active trader). Renders nothing until you have both. */}
      <PlanAdherenceCard theses={theses} orders={orders} />
      {/* Your calls split by what the smart-money + funding lenses showed at the post (publishLens, from 2026-11-15). */}
      <LensRecordCard theses={theses} />

      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 240px", gap: 8, marginBottom: 8 }}>
        <div style={cardStyle}>
          <div style={labelStyle}>&#9632; P&amp;L OVER TIME</div>
          {orders.length ? <PnlChart points={cumulativePnl} /> : <EmptyState message="no equity curve yet" unlock="This draws itself from your closed trades. Nothing to plot until the first one settles." />}
        </div>
        <div style={cardStyle}>
          <div style={{ fontSize: 10, color: "#71717a", letterSpacing: "0.1em", marginBottom: 14, fontFamily: "var(--nx-font-mono)" }}>PERFORMANCE</div>
          {/* Every dollar signed (analyticsRules.mjs perfRows): AVG LOSS and WORST TRADE used to print "$13.70". */}
          {perf.map((r) => (
            <div key={r.label} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 9, color: "#71717a", letterSpacing: "0.08em", fontFamily: "var(--nx-font-mono)" }}>{r.label}</div>
              <div style={{ fontSize: 18, color: r.value === "—" ? "#71717a" : r.tone === "pos" ? "#3ecf8e" : r.tone === "neg" ? "#f7525f" : "#f4f4f5", fontFamily: "var(--nx-font-mono)", whiteSpace: "nowrap" }}>{r.value}</div>
              {r.sub && <div style={{ fontSize: 9, color: "#71717a", fontFamily: "var(--nx-font-mono)" }}>{r.sub}</div>}
            </div>
          ))}
        </div>
      </div>

      {orders.length > 0 && (
        <div style={{ ...cardStyle, marginBottom: 8 }}>
          <div style={labelStyle}>&#9632; PER-TRADE P&amp;L</div>
          <PnlBars values={bars.values} labels={bars.labels} />
          <div style={{ fontSize: 9, color: "#52525b", fontFamily: "var(--nx-font-mono)", marginTop: 4 }}>
            <span style={{ color: "#3ecf8e" }}>■</span> win · <span style={{ color: "#f7525f" }}>■</span> loss · oldest → newest · {orders.length.toLocaleString()} trades{bars.size > 1 ? ` · each bar sums ${bars.size} trades` : ""}
          </div>
        </div>
      )}

      {/* Core analytics (operator read, key stats, equity curve) stay up top; the deeper
          drill-downs collapse so the tab reads as a synthesis, not an instrument dump. */}
      {orders.length > 0 && (
        <Collapsible title="Deeper breakdowns" subtitle="hold time, leverage, weekdays, streaks, best hours, top assets, regime and loss tags" storageKey="nx_analytics_deep_open">
          <BreakdownRow orders={orders} />
          <TimingAndRisk orders={orders} />
          <TopAssets orders={orders} />
          {/* PROCESS — outcome analytics say how you did; these say how to get better. */}
          <ProcessSection wallet={wallet} theses={theses} />
        </Collapsible>
      )}

      {orders.length === 0 && <EmptyState message="no closed trades found" unlock="Connect the wallet you trade with. The Lab reads your Orderly history directly, nothing to import." />}
    </div>
  );
}
