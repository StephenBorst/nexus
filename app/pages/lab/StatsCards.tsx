// Stats tab: YOUR RECORD (measured, not scored) + WHERE THE MONEY GOES (the slices costing and paying you).
// Rules in app/lib/tradeStats.mjs (tested). Replaced the self-scored Trading Score radar, 2026-11-14.
import { useMemo } from "react";
import type { ProcessedTrade } from "./types";
import { cardStyle, labelStyle } from "./styles";
import { useIsMobile } from "./useIsMobile";
import { C, MONO, UI, RADIUS } from "@/config/theme";
import { tradeRecord, moneyLeaks, sliceLine, signedUsd, RECORD_MIN_TRADES } from "@/lib/tradeStats.mjs";

const hint: React.CSSProperties = { fontSize: 10, color: C.text.faint, fontFamily: MONO, lineHeight: 1.6 };
const pct = (v: number) => `${Math.round(v * 100)}%`;
const day = (ms: number | null) => (ms ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null);

function Stat({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: C.text.muted, fontFamily: MONO, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: 20, fontWeight: 700, color: tone ?? C.text.bright, fontVariantNumeric: "tabular-nums", marginTop: 2, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ ...hint, marginTop: 1 }}>{sub}</div>
    </div>
  );
}

const tone = (v: number | null | undefined, zero = 0) => (v == null ? C.text.fog : v > zero ? C.pos : v < zero ? C.neg : C.text.fog);

export function YourRecordCard({ orders }: { orders: ProcessedTrade[] }) {
  const r = useMemo(() => tradeRecord(orders), [orders]);
  if (!r) return null;
  const gated = !r.sampled;
  const locked = `need ${r.needMore} more`;
  const from = day(r.drawdownFrom);
  const to = day(r.drawdownTo);

  // The plain-words read under the numbers: what the payoff needs, and what you have.
  const lines: string[] = [];
  if (gated) {
    lines.push(`Ratios unlock at ${RECORD_MIN_TRADES} closed trades. You have ${r.trades}. Under that, one trade swings them.`);
  } else if (r.breakevenWinRate != null) {
    const gap = Math.round((r.winRate - r.breakevenWinRate) * 100);
    lines.push(
      `At your payoff you break even winning ${pct(r.breakevenWinRate)} of trades. You win ${pct(r.winRate)}: ` +
      (gap > 0 ? `${gap} points of room.` : gap < 0 ? `${-gap} points short.` : "exactly break-even."),
    );
  }
  if (r.bestTradeShare != null && r.bestTradeShare >= 0.5 && r.trades >= 5) {
    lines.push(`One trade is ${pct(r.bestTradeShare)} of your net profit. Without it the record reads very differently.`);
  }
  if (r.currentDrawdown > 0 && r.maxDrawdown > 0) {
    lines.push(`Now ${signedUsd(-r.currentDrawdown)} below your high-water mark.`);
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={labelStyle}>&#9632; YOUR RECORD</div>
        <div style={{ ...hint, letterSpacing: "0.08em" }}>measured, not scored</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginTop: 10 }}>
        <Stat label="Expectancy" value={signedUsd(r.expectancy)} tone={tone(r.expectancy)} sub={`avg per trade · ${r.trades} closed`} />
        <Stat
          label="Profit factor"
          value={gated ? "—" : r.profitFactor == null ? "no losses" : r.profitFactor.toFixed(2)}
          tone={gated || r.profitFactor == null ? C.text.fog : tone(r.profitFactor, 1)}
          sub={gated ? locked : "$ won ÷ $ lost"}
        />
        <Stat
          label="Payoff"
          value={gated || r.payoff == null ? "—" : `${r.payoff.toFixed(2)} : 1`}
          sub={gated ? locked : r.payoff == null ? "needs a win and a loss" : "avg win ÷ avg loss"}
        />
        <Stat
          label="Max drawdown"
          value={r.maxDrawdown > 0 ? signedUsd(-r.maxDrawdown) : "$0.00"}
          tone={r.maxDrawdown > 0 ? C.neg : C.text.fog}
          sub={r.maxDrawdown > 0 ? (from ? `${from} → ${to}` : `from your first trade → ${to}`) : "never below a high"}
        />
      </div>
      {lines.length > 0 && (
        <div style={{ marginTop: 12, padding: "10px 12px", background: C.inset, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, display: "flex", flexDirection: "column", gap: 4 }}>
          {lines.map((l) => (
            <div key={l} style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, lineHeight: 1.5 }}>{l}</div>
          ))}
        </div>
      )}
      <div style={{ ...hint, marginTop: 8 }}>realized P&amp;L as Orderly reports it · your last 500 closed positions · drawdown in dollars from your best point</div>
    </div>
  );
}

function SliceRow({ s, side }: { s: ReturnType<typeof moneyLeaks>["leaks"][number]; side: "neg" | "pos" }) {
  return (
    <div style={{ padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontFamily: UI, fontSize: 14, color: C.text.bright, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.label}</span>
        <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 14, fontWeight: 700, color: side === "neg" ? C.neg : C.pos, fontVariantNumeric: "tabular-nums" }}>{signedUsd(s.net)}</span>
      </div>
      <div style={{ ...hint, marginTop: 2 }}>{sliceLine(s)}</div>
    </div>
  );
}

export function MoneyGoesCard({ orders }: { orders: ProcessedTrade[] }) {
  const isMobile = useIsMobile();
  const m = useMemo(() => moneyLeaks(orders), [orders]);
  if (!m.trades) return null;
  const none = !m.leaks.length && !m.strengths.length;

  const column = (title: string, rows: typeof m.leaks, side: "neg" | "pos", empty: string) => (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: C.text.muted, fontFamily: MONO, marginBottom: 2 }}>{title}</div>
      {rows.length ? rows.map((s) => <SliceRow key={`${s.dim}|${s.key}`} s={s} side={side} />) : <div style={{ ...hint, padding: "8px 0" }}>{empty}</div>}
    </div>
  );

  return (
    <div style={{ ...cardStyle, marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <div style={labelStyle}>&#9632; WHERE THE MONEY GOES</div>
        <div style={{ ...hint, letterSpacing: "0.08em" }}>market · side · hold · leverage · session</div>
      </div>
      {none ? (
        <div style={{ ...hint, padding: "10px 0" }}>
          Nothing to name yet. A slice needs {m.minTrades}+ closed trades in one market, side, hold time, leverage band or session, and can’t be your whole record.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 14 : 20, marginTop: 8 }}>
          {column("COSTING YOU", m.leaks, "neg", `No slice with ${m.minTrades}+ trades lost money.`)}
          {column("PAYING YOU", m.strengths, "pos", `No slice with ${m.minTrades}+ trades made money.`)}
        </div>
      )}
      <div style={{ ...hint, marginTop: 10 }}>
        Hindsight. A slice that lost can win next, and small samples lie. Use it to ask why, not to flip sides. Sessions in UTC.
      </div>
    </div>
  );
}
