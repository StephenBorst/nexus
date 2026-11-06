# Spot vs perp CVD split · DRAFT, not registered

**Status (2026-11-05):** recording only. Nothing grades, shows or trades this.

**Registered 2026-11-06 as `spot_absorb`** (`docs/research/spot-absorb-prereg.md`, out-of-sample from 2026-11-20T00:00Z).
The rule and its thresholds live on that page; this draft stays as the record of how it was framed.

## The idea

A move down where perps sell and spot keeps buying, with OI flat. The claim traders make from it: spot demand is
absorbing perp selling, so the dip holds as long as spot keeps buying. The mirror: spot selling into a perp-led push up.

We could not test it before today: `cvd:hist` is the PERP book only (OKX `-SWAP` trades). Nothing recorded spot flow.

## What is recorded

- `spotcvd:hist:{COIN}` in `NEXUS_AGENT`, hourly, from 2026-11-05 (the first deploy after this page), for every
  `FLOW_COINS` market (main nine + holdout). Written by `snapshotFlow` (`workers/nexus-lab-api/flow.mjs`) in the same
  pass as `basis:hist` and `cvd:hist`.
- Row: `{ t, cvd, buy, sell }`, the same shape and the same fold (`aggregateCvd`) as `cvd:hist`, on the SPOT book
  (`{COIN}-USDT`).

## Measurement limit (read before drafting a rule)

Both CVD series are the last ≤100 taker trades inside a 65-minute window, not the hour's total. On BTC that is seconds
of tape. Spot and perp are comparable with each other as samples. Neither is a full-hour flow measure.

A full-hour measure (OKX's aggregated taker-volume per hour, spot and contracts) would be the better input. It was not
built here because this session could not reach OKX to check the reply's shape. Verify it from the worker first.

## Before it can be registered

1. ≥14 days and ≥200 rows per market (the same maturity gate as the other flow series): about 2026-11-19 at the
   earliest.
2. A dated registration page with the rule fixed in advance (window, thresholds, the OI-flat condition, sides),
   following `read-pipeline.md`. Only events after that date count.
3. The rule body goes in a draft module first, never imported by the scoreboard, like `explorerDraftsB.mjs`.

No threshold is chosen on this page on purpose: picking one after looking at the recorded data would be in-sample.
