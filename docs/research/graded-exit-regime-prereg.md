# Basis × CVD graded exit — regime window · pre-registered before its numbers

Written 2026-10-26. **Not signed yet.** Events count from the next 00:00 UTC after borst signs (the sign-off block at
the end records both). Until it is signed, nothing on this page counts and no number is read under it.

Everything above "Results" is fixed once signed. A change to any rule below = a new dated page, never an edit here.
`docs/research/graded-exit-prereg.md` (the retired test) is not edited by this page.

## Disclosed before anything else

- **Registered right after the prior test failed.** The graded-exit test (`graded-exit-prereg.md`) was retired
  2026-10-26 under its own bar: the read fell to PROMISING, and "the read itself falls below PREDICTIVE" was a Fail at
  any point. This page was written the same day. It is a new test with new rules, not a rescue of the old one.
- **The read currently grades PROMISING.** At 2026-10-26T01:23:48Z basis_x_cvd read PROMISING (R +0.04 over 90 events,
  40% hit, not stable) on `GET /intel/axis-backtest`. That grade includes the history the read was picked on.
- **This is the third exit tested on the same entries.** (1) The Basis × CVD Stack preset exit, TP 2.5% / SL 2% / 12h:
  lost out of sample (−33.9 bps over 20 trades, Oct 15). (2) The same with a 24h hold: lost out of sample (−30.2 bps
  over 20, Oct 15). (3) The graded exit: retired on the read with 4 out-of-sample trades (+44.9 bps). Each extra exit
  tried on the same entries raises the chance that one passes by luck. The bars below are set with that in mind.
- **Why a regime window.** Every basis trade on record has been LONG: the OKX perp sits at a persistent discount to
  spot, so the zero-anchored basis extreme is nearly always the deepest discount. The read has never been tested in a
  sustained downtrend. This page makes a DOWN market a condition of the test.

## What is tested (unchanged from the retired test)

- **The read:** basis_x_cvd, the same rule the brain trades and the scoreboard grades (`app/lib/basisFade.mjs` +
  `app/lib/basisStack.mjs`, `BASIS_FADE` + `basisConfirm: "CVD"`). No change to it.
- **The exit:** the graded exit, `app/lib/gradedExit.mjs` (`exitContract: "R_CONTRACT"`): stop 1.2 × the coin's H4
  ATR-14 at entry (80 hours of 1H candles, `h4Atr14Frac`), target 1.5 × the stop, held up to 168 hours then closed at
  the market. No ATR, or a stop past 20%, sits the entry out. Nothing else on the exit. Paper only.
- **The line:** the scoreboard's graded-exit line for basis_x_cvd, as the agent trades it: one position per market,
  the agent's own exit code (`stepExit`), net of 3 bps taker fee per side, a trade still open at 168 hours closed at
  that bar. A trade counts once its full 168-hour window has passed, even if it closed sooner.
- **Markets:** the main card is the nine the read was picked on (BTC ETH SOL BNB XRP LINK DOGE AVAX HYPE). The holdout is
  the eight it was never looked at on (ZEC NEAR SUI PUMP ENA ONDO INJ ZRO, `app/lib/recordedUniverse.mjs`). They are
  never pooled.

## The window

**Start (`registeredAt`):** the next 00:00 UTC after borst signs. Only trades and events entered at or after it count.
Every trade and event before it, including the 4 out-of-sample trades of the retired test, stays with the retired test.

**The regime, in numbers.** For each UTC day in the window: BTC's 30-day return = that day's close ÷ the close 30 days
earlier − 1, on Orderly daily candles for `PERP_BTC_USDC` (`/tv/history`, resolution `D`).

- **UP** = ≥ +10% · **DOWN** = ≤ −10% · **FLAT** = anything between.
- **The regime condition is met** when the window holds at least 14 days (not necessarily in a row) in each of two
  different states, and one of the two is DOWN.

**Judgment** happens on the first day either of these is true:

1. at least 30 counted trades on the main-card line AND the regime condition is met; or
2. six calendar months have passed since `registeredAt`.

It is judged once. The result is final.

## The bar (all on events and trades at or after `registeredAt`)

At judgment, read in this order:

1. **INCONCLUSIVE**: fewer than 30 counted trades at six months. Retired as inconclusive. No extension.
2. **FAILS**: net after fees ≤ 0 over all counted trades.
3. **CLEARS**: every one of these holds:
   - net after fees > 0 over at least 30 counted trades;
   - the read on the main card, out-of-sample events only: at least 30 R-graded events, mean R > 0, and the first and
     second halves (by time) agree in sign;
   - those events beat at least 95% of random entries on LONG (the scoreboard's random-entry test: same market, same
     side, same R contract, 300 seeded replays). Any SHORT events are reported beside it;
   - the holdout repeats it, out-of-sample events only: at least 30 events, mean R > 0, LONG beats at least 80% of
     random entries.
4. **NOT CLEARED**: net after fees > 0 but at least one other bar in 3 is missed. Retired, with the bar that was missed
   named. No extension.

**Label:** a result judged at six months without the regime condition met carries "regime condition not met", plus
the states the window saw and their day counts (for example "one regime only: UP 140 days, FLAT 42 days"). It is
judged by the same bar.

**The read's old-data grade decides nothing.** If basis_x_cvd grades below PREDICTIVE on the scoreboard during the
window, it is noted under Results with the date. It does not retire the test. The window runs to judgment.

## Reported, not judged

- **Funding.** The counted trades net of the funding each paid or earned while open, by the scoreboard's existing
  estimate (`exitGraded.funding`, `heldFundingBps` in `app/lib/funding.mjs`: oi:hist's per-8h rate spread over the hours
  held; a trade without full coverage is left out and counted as missing, never read as free). Reported beside the
  fee-net number on the SAME covered trades. Information only: it does not change the bar.
- **The paper wallet** `0x9A3012988d60D61b34660BE06a321F7BF7bCcB28` keeps running as it is (Basis × CVD Stack preset,
  graded exit on, the nine markets). Its trades entered at or after `registeredAt` are this test's paper record; its
  earlier trades stay with the retired test. It is the check that the agent trades what the line grades: its parity
  (`GET /agent/:addr/parity`) must read CLEAN. If it reads DRIFT, the result waits until the drift is explained. Its
  own P&L is reported beside the line and does not decide. Paper P&L subtracts no fees and no funding.
- **The fee assumption.** The line uses 3 bps per side. Our real taker fee may be higher; any live use goes through
  `docs/research/live-money-review.md`, which re-reads trades at the real fee.

## Needed before it can be read (not built by this page)

Each is its own PR, on borst's go, merged before the first counted trade resolves (the earliest: 168 hours after
`registeredAt`).

1. **Scoreboard start date.** Today the graded-exit line counts trades from 2026-10-16 and the read's random and
   holdout grades run over all history. This test needs a second graded-exit line for basis_x_cvd counted from
   `registeredAt`, and the read's out-of-sample, random and holdout grades on events at or after it (the way the
   registered pipeline reads are graded), plus the regime day counts and the funding estimate on the same trades. An
   engine change, reviewed on its own.
2. **Watcher entry.** `docs/research/pipeline-stages.json` holds the retired test as FAILS, which is final. This test
   needs its own entry and status rule in `app/lib/pipelineWatch.mjs`, so the daily watcher reports its judgment
   instead of an issue.
3. **Shelf row.** The strategy shelf shows the retired test as Retired. This test needs its own row (counting, what it
   needs, the regime days so far), with Load still off.

Until all three are merged, nothing under this page is read and nothing is reported as its result.

## What this page doesn't do

It changes no code, threshold, preset, wallet, flag, x402 feed or house-caller setting. It arms no live money. A
CLEARS here follows `docs/research/pipeline-if-then.md` from its Tradeable rules: the /proof headline, a paper-only
preset proposed in its own PR, x402 and the house caller only on borst's go, live money only through the
live-money review, signed by borst in person.

## Sign-off

(Appended at signing. Never edited after.)

- Signed by: —
- Signed at (UTC): —
- `registeredAt` (the next 00:00 UTC after signing): —
- Six-month limit (`registeredAt` + six calendar months): —

## Results

(Append below. Never edit above this line.)
