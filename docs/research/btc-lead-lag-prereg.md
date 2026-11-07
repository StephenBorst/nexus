# btc_lead_lag · registered into the read pipeline

Registered 2026-11-07 (borst: "register lead-lag at p90 / 0.75"). Batch 4. From `docs/research/explorer-drafts-4.md`.

**Out-of-sample events start at 2026-11-08T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why this read exists

News reaches BTC first. Most alts move more than BTC (beta above 1), so an alt that moved much less than BTC in the
same hour hasn't caught up yet. The claim: it catches up, and following BTC on that alt pays.

It is the first read on the board that uses another coin's tape. Every threshold is relative: BTC's move is judged
against BTC's own month, and the lag against BTC's move. Nothing is a fixed number tuned on the main card. That matters
because on 2026-11-07 only `level_reclaim` held up on the holdout coins; the main-card-only winners all failed there.

## Shared terms

- **Code.** The rule is `btcLeadLagEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`), graded on
  the scoreboard (`axisbt.mjs` `AXES`). It reads BTC's hourly candles from the scoreboard's context
  (`ctx.btcCandles`). The body moved unchanged from `explorerDrafts4.mjs` at the setting below.
  `explorerReads.test.mjs` checks it on hand-built data and checks for lookahead with BTC's future poisoned too.
- **The holdout line has no BTC.** The holdout coin set is the eight holdout coins only. The main card's BTC set rides
  along there as **context only** (`ctxSets`): it is read for BTC's move, never graded, never pooled. No read graded on
  the holdout line before this one reads BTC, so nothing else on that line changes.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of the out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That is
  **in-sample** and decides nothing. No outcome of this rule was looked at before this page was written: the draft
  page counts events only.

## The rule

Decided at the close of hourly bar h (candle:hist, the alt's and BTC's):
- **BTC impulse.** BTC's 1h return (close h vs close h−1) ranks at or above the **90th percentile** of |BTC 1h return|
  over the prior 30 days (mid-rank, at least 360 hours).
- **The alt lagged.** In the same hour, the alt's 1h return in BTC's direction was less than **0.75 × |BTC's return|**
  (an alt that moved the other way counts as lagging too).
- **The trade.** Follow BTC on the alt: BTC up → LONG, BTC down → SHORT. Stamped at bar h's close.
- Alts only: BTC itself never fires. Cooldown 12h per coin.

## Count-only power check · 2026-11-07

Public series read 2026-11-07 (`/agent/oi-history`, `/agent/candle-history`), counted with
`tools/explorers/powerCheck.mjs`. Counts only: no return, hit rate or R was computed.

| Window | Main card (11 coins) | Gradeable | Holdout (8 coins) | Gradeable |
|---|---|---|---|---|
| last 60 days | 143 (71 longs) | 124 | 110 (44 longs) | 59 |
| last 90 days | 286 (165 longs) | 174 | 223 (110 longs) | 68 |

- Per coin, last 60 days (main): ETH 8 · SOL 8 · XRP 16 · DOGE 12 · BNB 27 · ARB 15 · AVAX 14 · LINK 12 · HYPE 17 ·
  WLD 14. ETH and SOL fire least: they move with BTC.
- Holdout gradeable counts are low only because the holdout coins have recorded prices since 2026-10-16. Going
  forward, the holdout should collect about 50 gradeable events a month.
- **Fast.** About 60 gradeable main-card events a month: a first stage in about two weeks.

Other settings were counted before choosing (explorer-drafts-4.md). The drafted p95 · lag 0.5 fired 27 in 60 days,
under the bar. borst picked p90 · 0.75 from the count table.

## Overlap

It is a cross-coin timing read and shares no event rule with any registered read, so no overlap pair is added. If an
overlap shows up in practice (for example with `oi_div_reversal_4h` on the same alt and hour), it gets added to
`OVERLAP_PAIRS` as a count, never a grade.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
