# oi_coil_break · registered into the read pipeline

Registered 2026-10-27. borst froze the definition, saw the count-only power check
(`docs/research/explorer-drafts-b.md`), and signed it at **OI +3%** (the draft proposed +5%; the count was borderline
there).

**Out-of-sample events start at 2026-10-28T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Shared terms

- **Code.** The rule is `oiCoilBreakEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`), graded
  on the scoreboard (`axisbt.mjs` `AXES`). `explorerReads.test.mjs` checks it on hand-built data, pins the signed
  settings, and checks for lookahead on a random tape whose future is poisoned.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of the out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That history was
  never looked at to choose the rule, but it is **in-sample** and decides nothing.

## The rule

- **Coil,** decided on the `oi:hist` row at hour h:
  - OI rose at least **3%** over the prior 24h,
  - and |24h return| ranks at or below the **30th** percentile of |24h return| over the prior 30 days (mid-rank;
    needs at least 15 of those days).
- **Break:** within 12h after the coil hour, the first hourly candle that closes above the high of the 24 candles
  ending at the coil hour goes LONG; one that closes below their low goes SHORT. The event is stamped at that
  candle's close.
- One event per coil. All 24 range candles must exist. Cooldown 24h per coin.
- It is not `vol_breakout` (dropped in batch 1, never graded): that needed an ATR squeeze. This one asks for OI
  building into a flat tape.

## Count-only power check · 2026-10-27

The last 60 days on the main card's 11 coins. "Projected" scales the per-coin rate of the six coins recorded since
July (BTC, ETH, SOL, XRP, HYPE, WLD) to all 11.

| Setting | Would have fired | Projected, 11 coins | Holdout over recorded history |
|---|---|---|---|
| OI +3% · flat ≤ p30 (signed) | 71 (35 longs) | 105 | 13 |

- **Expect it to be slow.** At about 105 events per 60 days, the first verdict likely takes 60–90 days.
- **The holdout lags.** Six of the 8 holdout coins only started recording OI on 2026-10-16, and the rule needs 15
  days of history, so most of the holdout can't fire before about Nov 1.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
