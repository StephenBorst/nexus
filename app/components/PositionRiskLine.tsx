// The risk on the position on screen, one line under the market read on the Trade page (2026-11-15): liquidation
// distance, what the resting stop would lose (or that it sits past liquidation), funding a day. Shown only while the
// connected account holds this market. Rules app/lib/riskDesk.mjs (riskLine); read app/hooks/useRiskDesk.ts, in the
// browser only. Facts, not advice.
import { useParams } from "react-router-dom";
import { useAccount } from "@orderly.network/hooks";
import { C, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { useRiskDesk } from "@/hooks/useRiskDesk";
import { riskLine, LIQ_NEAR_PCT, LIQ_WATCH_PCT } from "@/lib/riskDesk.mjs";

export default function PositionRiskLine() {
  const { state } = useAccount();
  const wallet = (state as { address?: string })?.address;
  return wallet ? <Inner /> : null;
}

function Inner() {
  const { symbol } = useParams();
  const isMobile = useIsMobile();
  const { desk } = useRiskDesk();
  const p = desk.positions.find((x) => x.symbol === symbol);
  if (!p) return null;
  const danger = (p.stop.kind === "full" && p.stop.pastLiq) || (p.liqDistPct != null && p.liqDistPct <= LIQ_NEAR_PCT);
  const watch = !danger && ((p.liqDistPct != null && p.liqDistPct <= LIQ_WATCH_PCT) || p.stop.kind !== "full");
  return (
    <div role="status" aria-label="Risk on this position"
      style={{
        fontFamily: UI, fontSize: isMobile ? 11.5 : 12, lineHeight: 1.45, padding: isMobile ? "5px 12px" : "5px 16px",
        borderBottom: `1px solid ${C.border}`, background: C.surface,
        color: danger ? C.warn : watch ? SIGNAL.watch : C.text.fog,
      }}>
      {danger ? "▲ " : ""}{riskLine(p)}
    </div>
  );
}
