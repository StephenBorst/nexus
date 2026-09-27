// ── Flash order rows → plain lines for the Spot "Flash orders" panel. Pure, tested. ──────
// Input = one entry of GET /v1/orders (shape from Flash's OpenAPI; verified empty-list response
// live 2026-09-27). Nothing here decides money — it only says what an order is and where it
// stands, in the words the ticket uses. Unknown statuses/reasons fall back to Flash's own code.
import { OPEN_STATUSES } from "./flashGuards.mjs";

const STATUS_TEXT = {
  ORDER_STATUS_PENDING: "Pending",
  ORDER_STATUS_ACCEPTED: "Working",
  ORDER_STATUS_PARTIALLY_FILLED: "Partly filled",
  ORDER_STATUS_FILLED: "Filled",
  ORDER_STATUS_CANCELLED: "Cancelled",
  ORDER_STATUS_REJECTED: "Rejected",
  ORDER_STATUS_TERMINATED: "Ended",
};
// The reasons Flash documents as actionable; anything else prints as Flash's own code.
const REASON_TEXT = {
  REASON_USER_REQUESTED: "you cancelled it",
  REASON_FULLY_FILLED: "filled",
  REASON_INSUFFICIENT_ASSET_BALANCE: "the wallet balance was too low when it tried to fill",
  REASON_MAXIMUM_SLIPPAGE_EXCEEDED: "the price moved past the slippage limit",
  REASON_EXECUTION_COST_EXCEEDS_LIMIT: "gas and fees were over 30% of the order",
  REASON_ORDER_REJECTED_AT_VENUE: "network congestion; the venue rejected it",
  REASON_ORDER_TRIGGERED_ON_ENTRY: "the trigger was already crossed when it was placed",
};
const TYPE_TEXT = { market: "MARKET", limit: "LIMIT", twap: "TWAP", stop: "STOP", "stop-loss": "STOP-LOSS", "take-profit": "TAKE-PROFIT", bracket: "SL/TP" };
const PAIR_TEXT = { pending_activation: "SL/TP arms on first fill", active: "SL/TP live", never_activated: "SL/TP never armed" };

const short = (a) => (typeof a === "string" && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || "?");
const tkr = (asset) => asset?.ticker || short(asset?.address);

// Decimal string → short human number, no float drift for display-size values.
export function fmtAmount(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const a = Math.abs(n);
  if (a < 1) return n.toLocaleString("en-US", { maximumSignificantDigits: 4 });
  return n.toLocaleString("en-US", { maximumFractionDigits: a >= 1000 ? 0 : 2 });
}
const usd = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 4 : 8 });
};

function priceText(o) {
  const buy = o.side === "buy";
  const lim = usd(o.limitNotionalPrice);
  if (lim) return `${buy ? "at or below" : "at or above"} ${lim}`;
  if (o.limitCrossPrice) return `${buy ? "at or below" : "at or above"} ${fmtAmount(o.limitCrossPrice)} ${tkr(o.contraAsset)}`;
  const trig = o.trigger && typeof o.trigger === "object" ? o.trigger : Array.isArray(o.triggers) ? o.triggers[0] : null;
  const tp = trig && (usd(trig.notionalPrice) || (trig.crossPrice ? `${fmtAmount(trig.crossPrice)} ${tkr(o.contraAsset)}` : null));
  if (tp) return `${trig.triggerType === "lower" ? "if price falls to" : "if price rises to"} ${tp}`;
  if (Array.isArray(o.brackets) && o.brackets.length) {
    const legs = o.brackets
      .map((b) => {
        const p = usd(b.notionalPrice) || (b.crossPrice ? fmtAmount(b.crossPrice) : null);
        return p ? `${b.triggerType === "upper" ? "TP" : "SL"} ${p}` : null;
      })
      .filter(Boolean);
    if (legs.length) return legs.join(" · ");
  }
  return "";
}

export function describeFlashOrder(o, nowMs) {
  const buy = o?.side === "buy";
  const spend = buy ? o?.contraAsset : o?.targetAsset;
  const get = buy ? o?.targetAsset : o?.contraAsset;
  const open = OPEN_STATUSES.has(o?.status);
  const filledSpent = Number(buy ? o?.filled?.contraAmount : o?.filled?.targetAmount) || 0;
  const qty = Number(o?.qty) || 0;
  const bits = [];
  const price = priceText(o || {});
  if (price) bits.push(price);
  if (o?.orderType === "twap" && o?.twapBucketCount) bits.push(`${o.twapBucketCount} slices`);
  if (open && filledSpent > 0 && qty > 0) bits.push(`${fmtAmount(filledSpent)} of ${fmtAmount(qty)} ${tkr(spend)} filled`);
  if (o?.attachedBracket?.status && PAIR_TEXT[o.attachedBracket.status]) bits.push(PAIR_TEXT[o.attachedBracket.status]);
  // Within a day → a clock time ("ends 07:01" for a TWAP); further out → a date; none → GTC.
  let expires = "";
  if (open && o?.orderType !== "market") {
    const t = Date.parse(o?.expiresAt || "");
    const word = o?.orderType === "twap" ? "ends" : "expires";
    const now = typeof nowMs === "number" ? nowMs : Date.now();
    expires = !Number.isFinite(t) ? (o?.orderType === "twap" ? "" : "until cancelled")
      : t - now < 86400e3 ? `${word} ${new Date(t).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })}`
      : `${word} ${new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  }
  const reason = o?.closeReason && o.closeReason !== "REASON_FULLY_FILLED"
    ? REASON_TEXT[o.closeReason] || String(o.closeReason).replace(/^REASON_/, "").toLowerCase().replace(/_/g, " ")
    : "";
  return {
    id: o?.orderId || "",
    open,
    cancellable: open,
    title: `${TYPE_TEXT[o?.orderType] || String(o?.orderType || "ORDER").toUpperCase()} ${buy ? "BUY" : "SELL"} ${tkr(o?.targetAsset)}`,
    size: `${fmtAmount(o?.qty)} ${tkr(spend)} → ${tkr(get)}`,
    detail: bits.join(" · "),
    status: STATUS_TEXT[o?.status] || "—",
    reason,
    expires,
    when: o?.closedAt || o?.placedAt || "",
  };
}

// Open orders first (newest placed first), then closed ones (newest closed first).
export function sortFlashOrders(list) {
  const t = (s) => { const n = Date.parse(s || ""); return Number.isFinite(n) ? n : 0; };
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ao = OPEN_STATUSES.has(a?.status), bo = OPEN_STATUSES.has(b?.status);
    if (ao !== bo) return ao ? -1 : 1;
    return ao ? t(b?.placedAt) - t(a?.placedAt) : t(b?.closedAt || b?.placedAt) - t(a?.closedAt || a?.placedAt);
  });
}
