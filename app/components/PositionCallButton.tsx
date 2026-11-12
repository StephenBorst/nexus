// ◆ "Post your BTC long as a call" — the Trade page's one-tap hand-off from an open position to a graded
// call. Shows only when the connected wallet holds a position in the market on screen. It opens the Lab's
// Thesis Engine with a draft (side, entry at the mark NOW, the position's TP/SL as stop/target when they
// sit on the right side: app/lib/positionCall.mjs). The trader reviews and publishes there; nothing here
// publishes, signs or touches the position, and no size or P&L leaves the account.
// No position but a resting limit ENTRY on this market → "Post your ETH limit buy as a call": entry = the order's
// exact limit price, counted once price trades there (orderCallDraft); the draft says a published call is permanent.
import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAccount, usePositionStream, useOrderStream } from "@orderly.network/hooks";
import { OrderStatus } from "@orderly.network/types";
import { positionCallDraft, openPositionOn, orderCallDraft, restingEntryOrderOn } from "@/lib/positionCall.mjs";
import { THESIS_DRAFT_KEY } from "@/config/assistantTools";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { C, UI } from "@/config/theme";

export default function PositionCallButton() {
  const { state } = useAccount();
  const wallet = (state as { address?: string })?.address;
  return wallet ? <PositionCallButtonInner /> : null;
}

function PositionCallButtonInner() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const { symbol } = useParams();
  const [{ rows }] = usePositionStream();
  const [orders] = useOrderStream({ symbol, status: OrderStatus.INCOMPLETE });
  const row = openPositionOn(rows as unknown[], symbol);
  const order = row ? null : restingEntryOrderOn(orders as unknown[], symbol);
  // A position wins; else a resting limit entry. Rebuilt at the tap so the mark is the current one.
  const build = useCallback(() => (row
    ? positionCallDraft(row as Parameters<typeof positionCallDraft>[0])
    : order ? orderCallDraft(order as Parameters<typeof orderCallDraft>[0]) : null), [row, order]);

  const post = useCallback(() => {
    const d = build();
    if (!d) return;
    try { window.localStorage.setItem(THESIS_DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode: the Lab opens without the draft */ }
    try {
      window.dispatchEvent(new CustomEvent("nexus:lab-tab", { detail: { tab: "thesis" } }));
      window.dispatchEvent(new CustomEvent("nexus:thesis-draft"));
    } catch { /* non-browser */ }
    navigate("/lab?tab=thesis");
  }, [build, navigate]);

  const d = build();
  if (!d) return null;
  const side = order ? `limit ${d.direction === "LONG" ? "buy" : "sell"}` : d.direction === "LONG" ? "long" : "short";
  return (
    <button type="button" onClick={post} className="nx-press"
      title={order
        ? `Open the Thesis Engine with your ${d.symbol} ${side} at ${d.entryPrice} as a call. It counts once price trades there. Published calls are permanent; you review and publish.`
        : `Open the Thesis Engine with your ${d.symbol} ${side} as a call: entry at today's mark, your TP/SL as levels. You review and publish; it's graded from public price.`}
      style={{
        flexShrink: 0, display: "flex", alignItems: "center", gap: 6, background: C.surface, border: "none",
        borderLeft: `1px solid ${C.border}`, color: C.text.bright, fontFamily: UI, fontSize: 12, fontWeight: 600,
        padding: isMobile ? "0 10px" : "0 16px", cursor: "pointer", whiteSpace: "nowrap",
      }}>
      {isMobile ? `Post ${d.symbol} ${side} as a call →` : `Post your ${d.symbol} ${side} as a call →`}
    </button>
  );
}
