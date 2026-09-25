// ── Agent leaf components ──
// Extracted from AgentView.tsx (god-file split). Self-contained, prop-driven pieces
// with no dependency on AgentView's state — they were the easy 100 lines to lift out
// of a 2.4k-line file, and lifting them makes both independently readable.
//
// ⚠️ Mechanical move: markup and behavior are unchanged from what shipped.
import { useEffect, useState } from "react";
import { Collapsible } from "./Collapsible";
import type { AgentTrade } from "./types";
import { agentCardStyle, agentLabelStyle, agentInputStyle, navBtnStyle } from "./styles";
import { fmtUsdCompact, fmtUsdCompactAbs, fmtUsdExact } from "@/lib/fmtUsd.mjs";
import { paperBlotter, tradeNotional, holdHours } from "@/lib/paperStats.mjs";
import { bareTicker } from "@/utils/utils";

/**
 * Number input that holds its own text state so you can clear/edit freely
 * (empty, "0.", "1.2" mid-type) without the controlled value snapping back to 0
 * or fighting the cursor. Commits a valid number as you type; normalizes on blur.
 */
export function NumberField({ value, onCommit, min, max, step }: {
  value: number; onCommit: (n: number) => void; min?: number; max?: number; step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <input
      type="number"
      inputMode="decimal"
      value={text}
      min={min} max={max} step={step}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onCommit(n);
      }}
      onBlur={() => {
        const n = parseFloat(text);
        const final = isNaN(n) ? (min ?? 0) : n;
        onCommit(final);
        setText(String(final));
      }}
      style={{ ...agentInputStyle, width: "70%" }}
    />
  );
}

/**
 * An opt-in agent guardrail: label, explanation, ON/OFF. Three of these were
 * copy-pasted in the config tab (tape filter, smart-money filter, volatility-scaled
 * stops) — identical markup differing only in copy and accent, which is how the
 * fourth one would have been written too.
 *
 * One accent, no prop: every guardrail toggle is bone. The smart-money one shipped
 * GREEN, which broke the design law that green means P&L and nothing else — an ON
 * switch is not a profit. Unified here deliberately (the preceding refactor commit
 * preserved the drift so the restyle wouldn't hide inside a mechanical change).
 */
export function AgentToggleCard({ label, description, on, onToggle }: {
  label: string;
  description: React.ReactNode;
  on: boolean;
  onToggle: () => void;
}) {
  const accent = "#ededf0";
  return (
    <div style={agentCardStyle}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={agentLabelStyle}>{label}</div>
          <div style={{ ...agentLabelStyle, fontSize: 9, marginTop: 6, color: "#71717a", letterSpacing: 0 }}>
            {description}
          </div>
        </div>
        <button onClick={onToggle}
          style={{
            flexShrink: 0, cursor: "pointer", fontFamily: "var(--nx-font-mono)", fontSize: 11, borderRadius: 4, padding: "6px 16px",
            background: on ? `${accent}15` : "#0a0a0b",
            border: `1px solid ${on ? accent : "#232327"}`,
            color: on ? accent : "#71717a",
          }}>
          {on ? "ON" : "OFF"}
        </button>
      </div>
    </div>
  );
}

// ─── Agent Track Record (shared by live + paper) ─────────
export function AgentTrackRecord({ title, accent, trades: tradesProp, paper, onReset, summary }: {
  title: string;
  accent: string;
  trades?: AgentTrade[] | null;
  paper?: boolean;
  onReset?: () => void;
  // Server-side FULL aggregate (all trades, not the last-50 the GET ships). When
  // present it drives the headline numbers so a long-running agent's record isn't
  // undercounted; falls back to computing from `trades` (paper has no server side).
  summary?: { trades: number; winRate: number; netPnl: number; avgWin: number; avgLoss: number; firstTradeAt?: number } | null;
}) {
  // Normalize ONCE at the boundary: a fresh wallet has no agent state at all, and this
  // component reads .length/.filter/.map on `trades` in a dozen places. One undefined
  // prop would take down the whole Lab route (react-router errorElement), so the prop
  // is coerced here rather than guarded at every use site.
  const trades = Array.isArray(tradesProp) ? tradesProp : [];
  const useSummary = !!summary && Number.isFinite(summary.trades) && (summary.trades ?? 0) > 0;
  const tr = useSummary ? summary!.trades : trades.length;
  const wr = useSummary ? summary!.winRate : (trades.length ? (trades.filter((t) => t.pnl > 0).length / trades.length) * 100 : 0);
  const net = useSummary ? summary!.netPnl : trades.reduce((s, t) => s + t.pnl, 0);
  const winsArr = trades.filter((t) => t.pnl > 0);
  const lossArr = trades.filter((t) => t.pnl <= 0);
  const avgWin = useSummary ? summary!.avgWin : (winsArr.length ? winsArr.reduce((s, t) => s + t.pnl, 0) / winsArr.length : 0);
  const avgLoss = useSummary ? summary!.avgLoss : (lossArr.length ? lossArr.reduce((s, t) => s + Math.abs(t.pnl), 0) / lossArr.length : 0);
  const sinceMs = useSummary && summary!.firstTradeAt
    ? summary!.firstTradeAt
    : (trades.length ? Math.min(...trades.map((t) => new Date(t.opened_at).getTime() || Date.now())) : 0);
  const since = sinceMs ? new Date(sinceMs).toLocaleDateString() : null;
  // Paper has no server-side aggregate, so `trades` IS the record — but exec caps
  // paper_trades at the last 50 (rolling). Past the cap, these stats are a rolling
  // window (and `since` is just the oldest RETAINED trade, not the record start), so
  // label it honestly rather than imply a lifetime total. Auto-off if a summary lands.
  const rolling = !!paper && !useSummary && trades.length >= 50;
  // Lifetime = a server-accrued aggregate exists, so the tiles are the REAL record and
  // `trades` is just the rolling window exec still retains. Say both, plainly.
  const lifetime = !!paper && useSummary;

  return (
    <div style={{ ...agentCardStyle, borderColor: tr > 0 ? (net >= 0 ? "#33333a" : "#4a1e22") : "#232327" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ ...agentLabelStyle, color: accent }}>{title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {since && <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b" }}>{lifetime ? `lifetime · since ${since}` : rolling ? `last 50 · since ${since}` : `since ${since}`}</span>}
          {onReset && tr > 0 && (
            <button onClick={onReset} style={{ ...navBtnStyle, fontSize: 9, padding: "3px 10px", color: "#d4d4d8", borderColor: "#33333a" }}>RESET</button>
          )}
        </div>
      </div>
      {tr === 0 ? (
        <div style={{ color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 11, marginTop: 8, lineHeight: 1.6 }}>
          {paper
            ? <>No paper trades yet — switch to 🧪 PAPER and activate to build a simulated track record against live prices. Risk-free.</>
            : <>No live track record yet — this agent hasn&apos;t traded for you. Stats build here transparently from its first trade. <strong style={{ color: "#a1a1aa" }}>Start small.</strong></>}
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(108px, 1fr))", gap: 12, marginTop: 8 }}>
            {[
              // COMPACT value + exact-in-title. A 6-figure P&L ("+$148617.53") is wider than
              // a tile track at phone width, so it overflowed and ran into the next value
              // ("+$148617.5376.0%"). minWidth:0 + nowrap keeps every cell inside its lane.
              { label: "NET P&L", value: fmtUsdCompact(net), exact: fmtUsdExact(net), color: net >= 0 ? "#3ecf8e" : "#f7525f" },
              { label: "WIN RATE", value: `${wr.toFixed(1)}%`, exact: "", color: wr >= 50 ? "#3ecf8e" : "#f7525f" },
              { label: "TRADES", value: String(tr), exact: "", color: "#d4d4d8" },
              { label: "AVG WIN", value: fmtUsdCompactAbs(avgWin), exact: fmtUsdExact(avgWin), color: "#ededf0" },
              { label: "AVG LOSS", value: fmtUsdCompactAbs(avgLoss), exact: fmtUsdExact(avgLoss), color: "#f7525f" },
            ].map(({ label, value, exact, color }) => (
              <div key={label} style={{ minWidth: 0 }}>
                <div style={{ ...agentLabelStyle, fontSize: 9 }}>{label}</div>
                <div title={exact || undefined} style={{ color, fontFamily: "var(--nx-font-mono)", fontSize: 16, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
              </div>
            ))}
          </div>
          {lifetime && (
            <div style={{ marginTop: 8, fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a" }}>
              last {trades.length} · rolling <span style={{ color: "#52525b" }}>— the window exec retains; totals above are lifetime</span>
            </div>
          )}
          <div style={{ marginTop: 10, fontFamily: "var(--nx-font-ui)", fontSize: 9, color: "#52525b", lineHeight: 1.5 }}>
            {paper
              ? (lifetime
                  ? "🧪 Simulated results — LIFETIME totals, accrued once per close so they survive the rolling window. Paper never touches the exchange; encouraging, not a guarantee."
                  : rolling
                  ? "🧪 Simulated results — the most recent 50 paper trades (rolling window), not a lifetime total. Paper never touches the exchange; encouraging, not a guarantee."
                  : "🧪 Simulated results — paper trades never touch the exchange. A great paper record is encouraging, not a guarantee.")
              : "⚠ Past performance does not guarantee future results. Markets are risky — only deploy capital you can afford to lose, and start small."}
          </div>
        </>
      )}
    </div>
  );
}

// ── PAPER BLOTTER — how trades actually END ──────────────────────────────────
// "Why are losses bigger than wins?" is unanswerable from a net number. This prints the
// distribution instead: which exit closes each loss, where wins die on the scale-out
// ladder, and avg win vs avg loss at the CURRENT position size only — mixing an old fat
// notional into avg$ makes it meaningless. Read-only: retuning TP/SL is a separate call.
export function PaperBlotter({ trades: tradesProp, currentNotional, maxHoldHours }: { trades?: AgentTrade[] | null; currentNotional?: number | null; maxHoldHours?: number | null }) {
  const trades = Array.isArray(tradesProp) ? tradesProp : [];   // see AgentTrackRecord
  const b = paperBlotter(trades, { currentNotional: currentNotional ?? null, maxHoldHours: maxHoldHours ?? null });
  if (!b.n) return null;
  const isRedProfitExit = (t: AgentTrade) => (t.reason === "TP" || t.reason === "TP_PARTIAL") && t.pnl <= 0;

  const Chips = ({ label, parts, tone }: { label: string; parts: { label: string; n: number; pct: number }[]; tone: string }) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
      <span style={{ ...agentLabelStyle, fontSize: 9, minWidth: 74 }}>{label}</span>
      {parts.length === 0
        ? <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#52525b" }}>none yet</span>
        : parts.map((p) => (
            <span key={p.label} style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa" }}>
              {p.label} <b style={{ color: tone }}>{p.pct}%</b> <span style={{ color: "#52525b" }}>({p.n})</span>
            </span>
          ))}
    </div>
  );

  // Tucked behind a toggle like the Lab's other deep sections (collapsed by default, remembered).
  // The one-line summary rides in the subtitle so the closed state still says something.
  return (
    <Collapsible title="🧾 PAPER BLOTTER" subtitle={`how trades end · ${b.n} closed · ${b.winRate}% win · window`}
      shortTitle="🧾 PAPER BLOTTER" shortSub={`${b.n} closed · ${b.winRate}% win`} storageKey="nx_paper_blotter_open">
    <div style={agentCardStyle}>

      {b.staleWindow && b.sizeDrift && (
        <div style={{ marginTop: 8, padding: "6px 8px", border: "1px solid #fbbf2430", borderRadius: 3, color: "#fbbf24", fontFamily: "var(--nx-font-ui)", fontSize: 10, lineHeight: 1.5 }}>
          ⚠ These rows are not this bot. Typical retained size is {fmtUsdCompactAbs(b.sizeDrift.medianNotional)} notional
          vs {fmtUsdCompactAbs(b.sizeDrift.currentNotional)} now — the window describes an older configuration, so every
          percentage below is about a setup you are no longer running.
        </div>
      )}

      {b.anomalies.n > 0 && (
        <div style={{ marginTop: 8, padding: "6px 8px", border: "1px solid #f7525f30", borderRadius: 3, color: "#f7525f", fontFamily: "var(--nx-font-ui)", fontSize: 10, lineHeight: 1.5 }}>
          ⚠ {b.anomalies.n} profit-labelled exit{b.anomalies.n === 1 ? "" : "s"} closed RED
          {b.anomalies.byExit.length ? ` (${b.anomalies.byExit.map((x: { label: string; n: number }) => `${x.label} ${x.n}`).join(" · ")})` : ""}
          {b.anomalies.worst ? `, worst ${fmtUsdCompact(b.anomalies.worst.pnl)}` : ""}.
          <span style={{ color: "#a1a1aa" }}> A take-profit bucket points at the fill diverging from the price that triggered the exit; a TP1/TP2 bucket points at the ladder/remainder path.</span>
        </div>
      )}

      <Chips label="LOSSES END" parts={b.lossByExit} tone="#f7525f" />
      <Chips label="WINS END" parts={b.winByExit} tone="#3ecf8e" />

      {b.atSize && (
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <span style={{ ...agentLabelStyle, fontSize: 9, minWidth: 74 }}>AT SIZE</span>
          {b.atSize.n === 0 ? (
            // No sample ⇒ say so. An averaged empty set renders "$0.00", which reads as a
            // real measurement of trades that don't exist.
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#fbbf24" }}>
              no trades at {fmtUsdCompactAbs(b.atSize.notional)} notional yet
              <span style={{ color: "#52525b" }}> — all {b.atSize.excluded} retained rows are at other sizes</span>
            </span>
          ) : (
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa" }}>
              {fmtUsdCompactAbs(b.atSize.notional)} notional · avg win <b style={{ color: "#3ecf8e" }}>{b.atSize.avgWin == null ? "—" : fmtUsdCompactAbs(b.atSize.avgWin)}</b>
              {" · "}avg loss <b style={{ color: "#f7525f" }}>{b.atSize.avgLoss == null ? "—" : fmtUsdCompactAbs(b.atSize.avgLoss)}</b>
              {" · "}<span style={{ color: "#52525b" }}>{b.atSize.n} trades{b.atSize.excluded ? `, ${b.atSize.excluded} at other sizes excluded` : ""}</span>
            </span>
          )}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        <span style={{ ...agentLabelStyle, fontSize: 9, minWidth: 74 }}>HOLD</span>
        <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa" }}>
          win <b style={{ color: "#ededf0" }}>{b.avgHoldWinH.toFixed(1)}h</b> · loss <b style={{ color: "#ededf0" }}>{b.avgHoldLossH.toFixed(1)}h</b>
          {b.overHold ? (
            <>
              {" · "}<span style={{ color: "#52525b" }}>cap {b.overHold.cap}h</span>
              {b.overHold.n > 0 && (
                <span style={{ color: "#fbbf24" }}> · {b.overHold.n} outlived it (max {b.overHold.maxH.toFixed(1)}h)</span>
              )}
            </>
          ) : null}
        </span>
      </div>

      {/* Dense row table — scrolls on mobile rather than clipping (inline-style app). */}
      <div style={{ marginTop: 10, overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
        <div style={{ minWidth: 420 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 0.7fr 0.7fr 0.9fr 0.5fr", gap: 6, padding: "0 0 4px", borderBottom: "1px solid #232327", fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a" }}>
            <span>MARKET</span><span>SIDE</span><span style={{ textAlign: "right" }}>NOTIONAL</span>
            <span style={{ textAlign: "right" }}>P&L</span><span>EXIT</span><span style={{ textAlign: "right" }}>HOLD</span>
          </div>
          {trades.map((t) => {
            const n = tradeNotional(t), h = holdHours(t);
            const lvl = Number.isFinite(Number(t.tp_level)) ? `TP${Number(t.tp_level)}` : null;
            return (
              <div key={t.id} style={{ display: "grid", gridTemplateColumns: "1fr 0.5fr 0.7fr 0.7fr 0.9fr 0.5fr", gap: 6, padding: "4px 0", borderBottom: "1px solid #141416", fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa" }}>
                <span style={{ color: "#d4d4d8" }}>{bareTicker(t.symbol)}</span>
                <span style={{ color: t.direction === "LONG" ? "#3ecf8e" : "#f7525f" }}>{t.direction === "LONG" ? "L" : "S"}</span>
                <span style={{ textAlign: "right" }}>{n == null ? "—" : fmtUsdCompactAbs(n)}</span>
                <span style={{ textAlign: "right", color: t.pnl >= 0 ? "#3ecf8e" : "#f7525f" }}>{fmtUsdCompact(t.pnl)}</span>
                <span style={{ color: isRedProfitExit(t) ? "#f7525f" : "#71717a" }} title={isRedProfitExit(t) ? "profit-labelled exit that closed red" : undefined}>
                  {isRedProfitExit(t) ? "⚠ " : ""}{lvl ?? t.reason}
                </span>
                <span style={{ textAlign: "right", color: "#52525b" }}>{h == null ? "—" : `${h.toFixed(1)}h`}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div style={{ marginTop: 8, fontFamily: "var(--nx-font-ui)", fontSize: 9, color: "#52525b", lineHeight: 1.5 }}>
        Distribution over the retained window (not lifetime). Exit names are exec&apos;s own:
        stop / time / trail / breakeven / take-profit / scale-out, plus external-flip for a webhook close.
      </div>
    </div>
    </Collapsible>
  );
}
