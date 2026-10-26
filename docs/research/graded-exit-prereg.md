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

### Setup · 2026-10-16

- **Fourth paper wallet = `0x9A3012988d60D61b34660BE06a321F7BF7bCcB28`**, record reset 2026-10-16T00:29:06Z (its
  `paper_reset_at`). Config read back from `GET /agent/:addr` at 00:35 UTC: PAPER · BASIS_FADE + CVD · `exitContract:
  R_CONTRACT` · 168h · $50 · 5x · 3 trades/day · $10 daily stop · the nine markets · no ladder, trail, breakeven, DCA,
  vol-scaled stops or entry filters. `gradedExitRefusal` on that config = none. Parity: NO_DATA (0 trades), axis
  basis_x_cvd.
- **This wallet was the 12h control** (Oct 15: 6 paper trades, +$5.50, parity CLEAN, in `docs/routines/oct15-results.md`).
  Its ledger was reset for this test, so the 12h preset exit no longer has a paper wallet. The scoreboard's 12h `exit`
  line keeps grading that exit out of sample. The paper control for this wallet is the nine-market 24h arm
  `0x325Da3ed024f533764407524918a847bCb3f95DE`: the same nine markets and entries, the preset exit. "The three existing
  paper wallets keep running unchanged" above now reads two: the 24h arm and the nine-market arm.
- The $10 daily stop is the preset's. With $250 notional, a graded stop past 4% loses the whole day's allowance on one
  trade, so some graded events will be missed on the daily cap; parity names those as explained (likely), not drift.

### Result · 2026-10-26 · FAILS (retired)

- `GET /intel/axis-backtest` at 2026-10-26T01:23:48Z: basis_x_cvd grades **PROMISING** (R +0.04 over 90 events, 40%
  hit, not stable), below PREDICTIVE. The bar above: "the read itself falls below PREDICTIVE" = Fails, at any point.
- The line at that moment: out of sample 4 trades, 50% win, +44.9 bps net (since 2026-10-16). LONG vs random 93.5%.
  Not enough trades to say anything about the exit itself; it fails on the read.
- borst, 2026-10-26: retired under the bar as written. **The graded-exit variant is retired.** Its paper wallet
  `0x9A3012988d60D61b34660BE06a321F7BF7bCcB28` keeps running and stays as a record; its numbers decide nothing.
- Final, whatever the read grades later. The scoreboard keeps grading the line (no engine change); /proof and the
  Agent tab's strategy shelf label it Retired (`RETIRED_GRADED_EXITS`, app/lib/proofCopy.mjs). Recorded in
  `docs/research/pipeline-stages.json`.
- A version judged only at 30 trades would be a new dated registration, never an edit to this page.
