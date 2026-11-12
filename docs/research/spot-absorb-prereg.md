# spot_absorb · registered into the read pipeline

Registered 2026-11-06 (borst's go: "make it all happen"). Batch 3. From `docs/research/spot-perp-cvd-draft.md`.

**Out-of-sample events start at 2026-11-20T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why this read exists

When a move is led by the perp book while the spot book trades the other way, the perp flow is leverage and the spot
flow is ownership. If open interest isn't growing, nobody new is committing to the perp side either. The claim: spot is
absorbing the perp flow, and price follows spot.

It could not be tested before 2026-11-05: `cvd:hist` is the perp book only. `spotcvd:hist` (the spot book, same fold)
records from 2026-11-05. **The thresholds below were fixed before any spot row was graded or looked at for this rule.**

## Shared terms

- **Code.** The rule is `spotAbsorbEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`), graded on
  the scoreboard (`axisbt.mjs` `AXES`). The scoreboard loads `spotcvd:hist:{COIN}` into each coin set as
  `spotCvdHist`; on the main card a holdout coin's spot series is emptied like its basis and perp CVD
  (`withoutHoldoutFlow`). `explorerReads.test.mjs` checks the rule on hand-built data and checks for lookahead.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO (the spot series records on every flow coin,
  holdout included). On the main card, SUI's events are left out of the out-of-sample grade.
- **Why 2026-11-20.** The rule compares the perp book with its own prior 14 days (at least 120 hourly values), and the
  spot series starts 2026-11-05. Nothing can fire on a full history before about 2026-11-19.

## The rule

Decided at hour h, from the four hours h−3 … h:
- **Imbalance per book** = Σ(buy − sell) ÷ Σ(buy + sell) over the window, from `cvd:hist` (perp) and `spotcvd:hist`
  (spot). Each book needs at least 3 of the 4 hours present.
- **4h return and 4h OI change** from `oi:hist` (the rows at h and h − 4).
- **LONG:** price fell over the 4h, the perp imbalance ranks in the **bottom 20%** of its own prior 14 days (mid-rank),
  the spot imbalance is **above 0**, and |4h OI change| is **at most 1%**.
- **SHORT:** the mirror: price rose, the perp imbalance ranks in the **top 20%**, the spot imbalance is **below 0**, OI
  flat the same way.
- Stamped at the `oi:hist` row at h. Cooldown 12h per coin.

## Measurement limit

Read before trusting a grade (from the draft): each CVD row is the last ≤100 taker trades inside a 65-minute window,
not the hour's total. On BTC that is seconds of tape. Spot and perp are sampled the same way, so they are comparable
with each other, but neither is a full-hour flow measure.

OKX publishes an hourly aggregated taker volume (spot and contracts). It would be the better input. It isn't used here:
this session couldn't reach OKX to check the reply's shape. A rule on that series would be a new registration.

## Count-only power check

Not run. The spot series has about one day of history on 2026-11-06, and the rule needs 14. The first count is due
with the first out-of-sample events. If the read fires too rarely to ever reach 30 events in 90 days, that is recorded
under Results and the read is retired as untestable, never re-tuned.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
