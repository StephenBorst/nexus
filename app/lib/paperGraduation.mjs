// ── "Ready to go live?" by the house rules (borst 2026-11-27, Agent tab pass) ───────────────────────────────────────
// The Agent tab used to show READY TO GO LIVE? with a "Go autonomous" button once a paper agent had 5 trades and a
// positive net. Paper P&L has no fees and no funding (computePnl), and 5 trades is noise: copy running ahead of the
// grade. This is the card by the same bar the house judges its own reads on (paper-judgment pages: 30 trades, judged
// after fees and funding):
//   · under 30 lifetime trades: the count of 30, nothing to switch,
//   · 30+ and after-cost net ≤ 0: says so, nothing to switch,
//   · 30+ and after-cost net > 0: "a reason to look closer, not proof", and the one step it offers is ASSISTED
//     (signals only; you place each order). AUTONOMOUS stays in the mode picker with its own GO LIVE confirm; this
//     card never offers it.
// The user's own record, never a grade of a read. Pure + tested (paperGraduation.test.mjs).

export const GRADUATION_TRADES = 30;

const usd = (v) => `${v >= 0 ? "+" : "−"}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * @param {{ lifetimeTrades: number|null, costs: { trades: number, netUsd: number, grossUsd: number } | null }} p
 * @returns {{ stage: "COUNTING"|"LOST_AFTER_COSTS"|"LOOK_CLOSER"|"UNREAD", title: string, line: string, offerAssisted: boolean }}
 */
export function graduation({ lifetimeTrades, costs }) {
  const n = Number(lifetimeTrades);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n < GRADUATION_TRADES) {
    return {
      stage: "COUNTING", title: `PAPER RECORD · ${n} OF ${GRADUATION_TRADES} TRADES`, offerAssisted: false,
      line: `Live money is judged on ${GRADUATION_TRADES} paper trades after fees and funding, the same bar the house reads are held to. ${GRADUATION_TRADES - n} to go. Paper P&L is the price move only.`,
    };
  }
  if (!costs || !Number.isFinite(Number(costs.netUsd)) || !(Number(costs.trades) > 0)) {
    return { stage: "UNREAD", title: `PAPER RECORD · ${n} TRADES`, offerAssisted: false,
      line: "Couldn’t read the after-costs check just now, so nothing here says this is ready. It re-reads with the record." };
  }
  const net = Number(costs.netUsd), counted = Number(costs.trades);
  const span = counted < n ? `the last ${counted} of ${n} trades` : `${counted} trades`;
  if (net <= 0) {
    return { stage: "LOST_AFTER_COSTS", title: `PAPER RECORD · ${n} TRADES`, offerAssisted: false,
      line: `After fees and funding, ${span} come to ${usd(net)}. Live, that is a loss before slippage. Nothing to switch on.` };
  }
  return {
    stage: "LOOK_CLOSER", title: `PAPER RECORD · ${n} TRADES`, offerAssisted: true,
    line: `After fees and funding, ${span} come to ${usd(net)}. A reason to look closer, not proof: paper fills at the mark, with no slippage, and this is one record on one stretch of market. The next step is ASSISTED: the agent signals, you place each order.`,
  };
}
