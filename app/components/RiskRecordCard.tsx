// RISK IN R — a caller's graded record read for risk (2026-11-16, rules app/lib/recordRisk.mjs): profit factor,
// max drawdown, worst losing run, expectancy with its 95% range. From the grader's own record (/theses/process
// `risk`), in close order. Below RISK_MIN_CALLS it says how many more graded calls, never a number from a few.
import { useEffect, useState } from "react";
import { C, MONO, UI } from "@/config/theme";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { riskLines, RISK_MIN_CALLS } from "@/lib/recordRisk.mjs";

export type RecordRisk = {
  calls: number; ready: boolean; needed: number; profitFactor: number | null; maxDrawdownR: number;
  worstStreak: number; expectancy: number; low: number | null; high: number | null;
};

const sgn = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;

export function RiskRecordCard({ risk }: { risk: RecordRisk | null }) {
  const box = { border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt, padding: "12px 14px", marginBottom: 24 };
  const label = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: C.text.muted };
  if (!risk) return null;
  if (!risk.ready) {
    return (
      <section aria-label="Risk in R" style={box}>
        <span style={label}>Risk in R</span>
        <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, marginTop: 6, lineHeight: 1.5 }}>{riskLines(risk)[0]}</div>
      </section>
    );
  }
  const straddles = risk.low != null && risk.high != null && risk.low <= 0 && risk.high >= 0;
  const tiles = [
    { k: "Profit factor", v: risk.profitFactor == null ? "no loss yet" : risk.profitFactor.toFixed(2), sub: "R won per R lost" },
    { k: "Max drawdown", v: `−${risk.maxDrawdownR.toFixed(2)}R`, sub: "deepest fall, close order" },
    { k: "Worst run", v: `${risk.worstStreak} loss${risk.worstStreak === 1 ? "" : "es"}`, sub: "in a row" },
    { k: "Per call", v: `${sgn(risk.expectancy)}R`, sub: risk.low != null && risk.high != null ? `95%: ${sgn(risk.low)} to ${sgn(risk.high)}` : "" },
  ];
  return (
    <section aria-label="Risk in R" style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Risk in R</span>
        <span style={{ fontFamily: UI, fontSize: 12, color: C.text.muted }}>{risk.calls} graded calls</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10, marginTop: 10 }}>
        {tiles.map((t) => (
          <div key={t.k} style={{ minWidth: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text.muted }}>{t.k}</div>
            <div style={{ fontFamily: MONO, fontSize: 15, color: C.text.bright, marginTop: 2 }}>{t.v}</div>
            <div style={{ fontFamily: UI, fontSize: 11.5, color: C.text.muted, marginTop: 1 }}>{t.sub}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: UI, fontSize: 12, color: C.text.muted, marginTop: 10, lineHeight: 1.5 }}>
        {straddles ? "The per-call range includes zero: not yet distinguishable from break-even. " : ""}
        From the grader’s record, in the order calls closed; shown from {RISK_MIN_CALLS} graded calls. No Sharpe: calls aren’t evenly spaced returns.
      </div>
    </section>
  );
}

/** The card for one wallet, reading the grader's record itself (one shared request per URL). */
export function WalletRiskCard({ wallet }: { wallet?: string | null }) {
  const [risk, setRisk] = useState<RecordRisk | null>(null);
  useEffect(() => {
    if (!wallet) { setRisk(null); return; }
    let alive = true;
    sharedJson(`https://og.nexustradinglabs.com/theses/process/${wallet.toLowerCase()}`)
      .then((d) => { if (alive) setRisk(d?.risk && typeof d.risk.calls === "number" ? d.risk as RecordRisk : null); })
      .catch(() => { /* no card */ });
    return () => { alive = false; };
  }, [wallet]);
  return <RiskRecordCard risk={risk} />;
}

export default RiskRecordCard;
