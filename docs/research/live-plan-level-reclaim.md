# Live plan · level_reclaim · DRAFT, not signed

Written 2026-11-07, ahead of time on purpose (borst: "the only item that directly protects real money the day
something becomes TRADEABLE"). **It arms nothing.** No flag, key, secret, mode, wallet or config changes because of this
page. borst edits it, then signs it in person, or it stays a draft.

It answers the checklist in `docs/research/live-money-review.md`, for one strategy. The gate it waits for is
`docs/research/pipeline-if-then.md` (Paper): 30+ paper trades, parity CLEAN, net positive after fees and funding.

**Why write it now.** The numbers below are easiest to choose honestly before there is a live P&L to feel. Once a
strategy is winning on paper, every limit looks too tight; once it is losing, every limit looks too loose. Fixed now,
they are just the rules.

## 1 · Where it stands (2026-11-07)

| | |
|---|---|
| Read | `level_reclaim`, served **PAPER** (73 out-of-sample events, +0.36R, beats 100% of random; holdout 48 events, +0.19R, 90.5%; graded exit +61.1 bps over 50 trades) |
| Paper wallet | `0x95e26E980e300C34360933b849457F42c6Bd7622`, from 2026-11-05 (`LEVEL_RECLAIM_PAPER_CONFIG`, 11 main-card coins, graded exit) |
| Paper record | 1 closed trade, +$10.36 after fees + funding (`/paper-costs`, taker 2.5 bps a side, the account's rate); parity **CLEAN** (2 entries matched, 4 events missed with a reason: one position at a time) |
| Gate | 30 paper trades, parity CLEAN, net > 0 after fees + funding. At the pace so far (about 2 entries in 2.5 days), that is **mid-to-late December**. |

None of the numbers above is a reason to arm. They say where the clock is.

## 2 · What the graded stop actually looks like

The graded exit's stop is 1.2× the coin's H4 ATR-14. Measured at every `level_reclaim` event on the 11 traded coins over
the last 60 days (117 events, a sizing input, not an outcome):

| | stop distance |
|---|---|
| median | 2.21% |
| 75th percentile | 3.06% |
| 90th percentile | 3.91% |
| widest | 6.60% (WLD) |
| tightest coins (median) | BTC 1.14%, BNB 1.14% |
| widest coins (median) | WLD 4.33%, ARB 4.27% |

**The consequence.** Today the agent sizes every trade by margin (`notional = capitalPerTrade × leverage`). With stops
from 1.1% to 6.6%, a fixed size means a WLD trade risks about 6× more dollars than a BTC trade. The graded record weighs
every trade as 1R, so a fixed-size live record would not be the thing that was graded. (The exit-gap study found the
read's losses concentrated in its widest stops: fixed sizing would bet the most exactly there.)

## 3 · The plan

| field | the plan |
|---|---|
| Strategy | `level_reclaim` with the graded exit (`exitContract: "R_CONTRACT"`), the same 11 coins, the same config as the paper wallet except the size fields below. Nothing tuned. |
| Wallet | A **new, dedicated** wallet holding only the risk capital. Never the treasury Safe, never borst.eth, never a wallet holding anything else. |
| Account size | **$1,000 USDC** deposited to that wallet's Orderly account. That is the most this plan can lose. |
| Size | **Fixed risk: $10 per trade (1R = 1% of the account).** Notional = $10 ÷ the trade's graded stop %. At the median stop (2.21%) that is about $450; at the widest seen (6.6%) about $150; at BTC's 1.1% about $900. |
| Leverage | **3×.** The largest notional above needs about $300 of margin, well inside the -1101 margin rule (≤ 60% of free collateral). At 3× the liquidation distance (~30%) is far beyond the widest stop (6.6%). |
| Daily cap | `maxDailyLossUsdc` **$30** (3 stops). `maxTradesPerDay` **4** (with one position at a time it rarely binds; the paper wallet's wide caps never did). |
| Total cap | **−$100 (−10R) from the start of live ⇒ kill, back to paper, written up.** Not a pause. Why −10R: with the edge the board grades (+0.36R a trade), losing 10R in the first 30 trades is rare; with no edge it is likely. So hitting it is evidence, not bad luck. |
| First tranche | **10 live trades**, then a written compare before trade 11: slippage (live fill vs the mark, now booked per trade since #262), fees as charged, and parity of live vs the paper wallet over the same hours. The paper wallet keeps running alongside the whole time as the control. |
| Key | An auth v2 random Orderly key (`read,trading` scope, 30 days, cannot withdraw alone), sealed at rest. Not the v1 fixed-signature key. |
| Kill switch | Lab KILL / `POST /agent/:a/kill` (closes, then deletes the key; retries; Telegrams after 10 tries). **Tested on the live wallet with a dust position before the first real trade.** The platform live-entry pause (`ops:halt:live`, `/ops/revenue`) stays one tap away. |
| Who signs | borst, in person. The PR that arms records the date and that it was him. |

## 4 · Stop rules (any one ⇒ back to paper the same day)

1. Total loss reaches −10R ($100) since the start of live.
2. Parity reads DRIFT on the live wallet or the paper wallet.
3. The read leaves PAPER on the served scoreboard (any stage change down, or RETIRED).
4. Average entry slippage over the first 10 trades is worse than **5 bps a side** (the paper record has none, so more
   than that eats the edge the paper record shows).
5. The live record over the first 10 trades is below the paper wallet's record over the same hours by more than fees
   and slippage explain.
6. Exec's "down > 10 min" alert fires while a position is open: close it by hand first, investigate second.

## 5 · What must be built before this can be armed (each its own reviewed PR, none of them now)

1. **Fixed-risk sizing.** A config field (`riskPerTradeUsd`) that sizes the notional from the trade's own graded stop,
   in exec, the backtest replay and parity alike (one rule, every surface), so live P&L ÷ $10 = the graded R.
   **Built 2026-11-07, PAPER only** (`app/lib/riskSizing.mjs`): exec, the per-market + portfolio replays and the
   random baseline book each trade at its own notional; parity is unaffected (sizing never changes when an entry
   happens). `capitalPerTrade` is the margin ceiling. Refused live until build #3.
2. **An exchange-side backstop stop.** Today the stop lives only in exec (checked every minute, closed at market). If the
   worker stalls, an open position has no stop. Each live entry should also place a reduce-only stop order on Orderly
   at 1.5× the graded stop: never hit in normal operation, it only catches a stalled worker. Cancelled on every exit.
3. **Lift `gradedExitRefusal` for this one wallet and this one read only.** It refuses every non-PAPER config today, on
   purpose. The lift is scoped by address and read, tested, and states why no stop cap is needed (fixed-risk sizing
   makes a wide stop a smaller position, not a bigger loss).
4. **A live-vs-paper compare** for the first tranche (slippage, fees, parity), read-only.

## 6 · Never

- No arming by a session, a scheduled task or a PR merge. Arming is borst, in person.
- No arming before the gate in section 1 is met as served, or after the read drops below PAPER.
- No size increase until the first tranche's compare is written and signed. A bigger size is a new dated plan.
- No user funds, no copy-into-live for other wallets, until this house strategy has its own live record.
- No changing a number on this page after live starts. A changed number is a new dated page.

## Sign-off

(Blank. borst writes the date and "signed" here, in person, when he agrees with every number above.)
