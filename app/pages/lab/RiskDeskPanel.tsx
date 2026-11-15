// ◆ YOUR OPEN RISK — Lab home, under Calls, only while the connected account holds positions (2026-11-15, borst:
// "what's missing for traders?"). The book in plain words: what needs a look first (stop past liquidation, liquidation
// close, no stop, same-side bunching), then each position's liquidation distance, what its stop would lose and funding
// a day, then the totals against the account. Rules app/lib/riskDesk.mjs (tested); read app/hooks/useRiskDesk.ts.
// Computed in this browser from the SDK; nothing leaves it. Facts, not advice. A coin name opens its drawer.
import { useAccount } from "@orderly.network/hooks";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { useRiskDesk, type RiskPosition, type RiskDesk } from "@/hooks/useRiskDesk";
import { usd, RISK_NOTE, LIQ_NEAR_PCT, LIQ_WATCH_PCT } from "@/lib/riskDesk.mjs";
import { CoinLink } from "@/components/CoinLink";

export function RiskDeskPanel() {
  const { state } = useAccount();
  const wallet = (state as { address?: string })?.address;
  return wallet ? <RiskDeskInner /> : null;
}

const liqTone = (d: number | null) => (d == null ? C.text.muted : d <= LIQ_NEAR_PCT ? C.warn : d <= LIQ_WATCH_PCT ? SIGNAL.watch : C.text.fog);

function RiskDeskInner() {
  const { desk } = useRiskDesk();
  return desk.positions.length ? <RiskDeskView desk={desk} /> : null;
}

/** The panel itself, from a computed desk (no SDK): what RiskDeskInner renders. */
export function RiskDeskView({ desk }: { desk: RiskDesk }) {
  const isMobile = useIsMobile();

  const label = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: C.text.muted };
  const box = { border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt, padding: isMobile ? "12px 14px" : "14px 18px", marginBottom: 8 };
  const small = { fontFamily: UI, fontSize: 12.5, color: C.text.muted, lineHeight: 1.5 };
  const n = desk.positions.length;

  return (
    <section aria-label="Your open risk" style={box}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Your open risk</span>
        <span style={{ fontFamily: UI, fontSize: 12, color: C.text.muted }}>{n} position{n === 1 ? "" : "s"}</span>
      </div>

      {desk.flags.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {desk.flags.map((f, i) => (
            <div key={i} style={{ fontFamily: UI, fontSize: 13, lineHeight: 1.45, marginTop: 4, color: f.level === "warn" ? C.warn : SIGNAL.watch }}>
              {f.level === "warn" ? "▲ " : "· "}{f.text}
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 8 }}>
        {desk.positions.map((p: RiskPosition) => (
          <div key={p.symbol} style={{ padding: "10px 0", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
              <b style={{ fontFamily: UI, fontSize: 14, fontWeight: 700, color: C.text.bright }}><CoinLink coin={p.coin}>{p.coin}</CoinLink></b>
              <span style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.08em", color: C.text.fog }}>{p.side}</span>
              <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text.fog }}>{usd(p.notional)}</span>
              {p.shareOfEquity != null && <span style={small}>{p.shareOfEquity.toFixed(1)}× the account</span>}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(3, minmax(0, 1fr))", gap: isMobile ? 2 : 12, marginTop: 4 }}>
              <span style={small}>Liquidation <span style={{ fontFamily: MONO, color: liqTone(p.liqDistPct) }}>{p.liqDistPct == null ? "unread" : `${p.liqDistPct.toFixed(1)}% away`}</span></span>
              <span style={small}>
                {p.stop.kind === "full"
                  ? p.stop.pastLiq ? <span style={{ color: C.warn }}>Stop past liquidation</span>
                  : p.stop.lockedIn ? "Stop locks in profit"
                  : <>Stop loses <span style={{ fontFamily: MONO, color: C.neg }}>{usd(p.stop.loss ?? 0)}</span>{p.stopShareOfEquity != null ? ` (${p.stopShareOfEquity.toFixed(1)}%)` : ""}</>
                  : p.stop.kind === "partial" ? "Stop on part only" : <span style={{ color: SIGNAL.watch }}>No stop</span>}
              </span>
              <span style={small}>
                {p.fundingPerDay == null ? "Funding unread"
                  : Math.abs(p.fundingPerDay) < 0.01 ? "Funding ≈ $0/day"
                  : <>Funding <span style={{ fontFamily: MONO, color: p.fundingPerDay < 0 ? C.neg : C.pos }}>{p.fundingPerDay < 0 ? "pays" : "earns"} {usd(Math.abs(p.fundingPerDay))}</span>/day</>}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10, display: "grid", gridTemplateColumns: isMobile ? "1fr 1fr" : "repeat(4, minmax(0, 1fr))", gap: 10 }}>
        <Stat k="Account" v={desk.equity == null ? "unread" : usd(desk.equity)} />
        <Stat k="Exposure" v={desk.leverage == null ? usd(desk.gross) : `${usd(desk.gross)} · ${desk.leverage.toFixed(1)}×`} />
        <Stat k="Net" v={desk.net === 0 ? "flat" : `${usd(Math.abs(desk.net))} ${desk.net > 0 ? "long" : "short"}`} />
        <Stat k="At your stops" v={desk.atStopsPct == null ? (desk.unstopped.length ? "no working stop" : "—") : `${usd(desk.atStops)} · ${desk.atStopsPct.toFixed(1)}%`}
          sub={desk.atStopsPct != null && desk.unstopped.length ? `+ ${desk.unstopped.join(", ")} uncapped` : undefined} />
      </div>
      <div style={{ ...small, fontSize: 12, marginTop: 10 }}>{RISK_NOTE}</div>
    </section>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: C.text.muted }}>{k}</div>
      <div style={{ fontFamily: MONO, fontSize: 13, color: C.text.bright, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v}</div>
      {sub && <div style={{ fontFamily: UI, fontSize: 11.5, color: SIGNAL.watch, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

export default RiskDeskPanel;
