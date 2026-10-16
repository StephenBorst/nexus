# rsi_reset_deep · registered into the read pipeline

Registered 2026-10-16 (borst: "yes to the rsi_reset_deep work: holdout plus a graded-exit line, and run the overlap
check against basis × CVD"). **Out-of-sample events start at 2026-10-17T00:00:00Z.** Stages and bars follow
`docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## The rule (unchanged since it went on the scoreboard in September; `axisbt.mjs` `rsiResetDeepEvents`)

On the hourly price the brain records (`oi:hist`), for each market:
- RSI-14 makes a local trough: the bar before is higher, the bar after is higher.
- The trough is **below 45**.
- At the bar after the trough, price is **above its EMA-50**. This is the uptrend test, done at the reset with no
  lookahead.
- Side: LONG. Every qualifying reset counts, including the ones that later fail.

Entries are graded on the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h).

## Disclosed before the numbers

This read was **picked by looking at the scoreboard**. It is one of about 20 reads, and the best-looking one after
basis × CVD. Its full-history grade when registered (2026-10-16): PREDICTIVE, +0.19R over 144 events, beating 90.2% of
random longs. On Sept 25 it beat 97%. A survivor picked from 20 should be expected to fall back. **That number is
in-sample and decides nothing.** Only events from 2026-10-17T00:00:00Z on count.

## What it gets

1. **An out-of-sample grade** on the main card (`oos` on its axis row).
2. **A holdout line**: the same rule on the 8 holdout coins (ZEC NEAR SUI PUMP ENA ONDO INJ ZRO), out of sample by
   time and by coin. The rule needs 69 hourly prices before it can fire, and those coins started recording on
   2026-10-16, so nothing can show before about Oct 19.
3. **A graded-exit line**: the R contract traded the way the agent would trade it (fees, market close at 168h, one
   position per market), with its own out-of-sample cutoff of 2026-10-17T00:00:00Z.
4. **An overlap check** against basis_x_cvd: how often the two fire on the same coin and side within 24 hours. Both
   are long-only, and two reads that fire together are one bet.

## The bar

The pipeline's, unchanged (`app/lib/readPipeline.mjs`):
- Lead: 30 out-of-sample events, mean R > 0, halves agree.
- Edge: beats 95% of random longs on the main card, and on the holdout 30 events with mean R > 0 and 80% vs random.
- Tradeable: graded exit net > 0 over 30 out-of-sample trades.
- Retired: 100 out-of-sample events on either line with mean R ≤ 0 or worse than random.

No agent mode, preset or wallet exists for it, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
