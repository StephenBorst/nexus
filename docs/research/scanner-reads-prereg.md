# Scanner reads · the two Bankr scanners, registered into the read pipeline (UNSIGNED)

Drafted 2026-11-16 (borst: "A, defaults OK, write the pages"). **Not signed yet.** Out-of-sample events start at the
first 00:00 UTC after borst signs. Until then nothing grades these rules: the code is a draft
(`workers/nexus-lab-api/explorerDrafts5.mjs`, test-guarded so the scoreboard can't import it). Stages and bars are as in
`docs/research/read-pipeline.md`.

Everything above "Results" is fixed once signed. A changed rule is a new registration under a new name.

## Why

Two scanners run on Bankr and post calls. Every call they post is already graded (first touch, public price). That
grades the calls they chose to post. Registering their RULES grades something else: the scoreboard runs each rule
itself, every hour, from public price, so a skipped setup or a missed one shows up too. The calls and the reads are two
records of the same idea; they are never added together.

The scanners' calls post from a **dedicated engine wallet** (borst 2026-11-16, choice A), counted apart from people,
with its own engine row on /proof like Ember. `0xd9f7…b449` stays "Apex Tape", manual calls only.

## Shared terms

- **Bars.** Orderly 1h bars as recorded (`candle:hist`, `{t, o, h, l, c, v}`, `t` = bar open). A read decides on the
  bar's close and is stamped at bar open + 1h. 4h bars are UTC windows (00, 04 … 20) built from four 1h bars
  (`app/lib/fourHourBars.mjs` windows); a 4h bar with a missing hour is skipped.
- **4h trend.** The last complete 4h bar closed at or before the deciding close: its close above the EMA-20 of complete
  4h closes = UP, below = DOWN (EMA seeded with the first 20 closes' average; an exact tie = no trend).
- **Grading.** The R contract every read uses: stop 1.2× H4 ATR-14, target 1.5× the stop, 168h. A second line shows each
  scanner's own exit (below), informational, not part of the bar.
- **Universe.** Main card = `RECORDED_COINS` (9). Holdout = `HOLDOUT_COINS` (8, incl. ZEC), graded apart, never pooled.
  The scanners trade five of these (BTC, ETH, SOL, HYPE on the main card; ZEC in the holdout); the reads are graded on
  the whole universe like every read, so the rule, not the coin list, is what's judged.
- **Cooldown.** 12h per coin.
- **In-sample history.** Whatever the scoreboard shows for these rules before the out-of-sample start decides nothing.

## A · `shelf_breakdown_short` — the breakout scanner

**Rule.** At the close of a 1h bar on a coin, all of:
1. **Session:** the bar opens 07:00–20:00 UTC, Monday–Friday (the scanner's 00:00–14:00 MST, fixed UTC−7).
2. **Regime:** the 4h trend is DOWN. Short-only: there is no mirror long.
3. **Shelf:** the shelf = the lowest low of the prior 24 1h bars (all 24 present), set at least 12 bars before this
   one (nothing in the last 12 bars traded down to it; ties: the most recent touch counts).
4. **Break:** this bar closes below the shelf.
5. **Volume:** this bar's volume ≥ 1.5× the average volume of the prior 20 bars (all present, average > 0).

All four gates required; there is no score. → **SHORT**, stamped at the bar's close.

**Left out of the graded rule (the scanner still uses them):** the macro freeze (no calendar history is kept to grade it
against), the 5m/15m volume (1h volume stands in: no minute bars are recorded for every coin), and the ≤ 0.60% retest
entry (an entry refinement; the read is judged from the break).

**Scanner's own exit (second line).** Stop 1.2× H4 ATR above the broken shelf; `SPLIT_50_BE`: half at 1.5R, the
runner's stop to the entry, trailing 1R behind the best close (1h closes here, 1-minute on its calls).

## B · `bb_rsi_momentum` — the momentum hunter

**Rule.** At the close of a 1h bar on a coin:
1. **Band:** the close is outside the 20-bar Bollinger band (mean ± 2 population standard deviations of the last 20
   closes, all present).
2. **Momentum:** Wilder RSI-14 on 1h closes > 60 for a long, < 40 for a short (a missing hour restarts its warm-up).
3. **Trend:** the 4h trend is UP for a long, DOWN for a short.
4. **No burst:** the range of the last 3 bars (highest high − lowest low) is not more than 2× the average range of the
   8 three-bar windows before it (the prior 24 bars, all present).

→ **LONG** above the band, **SHORT** below, stamped at the bar's close. Entry = that close (a market entry, so no
fill window).

**Scanner's own exit (second line).** Stop 1.0× 1h ATR-14 beyond the trigger bar's high (short) or low (long);
TP1 1.5R; the runner trails 1R behind the best close.

## Overlap

Neither rule shares an event with a registered read at signing. The scoreboard's `overlap` block measures them against
every registered read once they're graded; a pair that turns out to be one bet joins `OVERLAP_PAIRS`.

## Count-only power check · 2026-11-16

`node tools/explorers/powerCheck.mjs <dir> 60 --batch=5` on the public series (`/agent/candle-history`, ~92 days).
Counts only: no return, hit rate or R was computed.

| Read | Main card (9 coins), last 60 days | Holdout, recorded history | Scanner's own five, recorded history |
|---|---|---|---|
| `shelf_breakdown_short` | 12 | 10 | BTC 1 · ETH 6 · SOL 4 · HYPE 2 · ZEC 2 |
| `bb_rsi_momentum` | 242 | 264 | BTC 42 · ETH 40 · SOL 42 · HYPE 54 · ZEC 45 |

- `shelf_breakdown_short` is rare by design (four gates, down regime only): about 6 main-card events a month, so **30
  out-of-sample events take roughly five months**. Its grade stays ACCRUING until then. The rule is not loosened to fire
  more: that would fit it to the count.
- `bb_rsi_momentum` fires about 4 times a day on the main card: 30 events in about a week.

Timing (local node, 19 coins, one pass): 24 ms and 33 ms. Inside the scoreboard's CPU budget.

## Measurement limits

- 1h bars stand in for the scanner's 5m/15m volume and its 1-minute trail; its own calls keep the finer rule.
- Hours missing from `candle:hist` skip the bars that need them (a gap is never filled in).
- The 4h trend needs 20 complete 4h bars (~3.5 days) before either rule can fire on a coin.

## Sign-off

- **A · `shelf_breakdown_short`: not signed.**
- **B · `bb_rsi_momentum`: not signed.**

On signing, one PR: each signed body moves unchanged into `explorerReads.mjs`, joins axisbt `AXES`, `readPipeline.mjs`
(registered at the next 00:00 UTC) and `pipeline-stages.json`, and the text above "Results" is pinned by sha256.

## Results

(none yet)
