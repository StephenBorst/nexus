// Market TAPE: the whole crypto tape's inputs, from the same public futures feed the rest of the
// app uses: breadth (markets up on 24h), BTC's 24h move, and funding skew (markets where longs
// pay). Shown side by side, never added up.
//
// It used to weight them into a RISK-ON / NEUTRAL / RISK-OFF score with agent advice
// ("Momentum/trend presets favored", "consider smaller agent size"): a tally of ungraded inputs
// and preset advice no grade stood behind (house rule: show inputs, never a tally or crown of
// ungraded reads). Rules in app/lib/marketTape.mjs, tested.
//
// ⚠️ NAMING — this is the TAPE (market-wide), NOT a "regime". The Lab uses "regime" for exactly
// one thing: the PER-SYMBOL trend/volatility classification that grades and attributes calls
// (classifyRegime in lab-api logic.mjs). Market-wide = TAPE; per-symbol character = REGIME.
import { useEffect, useMemo, useState } from "react";
import { tapeInputs, tapeAskPrompt } from "@/lib/marketTape.mjs";

const PROXY = "https://orderly-proxy.stephenpatrick24.workers.dev";

type Row = { symbol: string; "24h_open"?: string | number; "24h_close"?: string | number; last_funding_rate?: string | number };

/** A thin strip for the decision tabs (thesis/agent). Callers pass `compact`; there is one layout. */
export function MarketTape(_props: { compact?: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(PROXY);
        const j = await r.json();
        if (alive) setRows(j?.data?.rows ?? []);
      } catch { /* fail soft */ }
    };
    load();
    const id = setInterval(load, 60000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const tape = useMemo(() => tapeInputs(rows), [rows]);
  if (!tape) return null;

  const askAi = () => window.dispatchEvent(new CustomEvent("nexus:assistant-ask", { detail: { prompt: tapeAskPrompt(tape) } }));
  const div = <span style={{ color: "#52525b" }}>·</span>;
  const stat = (label: string, val: string, color = "#a1a1aa") => (
    <span style={{ color: "#71717a", whiteSpace: "nowrap" }}>{label} <span style={{ color }}>{val}</span></span>
  );
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "7px 12px", background: "#0f0f11", border: "1px solid #232327", borderRadius: 4, marginBottom: 12, fontFamily: "var(--nx-font-mono)", fontSize: 11 }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <span className="nx-live-dot" style={{ width: 5, height: 5 }} />
        <span style={{ color: "#a1a1aa", letterSpacing: "0.08em" }}>TAPE</span>
      </span>
      {div}
      {stat("up 24h", `${tape.up} of ${tape.markets}`)}
      {stat("BTC", `${tape.btcChg >= 0 ? "+" : ""}${tape.btcChg.toFixed(2)}%`, tape.btcChg >= 0 ? "#3ecf8e" : "#f7525f")}
      {stat("longs pay", `${tape.fundPos} of ${tape.fundN}`)}
      <span style={{ flex: 1, minWidth: 120, color: "#71717a", fontFamily: "var(--nx-font-ui)" }}>inputs, not graded, not added up</span>
      <button type="button" onClick={askAi} title="Ask the copilot what these inputs are, and which reads are graded"
        style={{ flexShrink: 0, background: "transparent", border: "1px solid #232327", borderRadius: 3, color: "#a1a1aa", fontFamily: "var(--nx-font-ui)", fontSize: 12, padding: "3px 9px", cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.color = "#ededf0"; e.currentTarget.style.borderColor = "#33333a"; }}
        onMouseLeave={(e) => { e.currentTarget.style.color = "#a1a1aa"; e.currentTarget.style.borderColor = "#232327"; }}
      >◆ ask</button>
    </div>
  );
}
