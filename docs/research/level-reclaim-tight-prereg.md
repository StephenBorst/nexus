# level_reclaim_tight · registered into the read pipeline

Registered 2026-11-06 (borst's go: "make it all happen"). Batch 3.

**Out-of-sample events start at 2026-11-08T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why this read exists

`level_reclaim` is the only read on the board served at PAPER. Out of sample on 2026-11-06: 73 events, +0.36R,
beating 100% of random entries; holdout 48 events, +0.19R, 90.5%. Its graded exit nets +61.1 bps over 50 trades.

`docs/research/level-reclaim-exit-gap.md` found where its trades lose. At 30 trades (2026-11-03), split at the median
stop width: narrow stops +0.50R / +63 bps, wide stops −0.06R / −60 bps. The read works when the coin is calm and
loses when it is wild.

That split was found by looking at outcomes, so it can't be used as evidence. This page writes the filter down now
and lets only new events judge it, next to the original. `level_reclaim` is unchanged and keeps its paper wallet.

**Coin-relative, on purpose.** The exit-gap split was pooled across coins, so "narrow" was mostly "BTC and ETH". This
rule asks whether the coin is calm *for itself*. That's the first-principles version of the claim (a reclaim holds in a
quiet tape and gets run over in a wild one), and it lets the holdout's wider coins fire, so the read can replicate there.

## Shared terms

- **Code.** The rule is `levelReclaimTightEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`),
  graded on the scoreboard (`axisbt.mjs` `AXES`). It calls `levelReclaimEvents` (the shared rule in
  `app/lib/levelReclaim.mjs`) and filters it, so the event can't drift from `level_reclaim`'s. `explorerReads.test.mjs`
  checks it on hand-built data and checks for lookahead on a tape whose future is poisoned.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of the out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That history
  overlaps the trades the exit-gap study looked at. It is **in-sample** and decides nothing.

## The rule

- Every `level_reclaim` event (prior-day high or low swept by at least 0.4× H4 ATR-14, then closed back inside within
  6 hours; entry at that close).
- Taken only when the coin's H4 ATR-14, as a fraction of price, at the reclaim bar (the last closed bar before the
  event) ranks at or below the **median** of the same measure over the prior 30 days.
- The 30-day comparison is sampled every 6 hours (mid-rank), and needs at least 60 samples.
- H4 ATR-14 is the graded stop's own ruler (`app/lib/atr.mjs` `h4Atr14Frac`), so "calm" means "a smaller stop than
  usual for this coin".

## Count-only power check · 2026-11-06

Public series read 2026-11-06 (`/agent/oi-history`, `/agent/candle-history`), counted with
`tools/explorers/powerCheck.mjs`'s `powerCheck`. Counts only: no return, hit rate or R was computed.

| Window | Main card (11 coins) | Gradeable | Holdout (8 coins) | Gradeable |
|---|---|---|---|---|
| last 60 days | 70 (44 longs) | 66 | 52 | 29 |
| last 90 days | 99 (58 longs) | 84 | 62 | 31 |
| `level_reclaim`, 60 days, for scale | 118 | 112 | 127 | 51 |

- **The filter keeps about 60% of `level_reclaim`'s main-card events.** About 33 gradeable a month: a first stage in
  about a month.
- **The holdout is slower:** about 15 gradeable events a month, so replication takes about two months.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

What would make this read worth more than `level_reclaim`: a better graded-exit net on the same out-of-sample window.
That comparison is descriptive. Neither read's stage depends on the other.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
