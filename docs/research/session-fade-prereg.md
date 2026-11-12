# session_fade · registered into the read pipeline

Registered 2026-11-06 (borst's go: "make it all happen"). Batch 3.

**Out-of-sample events start at 2026-11-08T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why this read exists

`session_momentum` (registered 2026-10-17) is the most reliably wrong read on the board. Out of sample on 2026-11-06:
92 events on the main card, mean −0.43R, beating 0% of random entries; 69 events on the holdout, mean −0.33R, beating
1.5%. Two coin sets that never shared an event agree, so the effect looks real, not noise.

The house rule: worse than random is never a licence to invert. An inverted rule is a new read. So this page registers
the inversion as its own read, counted only from its own date. `session_momentum`'s grade decides nothing here.

The idea, in one line: a bigger-than-usual NY open push is the crowd chasing the open, and it gives back.

Two cautions, written before any outcome:
- The R contract is not symmetric (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h). A read that loses −0.43R does
  not make +0.43R the other way round. Fees are paid on both legs either way.
- `session_momentum` stays registered and keeps being graded. The two are one event traded two ways, so they can't
  both be right. If `session_fade` fails, it is retired publicly like any other read.

## Shared terms

- **Code.** The rule is `sessionFadeEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`), graded
  on the scoreboard (`axisbt.mjs` `AXES`). It calls `sessionMomentumEvents` and flips the side, so the two can't
  drift apart. `explorerReads.test.mjs` pins that.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of the out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That history is
  `session_momentum`'s mirror, which was seen. It is **in-sample** and decides nothing.

## The rule

- The NY open drive: the move from the 13:00 UTC open to the 15:00 UTC close (the 13:00 and 14:00 hourly bars).
- It fires when |move| is larger than the median |move| of the same 13:00→15:00 window over the prior 30 days
  (needs at least 20 of those days).
- It takes the OPPOSITE side of the move at the 15:00 close: an up drive goes SHORT, a down drive goes LONG.
- One event per coin per day.

## Count-only power check · 2026-11-06

Public series read 2026-11-06 (`/agent/oi-history`, `/agent/candle-history`), counted with
`tools/explorers/powerCheck.mjs`'s `powerCheck`. Counts only: no return, hit rate or R was computed.

| Window | Main card (11 coins) | Gradeable | Holdout (8 coins) | Gradeable |
|---|---|---|---|---|
| last 60 days | 233 (130 longs) | 202 | 185 | 79 |
| last 90 days | 391 (184 longs) | 295 | 274 | 101 |

- **Fast.** About 100 gradeable main-card events a month: a first stage in about 10 days, the kill line in about a
  month.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
