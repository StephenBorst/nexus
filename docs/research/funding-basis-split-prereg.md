# funding_basis_split · registered into the read pipeline

Registered 2026-11-07 (borst: "register funding-basis at the drafted setting"). Batch 4 D. From
`docs/research/explorer-drafts-4.md`, first drafted as batch 2's D in `docs/research/explorer-drafts-b.md`.

**Out-of-sample events start at 2026-11-08T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why this read exists

Funding and the spot-perp basis are two prices for the same thing: how much the crowd pays to be long the perp.
Funding is set from a window and paid every 8h; the basis is the tape right now. When they disagree, the claim is
that the basis is the one to believe:
- funding still says "longs are crowded", but the perp trades at or below its usual price against spot, so the crowd
  is already leaving. That goes SHORT;
- the mirror case (funding says shorts are crowded, the perp trades at or above its usual basis) goes LONG.

It isn't either read alone. `funding_fade` fades the funding level and grades NOISE. The basis reads use the basis
level. This read uses the disagreement between them.

## Shared terms

- **Code.** The rule is `fundingBasisSplitEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`),
  graded on the scoreboard (`axisbt.mjs` `AXES`). The body moved unchanged from `explorerDrafts4.mjs`, at the setting
  drafted on 2026-10-27, before any count existed. `explorerReads.test.mjs` checks it on hand-built data and checks
  for lookahead on a tape whose future is poisoned, the basis series included.
- **Inputs.** `oi:hist` (funding, hourly) and `basis:hist` (the OKX spot-perp basis, hourly). Basis is recorded on 9
  of the 11 main-card coins: ARB and WLD have no OKX spot-perp series, so the read can't fire on them.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO, whose basis series record from
  2026-10-16. On the main card, a holdout coin's basis is emptied (`withoutHoldoutFlow`), so SUI can't fire on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That is
  **in-sample** and decides nothing. No outcome of this rule was looked at before this page was written.

## The rule

At an `oi:hist` row (hour h) that has a `basis:hist` row in the same hour:
- **SHORT:** funding ranks at or above the **80th percentile** of the coin's prior 30 days (mid-rank), AND the basis
  is at or below the **median** of its own prior 30 days.
- **LONG:** funding ranks at or below the **20th percentile**, AND the basis is at or above its median.
- Each series needs at least **360** prior hours. Stamped at the `oi:hist` row. Cooldown **24h** per coin.

## Measurement limits

- `basis:hist` had holes before the paced `snapshotFlow` fix (CLAUDE.md). The rule fires only on an hour that has a
  basis row, so a hole can only miss an event, never make one up.
- p80 funding is "elevated", not "extreme". That is by design: the claim is about the disagreement between the two
  prices, not about the level of either one.

## Count-only power check · 2026-11-07

Read 2026-11-07 from `/agent/oi-history`, `/agent/candle-history` and the new read-only
`/agent/basis-history/:coin`, counted with `tools/explorers/powerCheck.mjs`. Counts only: no return, hit rate or R
was computed.

| Window | Main card (9 coins with basis) | Gradeable | Holdout (8 coins) | Gradeable |
|---|---|---|---|---|
| last 60 days | 195 (86 longs) | 195 | 45 | 45 |

- The 60- and 90-day counts are the same: with 360 hours of warm-up, the main card can fire only from about
  2026-09-08.
- Per coin (main): BTC 26 · ETH 32 · SOL 28 · XRP 30 · DOGE 16 · BNB 17 · AVAX 11 · LINK 14 · HYPE 21.
- The holdout's 45 came from about a week of eligible history (it can fire from about 2026-10-31). It should reach
  30 out-of-sample events within a few weeks.
- **Fast.** About 100 gradeable main-card events a month: a first stage in about ten days.

Other settings counted (explorer-drafts-4.md): p90/10 = 119, a 12h cooldown = 290. The drafted setting was kept.

## Overlap

It reads funding, as `confluence_follow` does, so the pair is in `OVERLAP_PAIRS` (a count, never a grade). If the two
fire as one bet, they are one bet, never stacked as two.

## The bar

The pipeline's (`app/lib/readPipeline.mjs`), judged on the pooled random result:
- **Lead:** 30 out-of-sample events, mean R > 0, and the two halves agree in sign.
- **Edge:** beats 95% of random entries on the main card. On the holdout: 30 events, mean R > 0, and 80% vs random.
- **Tradeable:** the graded exit nets above 0 over 30 out-of-sample trades.
- **Retired:** 100 out-of-sample events on either line with mean R ≤ 0, or worse than random. It is retired publicly.

No agent mode, preset or wallet exists for this read, and none is added before it reaches Tradeable.

## Results

(Append below. Never edit above this line.)
