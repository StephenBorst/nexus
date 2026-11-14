# Lens reads · registered into the read pipeline (A signed; B waits for its recorder)

Drafted 2026-11-14 (borst: "grade our own lenses"). **A (`smart_consensus_2x`) signed by borst 2026-11-14** ("sign it
for me", given in a Claude session). **Out-of-sample events for A start at 2026-11-15T00:00:00Z**, the next 00:00 UTC
after signing. B (`forecast_divergence`) is NOT registered: it needs its recorder and 14 days of rows first, then its
own dated sign-off on a new page. Stages and bars are as in `docs/research/read-pipeline.md`.

Everything above "Results" is fixed. A changed rule is a new registration under a new name.

## Why

The market drawer (2026-11-14) shows every lens on a coin in plain words. Most lenses already have a graded relative
on the scoreboard and the drawer prints that relative's live grade under them (`app/lib/fadeGrade.mjs`
`lensGradeLine`). Two lenses don't have one graded at the rule the drawer shows:

| Lens | What the drawer shows | Nearest graded rule today |
|---|---|---|
| Funding | stretched past its own range → the fade | `funding_fade`: NOISE, worse than random |
| Smart money | tracked traders agree with a 2× margin | `smart_follow` (any margin): PROMISING, beats random |
| Forecasts | forecast lean vs funding lean disagree | none |
| Catalysts | world events mapped to a coin | none |

This page registers the first two missing ones at their exact drawer rules. Catalysts are left out: their mapping
from an event to a coin is hand-written per category, so there is no rule to register yet.

## Shared terms

- **Grading.** The R contract every read uses: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. Two-sided reads are
  judged on the pooled random-entry result, each side re-drawn on its own side; the per-side split shown beside it.
- **Universe.** Main card = `RECORDED_COINS` (9). Holdout = `HOLDOUT_COINS` (8), graded apart, never pooled.
- **Cooldown.** 24h per coin.
- **In-sample history.** Whatever the scoreboard shows for these rules before the out-of-sample start decides nothing.

## A · `smart_consensus_2x` — follow tracked traders when they clearly agree

**Rule.** At a recorded smart-money row (hour h) for a coin, with L traders long and S short:
- the leading side has **at least 2 traders**, more than the other side, and **at least 2×** the other side
  (`CONSENSUS_RATIO`, the same constant the drawer and the Smart Money consensus card use);
- the read goes **that side** (follow). Stamped at the row's hour. 24h cooldown per coin.

**Inputs.** `sm:hist` (the recorded smart-money series, `{t, side, long, short}` per row). The read only uses rows
that carry both counts; a row with a side but no counts can't fire.

**Overlap.** A filtered read of `smart_follow` (follow the recorded lean at any margin): one bet, never stacked. At
registration it joins `OVERLAP_PAIRS` as `smart_follow × smart_consensus_2x`.

**Count-only power check · 2026-11-14.** Counted from `/smart/consensus/history?coin=` (the series behind `sm:hist`;
confirmed in code at registration: `sm:hist:{COIN}` in `NEXUS_AGENT`, appended hourly by `storeConsensus`,
`routes-smart.mjs`, only for coins where one side has ≥ 2 traders). Counts only: no return, hit rate or R was computed.

| Line | Events (24h cooldown) | Series from |
|---|---|---|
| Main card (9 coins) | 477 | 2026-08-22 |
| Holdout (8 coins) | 344 | 2026-08-22 |

About 5–6 main-card events a day: 30 out-of-sample events in roughly a week.

## B · `forecast_divergence` — follow the forecast when it disagrees with funding

**Rule.** For a coin with a liquid price-target prediction market (the same set `/intel/forecasts` reads): when the
forecast lean (the direction the market's YES implies) **disagrees** with the funding lean (who pays), the strike is
**at least 5%** from the price (`CLOSE_STRIKE_PCT`: closer strikes price high on distance alone), and YES is **not
between 40 and 60** (a coin flip is not a lean), the read goes **the forecast's way**. 24h cooldown per coin.

**Inputs.** Needs a recorder first: nothing records forecast history per coin today (`intel:forecasts:v1` is a 5-min
cache). Build before signing: an hourly `forecast:hist:{COIN}` row `{t, marketId, yesPct, target, direction,
distancePct, fundingLean}` written by lab-api's hourly job from the same board, recording only, nothing reads it.
Register once it has 14 days and a count-only power check like A's.

**Overlap.** None graded today.

## Measurement limits

- `sm:hist` is the tracked set as it stood each hour. The set itself changes (the Smart Money board re-ranks); a row
  reflects whoever was tracked then. That is the drawer's view too.
- Forecast markets come and go; a coin with no qualifying market can't fire B.

## Sign-off

- **A · `smart_consensus_2x`: signed by borst, 2026-11-14** ("sign it for me", in a Claude session). Registered in
  `app/lib/readPipeline.mjs` from 2026-11-15T00:00:00Z, main card + holdout lines + the graded exit; body
  `smartConsensus2xEvents` in `workers/nexus-lab-api/explorerReads.mjs`; overlap pair `smart_follow × smart_consensus_2x`.
  Nothing trades it: no brain mode, preset, wallet or money change.
- **B · `forecast_divergence`: not signed.** Waits for its recorder and 14 days of rows.

## Results

_None yet._
