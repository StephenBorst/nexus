# oi_div_reversal_4h · registered into the read pipeline

Registered 2026-10-27. borst froze the definition, saw the count-only power check
(`docs/research/explorer-drafts-b.md`), and signed it at **OI −2% and a 12h cooldown**.

**Out-of-sample events start at 2026-10-28T00:00:00Z.** Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Shared terms

- **Code.** The rule is `oiDivReversal4hEvents` in `workers/nexus-lab-api/explorerReads.mjs` (`EXPLORER_READS`),
  graded on the scoreboard (`axisbt.mjs` `AXES`). It runs the registered `oi_div_reversal` code with three settings
  changed (window, OI drop, cooldown); `explorerReads.test.mjs` pins that, and checks for lookahead on a random tape
  whose future is poisoned.
- **Grading.** Entries are graded on the R contract: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. It also has an
  as-traded graded-exit line (fees in, closed at the market at 168h), counted from the registration date.
- **Two-sided.** It can fire LONG or SHORT, so it is judged on the pooled random-entry result, with longs and shorts
  each re-drawn on their own side. The per-side split is shown beside it.
- **Holdout.** It has a holdout line on ZEC NEAR SUI PUMP ENA ONDO INJ ZRO. On the main card, SUI's events are left
  out of the out-of-sample grade, so no event counts on both lines.
- **In-sample history.** The scoreboard grades the read's recorded history the moment it goes live. That history was
  never looked at to choose the rule, but it is **in-sample** and decides nothing.

## The rule

- Fires when |4h return| ranks at or above the 90th percentile of |4h return| over the prior 30 days (mid-rank; needs
  at least 15 of those days), **and** OI fell at least **2%** over the same 4h.
- It fades the move: a rally goes SHORT, a drop goes LONG.
- Measured hour against the same hour 4h earlier, on `oi:hist`. Rising OI against the move does not fire.
- Cooldown **12h** per coin.

## Count-only power check · 2026-10-27

The last 60 days on the main card's 11 coins. "Projected" scales the per-coin rate of the six coins recorded since
July (BTC, ETH, SOL, XRP, HYPE, WLD) to all 11.

| Setting | Would have fired | Projected, 11 coins | Holdout over recorded history |
|---|---|---|---|
| OI −2% · 12h cooldown (signed) | 111 (43 longs) | 169 | 21 |

- **Overlap with the 24h read:** 38 of the 111 (34%) sit within 24h of a 24h `oi_div_reversal` event on the same coin
  and side. Its evidence is partly shared with that read, and both are graded on their own.
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
