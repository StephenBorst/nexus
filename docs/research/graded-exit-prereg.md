# The graded exit · pre-registered before its numbers

Written 2026-10-16, before any out-of-sample trade exists. Decided by borst 2026-10-15 ("go on the graded-exit
variant"), on two conditions: (1) the as-traded scoreboard line ships before the fourth wallet starts, so the early
data is never read on the kinder grade alone; (2) the uncapped stop stays paper-only and never reaches live money
without its own review.

Everything above "Results" is fixed. A change to a threshold = a new dated page, never an edit here.

## The question

Basis × CVD's entries beat 97.3% of random entries on Oct 15 (PREDICTIVE, +0.19R over 62 events), graded with the
scoreboard's R contract. The preset trades a different exit (TP 2.5% / SL 2% / 12h), and that exit lost out of sample
(12h −33.9 bps over 20 trades, 24h −30.2 bps over 20). Does the read make money when the agent trades the exit it was
graded on?

## The exit (the R contract, `app/lib/rContract.mjs`; rule in `app/lib/gradedExit.mjs`)

- Stop = 1.2 × the coin's H4 ATR-14 at entry, built from the last 80 hours of 1H candles (`h4Atr14Frac`, the same
  function the R grade uses).
- Target = 1.5 × the stop.
- Hold up to 168 hours, then closed at the market.
- No ATR, or a stop past 20% (bad data) → the agent sits that entry out. Never a fallback to the flat %.
- Nothing else on the exit: no take-profit ladder, trailing stop, breakeven, DCA or vol-scaled stops. A config with
  any of them is refused.

## Paper only

`gradedExitRefusal` refuses the graded exit on any mode but PAPER. Exec checks it before any price read, key read,
order or state write. lab-api refuses to store it on a live config and refuses a mode flip out of PAPER while it is on.
Lifting this = editing that rule in its own reviewed PR. The 3% stop cap on vol-scaled stops is unchanged.

## The two measurements

1. **The scoreboard line `exitGraded`** on basis_x_cvd (`GET /intel/axis-backtest`, `axisbt.mjs scoreGradedExit`):
   every graded event, one position per market, traded through the exit above with the agent's own exit code
   (`stepExit` → exec `evaluateExit`), net of 3 bps taker fee per side, a trade open at 168h closed at that bar.
   Entries in the last 168h of each market's candles wait until they can resolve.
   **Out of sample = trades entered after 2026-10-16T00:00:00Z** (`GRADED_EXIT_OOS_CUTOFF_MS`).
2. **A fourth paper wallet**: the Basis × CVD Stack preset (BASIS_FADE, CVD confirm, $50, 5x, 3 trades/day, $10 daily
   stop) with GRADED EXIT on, watchlist = the nine mature markets (BTC ETH SOL XRP HYPE BNB DOGE AVAX LINK). Its record
   starts at its reset. Parity (`GET /agent/:addr/parity`) must read CLEAN for its trades to count.

The three existing paper wallets keep running unchanged as the control.

## The bar

Read only `exitGraded.oos` and the read's own grades, from `GET /intel/axis-backtest`.

- **Clears**: `oos` net bps > 0 over at least 30 trades, AND basis_x_cvd still PREDICTIVE on R AND BEATS_RANDOM (95%+)
  on LONG on the same read. This is the Oct 4 page's own "Clears" bar, with the graded exit as the exit. A clear means
  Basis × CVD can go back on the /proof lead with this exit, and a preset trading it can be proposed. It does NOT arm
  live money: that is its own review (condition 2).
- **Fails**: `oos` net bps ≤ 0 at 30 trades or more, OR the read itself falls below PREDICTIVE. The variant is retired;
  its wallet stays as a record.
- **Not yet**: fewer than 30 out-of-sample trades. Nothing changes.
- The fourth wallet is the check that the agent trades what the line grades. Its own P&L is reported beside the
  line but does not decide on its own: one position across nine markets with 7-day holds will take many weeks to
  reach 30 trades. If its parity reads DRIFT, the line's result waits until the drift is explained.

Expect it to take a while. The line accrues per market (about nine positions at once), the wallet one at a time.

## Results

(Append below. Never edit above this line.)
