// Risk desk (2026-11-15, borst: "what's missing for traders?"). The connected account's open positions, read for
// risk in plain words: how far liquidation sits, what the resting stop would lose (and whether it sits past
// liquidation, where it never fires), what funding costs a day at the current estimate, and how the book adds up
// against the account. Facts about the trader's own book, never advice or a grade. Computed in the browser from the
// Orderly SDK's position stream; nothing leaves the device. Pure, tested.

const num = (v) => { const x = typeof v === "number" ? v : parseFloat(String(v ?? "")); return Number.isFinite(x) ? x : null; };
const r2 = (v) => Math.round(v * 100) / 100;

export const LIQ_NEAR_PCT = 5;      // liquidation this close (% of the mark) = a warning
export const LIQ_WATCH_PCT = 10;    // and this close = worth a look
export const DEFAULT_FUNDING_PERIOD_H = 8;

const coinOf = (s) => String(s ?? "").toUpperCase().replace(/^PERP_/, "").replace(/_USDC$/, "");

/**
 * One position's risk.
 * @param {object} row  SDK position row (position_qty, mark_price, est_liq_price, full_tp_sl, partial_tp_sl, symbol)
 * @param {{ fundingRate?: number|null, fundingPeriodH?: number|null, equity?: number|null }} ctx
 */
export function positionRisk(row, { fundingRate = null, fundingPeriodH = null, equity = null } = {}) {
  const qty = num(row?.position_qty), mark = num(row?.mark_price);
  if (qty == null || qty === 0 || mark == null || mark <= 0) return null;
  const long = qty > 0, size = Math.abs(qty), notional = r2(size * mark);
  const liqRaw = num(row?.est_liq_price);
  const liq = liqRaw != null && liqRaw > 0 ? liqRaw : null;
  const liqDistPct = liq == null ? null : r2(((long ? mark - liq : liq - mark) / mark) * 100);
  const lossToLiq = liq == null ? null : r2(size * Math.abs(mark - liq));

  const fullSl = num(row?.full_tp_sl?.sl_trigger_price);
  const partSl = num(row?.partial_tp_sl?.sl_trigger_price);
  const sl = fullSl != null && fullSl > 0 ? fullSl : null;
  const stop = sl == null
    ? { kind: partSl != null && partSl > 0 ? "partial" : "none" }
    : (() => {
        const onLossSide = long ? sl < mark : sl > mark;
        const pastLiq = liq != null && (long ? sl <= liq : sl >= liq);
        return {
          kind: "full", price: sl, pastLiq,
          lockedIn: !onLossSide,
          distPct: r2((Math.abs(mark - sl) / mark) * 100),
          loss: onLossSide ? r2(size * Math.abs(mark - sl)) : 0,
        };
      })();

  const rate = num(fundingRate);
  const period = num(fundingPeriodH) && fundingPeriodH > 0 ? fundingPeriodH : DEFAULT_FUNDING_PERIOD_H;
  // Positive rate: longs pay shorts. Negative result = this position pays.
  const fundingPerDay = rate == null ? null : r2(-(long ? 1 : -1) * rate * (24 / period) * notional);

  const eq = num(equity) && equity > 0 ? equity : null;
  return {
    coin: coinOf(row?.symbol), symbol: row?.symbol, side: long ? "LONG" : "SHORT", size, mark, notional,
    liq, liqDistPct, lossToLiq, stop, fundingPerDay,
    shareOfEquity: eq == null ? null : r2(notional / eq),
    stopShareOfEquity: eq == null || stop.kind !== "full" ? null : r2((stop.loss / eq) * 100),
  };
}

/** Flags for one position, most serious first: { level: "warn" | "watch", text }. */
export function positionFlags(p) {
  if (!p) return [];
  const out = [];
  if (p.stop.kind === "full" && p.stop.pastLiq) out.push({ level: "warn", text: `Your ${p.coin} stop sits past liquidation. Liquidation comes first, so the stop never fires.` });
  if (p.liqDistPct != null && p.liqDistPct <= LIQ_NEAR_PCT) out.push({ level: "warn", text: `${p.coin} liquidation is ${p.liqDistPct.toFixed(1)}% from the mark.` });
  else if (p.liqDistPct != null && p.liqDistPct <= LIQ_WATCH_PCT) out.push({ level: "watch", text: `${p.coin} liquidation is ${p.liqDistPct.toFixed(1)}% from the mark.` });
  if (p.stop.kind === "none") out.push({ level: "watch", text: `No stop resting on ${p.coin}. The loss is open until liquidation${p.lossToLiq != null ? ` (about ${usd(p.lossToLiq)})` : ""}.` });
  if (p.stop.kind === "partial") out.push({ level: "watch", text: `${p.coin} has a stop on part of the position only.` });
  return out;
}

/**
 * The whole book against the account.
 * @param {object[]} rows SDK rows
 * @param {{ equity?: number|null, funding?: Record<string, number>, periods?: Record<string, number> }} ctx
 *   funding / periods keyed by SDK symbol (PERP_ETH_USDC)
 */
export function riskDesk(rows, { equity = null, funding = {}, periods = {} } = {}) {
  const positions = (Array.isArray(rows) ? rows : [])
    .map((r) => positionRisk(r, { fundingRate: funding?.[r?.symbol], fundingPeriodH: periods?.[r?.symbol], equity }))
    .filter(Boolean)
    .sort((a, b) => b.notional - a.notional);
  const eq = num(equity) && equity > 0 ? equity : null;
  const gross = r2(positions.reduce((s, p) => s + p.notional, 0));
  const net = r2(positions.reduce((s, p) => s + (p.side === "LONG" ? p.notional : -p.notional), 0));
  // A stop past liquidation never fires: that position counts as unstopped, its stop's loss is not "at stops".
  const works = (p) => p.stop.kind === "full" && !p.stop.pastLiq;
  const stopped = positions.filter(works);
  const atStops = r2(stopped.reduce((s, p) => s + p.stop.loss, 0));
  const unstopped = positions.filter((p) => !works(p)).map((p) => p.coin);
  const fundRows = positions.filter((p) => p.fundingPerDay != null);
  const fundingPerDay = fundRows.length ? r2(fundRows.reduce((s, p) => s + p.fundingPerDay, 0)) : null;

  const flags = positions.flatMap(positionFlags);
  const longs = positions.filter((p) => p.side === "LONG").length, shorts = positions.length - longs;
  const sameSide = Math.max(longs, shorts);
  if (sameSide >= 2 && (longs === 0 || shorts === 0)) {
    flags.push({ level: "watch", text: `${sameSide} ${longs ? "longs" : "shorts"}, no offset. Crypto tends to move together, so they can act like one bigger ${longs ? "long" : "short"}.` });
  }
  flags.sort((a, b) => (a.level === b.level ? 0 : a.level === "warn" ? -1 : 1));

  return {
    positions, equity: eq, gross, net,
    leverage: eq == null || !positions.length ? null : r2(gross / eq),
    atStops, atStopsPct: eq == null || !stopped.length ? null : r2((atStops / eq) * 100),
    unstopped, fundingPerDay, flags,
  };
}

/** $1,234 / $12.40 / $0.42: whole dollars from $1,000. */
export function usd(v) {
  const x = num(v);
  if (x == null) return "—";
  const a = Math.abs(x);
  const body = a >= 1000 ? Math.round(a).toLocaleString("en-US") : a.toFixed(2);
  return `${x < 0 ? "−" : ""}$${body}`;
}

/** The Trade page's one line for the position on screen. */
export function riskLine(p) {
  if (!p) return null;
  const parts = [`Your ${p.side.toLowerCase()}`];
  parts.push(p.liqDistPct == null ? "no liquidation price read" : `liquidation ${p.liqDistPct.toFixed(1)}% away`);
  if (p.stop.kind === "full") {
    if (p.stop.pastLiq) parts.push("stop past liquidation (never fires)");
    else if (p.stop.lockedIn) parts.push("stop locks in profit");
    else parts.push(`stop loses ${usd(p.stop.loss)}${p.stopShareOfEquity != null ? ` (${p.stopShareOfEquity.toFixed(1)}% of account)` : ""}`);
  } else parts.push(p.stop.kind === "partial" ? "stop on part only" : "no stop");
  if (p.fundingPerDay != null && Math.abs(p.fundingPerDay) >= 0.01) parts.push(`funding ${p.fundingPerDay < 0 ? "pays" : "earns"} ${usd(Math.abs(p.fundingPerDay))}/day`);
  return parts.join(" · ");
}

export const RISK_NOTE = "From your open positions, in this browser. Liquidation is Orderly’s estimate; funding is the current estimated rate, and it changes every period.";
