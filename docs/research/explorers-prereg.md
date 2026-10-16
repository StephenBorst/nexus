# Four explorer reads · registered into the read pipeline

Registered 2026-10-16. borst froze the definitions, saw the count-only power check, and signed off:
- level_reclaim, oi_div_reversal and session_momentum ("register these three now");
- confluence_follow, with a 24h cooldown.

vol_breakout was dropped for v1: it would have fired 33 times in 60 days, a third of the bar.

**Out-of-sample events start at 2026-10-17T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Shared terms

- **Code.** The rules are in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`) and are graded on the
  scoreboard (`axisbt.mjs` `AXES`). `explorerReads.test.mjs` checks each rule on hand-built data, and checks for
  lookahead on a random tape whose future is poisoned.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. Each read also
  has an as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** All four can fire LONG or SHORT, so each is judged on the pooled random-entry result, with longs and
  shorts each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** Each has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of every read's out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades each read's recorded history the moment it goes live. That history was
  never looked at to choose these rules, but it is **in-sample** and decides nothing.

## The rules

### `level_reclaim`
- Levels: the prior UTC day's high and low.
- Sweep: price trades at least 0.4 × H4 ATR-14 beyond the level. The ATR is the one known at the bar before the first
  breach.
- Reclaim: an hourly close back through the level within 6h of the day's first breach of that level. The window is
  the breach bar plus the five after it.
- Entry is on the reclaim close: LONG at the prior-day low, SHORT at the prior-day high.
- One event per level per day. The levels stay those of the breach day if the window crosses midnight.

### `oi_div_reversal`
- Fires when |24h return| ranks at or above the 90th percentile of |24h return| over the prior 30 days (mid-rank;
  needs at least 15 of those days), **and** OI fell at least 3% over the same 24h.
- It fades the move: a rally goes SHORT, a drop goes LONG.
- Measured hour against the same hour a day earlier, on `oi:hist`. Cooldown 24h per coin.

### `session_momentum`
- The move from the 13:00 UTC open to the 15:00 UTC close.
- If its size beats the median size of the same 13:00→15:00 window over the prior 30 days (at least 20 of them),
  enter in its direction at the 15:00 close.
- One event per coin per day. NY only.

### `confluence_follow`
- The brain's CONFLUENCE rule at its default thresholds (funding ±0.01%, any OI move; the OI rule case for case,
  including that it follows when price and OI move together), traded the other way.
- Price and OI change are measured row over row on `oi:hist`, with no more than 2h between rows. The live brain
  compares against a snapshot about 5 minutes old, which isn't recorded.
- **Cooldown 24h per coin**, so one funding episode counts as one event.

## Count-only power check · 2026-10-16

The window is the last 60 days and the main card's 11 coins.

| Read | Would have fired | Holdout over recorded history |
|---|---|---|
| level_reclaim | 108 | 128 |
| oi_div_reversal | 57 on the coins with OI history; ~97 projected once all 11 are recorded | 11 (ZEC and PUMP only) |
| session_momentum | 297 | 242 |
| confluence_follow (24h cooldown) | 134 | 17 (ZEC and PUMP only) |

## Expect these to be slow

- **oi_div_reversal is borderline:** about 97 per 60 days, projected. Its first verdict likely takes 60–90 days.
- **Its holdout line lags further.** It needs 15 days of 24h returns, and six of the 8 holdout coins only started
  recording OI on 2026-10-16. So it **can't fire before about Nov 1**, and 30 holdout events comes around **late
  November**.
- **confluence_follow's holdout** depends on the same OI history, so it also starts thin.
- **level_reclaim and session_momentum** use candles, which are backfilled, but their events only count once the
  coin's hourly price history (`oi:hist`) exists at that hour. On the main card that's every coin from 2026-10-16. On
  the holdout it's all 8 from 2026-10-16.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), with each read judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for any of these, and none is added before a read reaches Tradeable.

## Results

(Append below. Never edit above this line.)
