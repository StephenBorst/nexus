# Explorer reads, batch 2 · DRAFTS, not registered

**Status (2026-10-27):** drafts for borst's review. Nothing here is registered, dated or graded. No outcome was looked
at: the only thing run on these rules is the count-only power check (how often a rule fires, never what price did
after). Signing a read = a dated registration in its own PR that moves its body, unchanged, into the registered set.

Code: `workers/nexus-lab-api/explorerDraftsB.mjs` (never imported by the scoreboard; `explorerDraftsB.test.mjs`
fails if it is). Count: `node tools/explorers/powerCheck.mjs <dir> 60 --batch=b`.

## Why these, and why only these

The brief: 3–5 new mechanisms on data we already record, including the 4h `oi_div_reversal` the registration names,
and no mirrors.

**What we record hourly:**
- `oi:hist`: price, OI and funding.
- `candle:hist`: hourly candles.
- `basis:hist`: spot-perp basis.
- `cvd:hist`: buy vs sell volume.
- `liq:hist`: liquidations.
- `sm:hist`: smart-money stance.

**Most of it is already graded.** The scoreboard grades 23 reads on these series: funding fade, basis extreme and
deviation, CVD divergence, liquidation flush, smart follow/fade, the basis stacks, the RSI and relative-strength
families, and the five explorers. Most grade as noise.

**Two limits on new reads:**
- Deribit volatility (the term structure) is read in the browser only, because Deribit blocks our worker, so nothing
  records it. A vol-regime read can't be counted or graded until something records it. It is not in this batch.
- Only `oi:hist` and `candle:hist` have public history routes. A read on basis, CVD or liquidations can't be counted
  from outside the worker without a read-only history route, so D below is defined but not counted.

**No mirrors.** None of these is an existing read turned around:

| Draft | Nearest graded read | Why it isn't that read or its mirror |
|---|---|---|
| A · `oi_div_reversal_4h` | `oi_div_reversal` (24h) | Same rule, 4h window: named in the registration as a later version. Fires a third of the time within a day of the 24h read (below). |
| B · `oi_coil_break` | `vol_breakout` (dropped, never graded) | Asks for OI building into a flat tape, not an ATR squeeze, and follows the break. |
| C · `funding_reset` | `funding_fade` (NOISE; shorts worse than random) | Doesn't fade the extreme. Waits for the extreme to clear by price, then enters. The mirror of funding_fade would go long into high funding; this goes long after high funding has reset and price has dropped. |
| D · `funding_basis_split` | `funding_fade`, `basis_extreme` | Uses the disagreement between the two leverage prices, not either level. |

## The drafts, as frozen for review

All are graded on entries only, with the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h). Each decides
on data up to and including its deciding bar. Percentiles are mid-rank (ties count half), as in batch 1.

### A · `oi_div_reversal_4h`
- The registered `oi_div_reversal` rule on a 4h window. It runs the same code path with different settings, so the two
  can't drift apart.
- Fires when |4h return| is at or above the 90th percentile of |4h return| over the prior 30 days, and OI fell at
  least **2%** over the same 4h.
- Fades the move: a rally on falling OI goes SHORT, a drop on falling OI goes LONG.
- Cooldown **12h** per coin. Same warm-up as the 24h read (half the 30 days).
- Open choices: the OI drop (1 / 2 / 3%) and the cooldown (4 / 12 / 24h). All are counted below.

### B · `oi_coil_break`
- **Coil**, decided on the `oi:hist` row at hour h:
  - OI rose at least **5%** over the prior 24h,
  - and |24h return| is at or below the **30th** percentile of |24h return| over the prior 30 days.
- **Break:** within 12h after the coil hour, the first hourly candle that closes above the high of the 24 candles
  ending at the coil hour goes LONG; one that closes below their low goes SHORT. Stamped at that candle's close.
- One event per coil, cooldown 24h per coin. The 24 range candles must all exist.
- Open choices: the OI build (3 / 5 / 8%) and how flat counts as flat (30th or 50th percentile).

### C · `funding_reset`
- **Crowded:** at some hour in the prior 24h, funding was at or above the **90th** percentile of its prior 30 days
  (longs paying). The percentile is taken over the 30 days before that crowded hour, so a crowded stretch can't move
  its own bar.
- **Cleared,** at hour h: funding is now at or below that window's median, and price is at least **1× H4 ATR-14**
  below its price at the crowded hour. That goes LONG.
- The short case is the same in reverse: funding at or below the 10th percentile, back to the median or above, price at
  least 1× ATR higher. That goes SHORT.
- Cooldown 24h per coin.
- Open choices: the crowd percentile (90 / 80), the drop (1 / 0.5 × ATR) and the window (24 / 48h).

### D · `funding_basis_split` (defined, not counted)
- Fires when funding is at or above its 30-day 80th percentile (longs paying), but the perp trades at or below its
  usual discount to spot (basis at or below its 30-day median).
- The reading: the funding print lags the tape, and the crowd it describes is already leaving. That goes SHORT. The
  reverse case goes LONG.
- It can't be counted from here: basis history has no public read route. Counting it needs a small read-only history
  route, which is a worker change, so it's your call.

## Power check · 2026-10-27 (counts only)

The window is the last 60 days of recorded history on the 11 main-card coins.

**Why the counts are projected.** DOGE, BNB and LINK only started recording OI in late September, so the raw counts
understate the steady rate. The **projected** column scales the per-coin rate of the six coins recorded since July
(BTC, ETH, SOL, XRP, HYPE, WLD) to all 11. The bar, as in batch 1, is about 100 events per 60 days on the main card.

| Draft | Setting | Fired (60d, raw) | Longs | Projected, 11 coins | ~100 in 60d? |
|---|---|---|---|---|---|
| A · oi_div_reversal_4h | **OI −2% · 12h cooldown** (proposed) | 111 | 43 | **169** | **Yes** |
| | OI −1% · 4h | 150 | 69 | 226 | Yes |
| | OI −3% · 24h | 87 | 38 | 134 | Yes |
| B · oi_coil_break | **OI +5% · flat ≤ p30** (proposed) | 64 | 29 | **94** | **Borderline** |
| | OI +3% · flat ≤ p30 | 71 | 35 | 105 | Yes, just |
| | OI +3% · flat ≤ p50 | 82 | 41 | 121 | Yes |
| | OI +8% · flat ≤ p30 | 52 | 21 | 77 | No |
| C · funding_reset | **p90 · 1× ATR · 24h** (proposed) | 26 | 15 | **40** | **No** |
| | p90 · 0.5× ATR · 48h | 47 | 27 | 77 | No |
| | p80 · 1× ATR · 48h | 46 | 31 | 77 | No |
| | p80 · 0.5× ATR · 48h | 73 | 44 | 116 | Yes, but p80 is no longer an extreme |

**Overlap.** At the proposed setting, 38 of the 111 4h events (34%) sit within 24h of a 24h `oi_div_reversal` event on
the same coin and side. Two thirds of A's events are new evidence. A third would move with the 24h read.

**Holdout.** On the 8 holdout coins (recorded history, counted from registration only), A fired 21 times, B 4 and C 2.
Six holdout coins only started recording OI on Oct 16, so their counts are thin for weeks.

## The odds of a fluke

Five reads are registered today. Signing A and B makes seven at once, and C would make eight. Each extra read is
another chance for one to clear the Lead bar by luck. The guards stay as written in `read-pipeline.md`:
- only out-of-sample events count;
- the holdout coins are graded separately;
- EDGE needs BEATS_RANDOM on its side;
- nothing is re-tuned after registration.

None of these is loosened for this batch. If you want a stricter bar because more reads are running, that's a change
to `pipeline-if-then.md` and a new dated page, before any registration.

## Decisions for borst before anything is dated

1. **A passes at every setting.** It's ready to register at OI −2% and a 12h cooldown, or at the setting you pick from
   the table.
2. **B is borderline at the proposed setting.** Register it at OI +3% and flat ≤ p30 (about 105), or keep +5% and
   accept roughly 60 days to the first verdict.
3. **C fails the bar at any setting that still means "an extreme cleared".**
   - My recommendation: drop it for this batch, as vol_breakout was dropped in batch 1.
   - The loosest setting passes, but at the 80th percentile funding isn't an extreme any more, so it would be a
     different idea.
4. **D needs a read-only basis history route** before it can be counted. Add the route (a worker change, separate
   PR), or park D.
5. Whatever you sign is registered in its own dated PR. Its body moves unchanged from `explorerDraftsB.mjs` into the
   registered set and starts counting from the next UTC midnight.
