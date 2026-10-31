# The read pipeline · how a hypothesis earns a paper wallet

Agreed by borst 2026-10-16: "Scoreboard first, wallets only for reads that pass; the 5-stage pipeline with kill
rules and the backfill marked in-sample; holdout replication as the bar for testing 10 at once." The same rules
are in code in `app/lib/readPipeline.mjs` (`PIPELINE_RULES`, `pipelineStage`). `readPipeline.test.mjs` fails if this
page and the code ever state different numbers.

## Why the scoreboard, not wallets

A paper wallet holds one position at a time and has daily caps, so it makes about 30 trades a month. At that count
the noise in mean R is about ±0.2R, which is as large as the edge being looked for. Run ten wallets with no edge and
about one month in five, at least one of them looks strong by luck. The scoreboard grades every time a read fires, on
every recorded market, against random entries at the same hours. That gives hundreds of events a month instead of 30.
A wallet's job comes later: checking that the agent trades what was graded.

## The rules

1. **Registered.** The rule and its parameters are written down and dated *before* any grade is seen: a doc under
   `docs/research/`, an entry in `REGISTERED_READS`, and a `registeredAt` set in the future. Only events after
   `registeredAt` count. The scoreboard back-grades the recorded history the moment a read is added. That history is
   **in-sample**: it is shown, labelled, and never counts toward a stage.
2. **Lead.** At least 30 out-of-sample events graded in R, mean R above 0, and the first and second halves agreeing in
   sign.
3. **Edge.** A Lead that also beats at least 95% of random entries on its own side (the pooled result, for a read
   that trades both sides), on the main card, **and
   replicates on the holdout coins** (`app/lib/recordedUniverse.mjs`): at least 30 holdout events, mean R above 0, and
   beating at least 80% of random entries on the same side. This replication is the guard against testing many
   reads at once. A read found on the main coins has to work again on coins nobody looked at.
4. **Tradeable.** An Edge whose graded exit, traded the way the agent would trade it (fees in, closed at the market
   after 168h, one position per market), nets above 0 over at least 30 trades out of sample.
5. **Paper.** A Tradeable read gets a paper wallet: its own record, and parity must read CLEAN. **Live money is always
   a separate review.**

**Retired.** A read is retired at 100 out-of-sample events or more, on the main card or on the holdout, if mean R is 0
or below or if it is worse than random (BELOW_RANDOM) on its side. It is retired publicly and never re-tuned.

## Guardrails

- Parameters are frozen before any grade is seen. A tweak is a **new registration**, with a new name and a new date,
  and it joins the family being tested.
- Every read is graded on one fixed ruler for entries: the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop,
  168h). Exits are judged only at Tradeable, after the entry has proven itself.
- Profit is never the first number. The first number is R against random entries on the same markets, side and
  window.
- Event **counts** may be looked at before registering (a power check: can the read reach about 100 events in 60
  days?). Outcomes may not.
- Two reads that fire on the same coin and side within 24 hours of each other are one bet, not two. The scoreboard's
  `overlap` block counts this, and a stack is built only from survivors.

## Where to read it

`GET /intel/axis-backtest` → `pipeline.reads[]`: each read's stage, what it still needs (`next`), and its numbers.
Each registered axis row carries an `oos` block, which is the only grade the stage uses, and the `holdout` line carries
the same block. The full-history row next to it is in-sample.

## The family

| Read | Registered | Doc |
|---|---|---|
| rsi_reset_deep | 2026-10-17T00:00:00Z | `docs/research/rsi-reset-deep-prereg.md` |
| level_reclaim · oi_div_reversal · session_momentum · confluence_follow | 2026-10-17T00:00:00Z | `docs/research/explorers-prereg.md` |

The four explorers are two-sided, so each is judged on the pooled random result. vol_breakout was dropped for v1 at
the power check. Definitions and counts are in `docs/research/explorer-drafts.md`.

## Measurement changes

A change to how the grader measures, rather than to a read's rule, is logged here with its date. It applies to every
read the same way and keeps every name and registration date. A change to a read's rule is still a new registration.

### 2026-10-30 · the price spine keeps the first row in each hour

- **What changed:** `priceByHour` (`app/lib/basisStack.mjs`), shared by the brain, the scoreboard, parity and the
  backtest, now keeps the FIRST `oi:hist` row in each hour instead of the last. No read's rule changed.
- **Why:** the brain writes a row every ≥55 minutes, so about once a day per market two rows round into one hour. With
  the last row winning, a row written minutes after the agent acted could rewrite that hour's price for the grader. That
  is a small look-ahead, and it caused the Oct 28 ETH parity drift (`docs/research/price-spine-drift-2026-10-29.md`).
- **What it re-scores:** only events whose price move or forward return reads one of those doubled hours, roughly 22–27
  hours per market in the last 30 days. Every read is re-graded on the new spine, back-graded history included.
- **Before (served 2026-10-30 05:41 UTC, out-of-sample):**

| read | stage | events | mean R | vs random | holdout events |
|---|---|---|---|---|---|
| rsi_reset_deep | REGISTERED | 17 | −0.26 | 21.5% | 18 |
| level_reclaim | LEAD | 52 | +0.16 | 84% | 36 |
| oi_div_reversal | REGISTERED | 23 | −0.04 | 41.5% | 0 |
| session_momentum | REGISTERED | 54 | −0.68 | 0% | 37 |
| confluence_follow | LEAD | 33 | +0.21 | 82.3% | 13 |
| oi_div_reversal_4h | REGISTERED | 18 | +0.83 | 99.7% | 3 |
| oi_coil_break | REGISTERED | 10 | +0.00 | 50.8% | 0 |

  Basis × CVD on the main card (full history): NOISE, −0.02R over 104 events.
- **After:** appended below once the change is served (cache `axisbt:v19`). If a read's stage moves because of this
  change alone, it is reported here and on the pipeline watch, never hidden or re-run on the old spine.
- **After (served 2026-10-30 05:58 UTC, cache `axisbt:v19`):** no stage moved.

| read | stage | events | mean R | vs random | holdout events |
|---|---|---|---|---|---|
| rsi_reset_deep | REGISTERED | 17 | −0.26 | 20.7% | 18 |
| level_reclaim | LEAD | 52 | +0.16 | 84.3% | 36 |
| oi_div_reversal | REGISTERED | 23 | −0.04 | 41.8% | 0 |
| session_momentum | REGISTERED | 54 | −0.68 | 0% | 37 |
| confluence_follow | LEAD | 33 | +0.21 | 82.5% | 13 |
| oi_div_reversal_4h | REGISTERED | 18 | **+0.56** (was +0.83) | 97.8% | 3 |
| oi_coil_break | REGISTERED | 10 | +0.00 | 53.3% | 0 |

  The one out-of-sample read the fix really moved is oi_div_reversal_4h, down 0.27R on the same 18 events. It reads
  price straight off the spine, so a doubled hour changes its move. On the full history (in-sample), 13 of 25 axes
  shifted by 0.01–0.05R; confluence_follow went from PROMISING to PREDICTIVE (+0.03 → +0.04R, same 209 events). The
  snapshots are 17 minutes apart, so a few extra events (basis × CVD 104 → 108, CVD 2478 → 2487) are new data, not the
  fix. Parity after the fix: the Oct 28 ETH trade matches on all three wallets (24h arm and nine-market arm CLEAN).

### 2026-10-30 · the hourly price row is written at the top of the hour

- **What changed:** the brain writes `oi:hist` once per hour on its first tick after :00 (minute < 30), only if that
  hour has no row (`oiSnapshotDue`). Before, a row was written whenever the last one was 55 minutes old, so the write
  minute drifted between about :10 and :40.
- **Why:** with the drift, about once a day an hour got two rows and the next got none, and the agent could decide before
  its hour had a price. Now each hour has one row, written before the ~:17 basis and CVD reads.
- **What it re-scores:** nothing already recorded. From this date, each hour's price is taken at ~:02 instead of a
  drifting minute, so a price move over an hour is measured over a fixed clock window. No read's rule changed.

### 2026-10-31 · exits fill at their level, not at the hour's extreme

- **What changed:** the shared exit walker `stepExit` (`workers/nexus-lab-api/backtest.mjs`) now fills each exit at its
  own level. Stop, target, trail, breakeven and each take-profit slice fill at their level. A bar that opens past the
  level fills at the open (a gap). A timeout closes at the open of its bar. Before, the fill was the hour's probe price:
  a stop filled at the hour's worst price, a target at its best, a timeout at the adverse extreme. borst's go,
  2026-10-31. No read's rule changed.
- **Why:** the live exec checks the mark once a minute and closes at the market, so its fills sit near the level. The
  hourly walker filled at the hour's extreme, so the as-traded line didn't measure what the agent does. Found by the
  level_reclaim exit bridge (`docs/research/level-reclaim-exit-gap.md`, first pull: S3b −23.9 bps).
- **What it re-scores:** every as-traded exit line. That covers each pipeline read's graded exit (`exitGraded`, which
  feeds the Tradeable bar), the preset exit lines (`exit`, `exit24h`), `/intel/evidence`, and the Lab backtest, sweep and
  validate (and the Lab's random-entry baseline, which replays its random trades through the same walker, so real and
  random get the same fill). The scoreboard's R grade and its random-entry baseline (`gradeEventR`), event counts and
  every stage rule below Tradeable are untouched, so **no stage can move from this alone**. The Basis × CVD regime window
  (`docs/research/graded-exit-regime-prereg.md`) had 0 counted trades when this landed: its first trade counts after
  2026-11-03, so it is measured on the new fill from its first trade. Strategies already published keep the validation
  stored at publish; a new publish re-validates on the new fill. Caches: `axisbt:v20`, `evidence:v6`.
- **Before (served 2026-10-31 17:47 UTC, `axisbt:v19`, out-of-sample graded exit, net of fees):**

| read | stage | events | mean R | exit trades | exit net bps |
|---|---|---|---|---|---|
| rsi_reset_deep | REGISTERED | 19 | −0.24 | 8 | −145.5 |
| level_reclaim | LEAD | 53 | +0.23 | 24 | −72.3 |
| oi_div_reversal | REGISTERED | 26 | −0.02 | 11 | +8.7 |
| session_momentum | REGISTERED | 61 | −0.61 | 35 | −244.7 |
| confluence_follow | LEAD | 35 | +0.20 | 16 | +62.2 |
| oi_div_reversal_4h | REGISTERED | 23 | +0.41 | 0 | — |
| oi_coil_break | REGISTERED | 12 | +0.00 | 0 | — |

  Preset exit lines on the main card (full history): basis_x_cvd 93 trades −28.5 bps (24h: 91, −23.2) · basis_extreme
  443, −35.8 (24h: 369, −33.0) · basis_dev_x_cvd 74, −14.2 (24h: 75, −29.0). basis_x_cvd graded exit: 66 trades,
  −1.3 bps.
- **Preview (same public series, the scoreboard's own code run locally before and after; the old code reproduces the
  served numbers exactly):** exit trades and the exit mix are unchanged on every read; only the fill moves.
  rsi_reset_deep −145.5 → −116.2 · level_reclaim −72.3 → −48.4 · oi_div_reversal +8.7 → +11.2 · session_momentum
  −244.7 → −208.6 · confluence_follow +62.2 → +49.8. Reads that stop out more than they hit their target improve and
  reads that hit their target more give some back, because the extreme fill had made stops worse and targets better.
- **After:** appended below once the change is served (cache `axisbt:v20`), as for the price spine.
