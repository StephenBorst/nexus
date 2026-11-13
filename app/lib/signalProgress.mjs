// The signals that cleared the bar, and how far each has got on paper. One rule for GET /calls/pulse (the landing's
// record panel) and /proof. Display only: it reads the served scoreboard and a paper wallet's lifetime record, and
// claims nothing the stage doesn't.
//
// A read is listed when the scoreboard serves it TRADEABLE or PAPER with a positive graded-exit net over its trades:
// the same test as the /proof headline (proofHeadline, proofCopy.mjs). For a read with a paper wallet
// (readPipeline.mjs registration), `paper` = that wallet's lifetime paper trades (state.paper_agg.trades, accrued at
// close by exec) against the signed gate PAPER_MIN_TRADES. Trade COUNT only: paper P&L has no fees or funding, so a
// number about money from it would overstate; the after-cost read is GET /agent/:a/paper-costs. An unreadable wallet
// = `trades: null` ("unread"), never 0.
import { registrationFor, PAPER_MIN_TRADES } from "./readPipeline.mjs";

const CLEARED = new Set(["TRADEABLE", "PAPER"]);

/**
 * @param {object|null} scorecard the served /intel/axis-backtest payload
 * @param {Record<string, number|null>} paperTrades lowercased wallet → lifetime paper trades (null = unread)
 * @returns {{ axis:string, stage:string, trades:number, netBps:number, paper: null | { wallet:string, trades:number|null, target:number } }[]}
 */
export function signalProgress(scorecard, paperTrades = {}) {
  const reads = Array.isArray(scorecard?.pipeline?.reads) ? scorecard.pipeline.reads : [];
  const out = [];
  for (const r of reads) {
    const trades = Number(r?.numbers?.exitTrades), netBps = Number(r?.numbers?.exitNetBps);
    if (!r || typeof r.axis !== "string" || !CLEARED.has(r.stage) || !(trades > 0) || !(netBps > 0)) continue;
    // The served row carries the wallet (code registration or a signed claim, paperClaim.mjs); older payloads don't.
    const wallet = registrationFor(r.axis)?.paperWallet || (typeof r.paperWallet === "string" ? r.paperWallet : null);
    const count = wallet ? paperTrades[wallet.toLowerCase()] : undefined;
    out.push({
      axis: r.axis, stage: r.stage, trades, netBps: Math.round(netBps * 10) / 10,
      paper: wallet ? { wallet, trades: Number.isFinite(count) ? count : null, target: PAPER_MIN_TRADES } : null,
    });
  }
  return out;
}

/** "On paper: 3 of 30 trades" · "On paper: count unread" · "Paper wallet next" — one plain line per read. */
export function paperLine(p) {
  if (!p?.paper) return "Paper wallet next.";
  if (p.paper.trades == null) return "On paper: count unread right now.";
  return `On paper: ${p.paper.trades} of ${p.paper.target} trades.`;
}

/** Wallets whose paper count the pulse should read for this scorecard. */
export function paperWalletsFor(scorecard) {
  return signalProgress(scorecard).map((x) => x.paper?.wallet).filter(Boolean);
}
