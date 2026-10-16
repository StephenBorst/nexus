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
