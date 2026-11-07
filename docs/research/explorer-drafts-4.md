# Explorer reads, batch 4 · DRAFTS, not registered

**Status (2026-11-07, borst signed):**
- **A · `btc_lead_lag`: registered** at p90 · lag 0.75 (`btc-lead-lag-prereg.md`), counting from 2026-11-08T00:00Z.
- **B · `funding_settle_snap`: dropped.**
- **C · `level_reclaim_weekly`: dropped.**
- **D · `funding_basis_split`: parked** until it is counted on the basis history route, after deploy. Counted
  2026-11-07 (below): 195 main / 45 holdout at the drafted setting. Waiting on borst.

This page is the record of how the four were defined and counted. It is not a registration. The text below is the
draft as reviewed; the registered body moved unchanged out of `explorerDrafts4.mjs`.

Code: `workers/nexus-lab-api/explorerDrafts4.mjs`, checked by `explorerDrafts4.test.mjs`. To count:
`node tools/explorers/powerCheck.mjs <dir> 60 --batch=4`.

## Why these, and what they have to beat

On 2026-11-07 the board says one thing clearly. Out of sample, `level_reclaim` is the only read that also holds on
coins it never saw:

| Read | Main card | Holdout |
|---|---|---|
| `level_reclaim` | 74 events, +0.36R | 48 events, +0.19R, beats 90% of random |
| `oi_div_reversal_4h` | 53 events, +0.47R, beats 100% of random | 16 events, −0.22R |
| `confluence_follow` | 62 events, +0.14R | 24 events, −0.12R |

So every threshold in this batch is relative: to the coin's own history, or to BTC's. None is a fixed number, so
none was tuned on the main card.

**No mirrors.** None of these is an existing read turned around:
- A is the first read that uses another coin's tape.
- B is the first read timed by funding settlement.
- C is level_reclaim on a longer level, a cousin rather than a mirror. It would go in the overlap block.
- D is batch 2's parked draft, with its substance unchanged.

## The drafts, as frozen for review

All are graded on entries only, with the R contract (stop 1.2× H4 ATR-14, target 1.5× the stop, 168h). Each decides
on data up to and including its deciding bar. Percentiles are mid-rank (ties count half), as in batches 1 and 2.

### A · `btc_lead_lag`
- **The impulse:** BTC's 1h return ranks at or above the **95th** percentile of its own last 30 days (|1h return|,
  needs at least 360 hours).
- **The lag:** in that same hour, the alt moved less than **half** of BTC's move in BTC's direction (or moved the
  other way).
- **The trade:** follow BTC on the alt, entered at that bar's close. Alts only; BTC never fires. Cooldown 12h per coin.
- **Why:** news hits BTC first. Alts usually move more than BTC (beta above 1), so an alt that moved less than half
  hasn't caught up yet.
- **Open choices:** the impulse percentile (95 or 90) and how much counts as a lag (0.5 or 0.75 of BTC's move).

### B · `funding_settle_snap`
- **When:** at a funding settlement S. Orderly funds every 8h. The settlement hours are **assumed** to be
  00:00 / 08:00 / 16:00 UTC; see the blockers below.
- **Crowded:** the funding on the last `oi:hist` row before S ranks at or above the **90th** percentile of the coin's
  own last 30 days (longs pay), or at or below the **10th** (shorts pay). Needs at least 360 rows.
- **The unwind:** over the two hourly bars before S, price moved against the payers by at least **0.5× H4 ATR-14**.
- **The trade:** at S, go with the payers. Longs paid → LONG; shorts paid → SHORT.
- **The claim:** payers close just before the stamp to skip it. Once the funding is paid, that dislocation snaps back.
- **Open choices:** the percentile (90 or 80) and the size of the unwind (0.5× or 0.25× ATR).

### C · `level_reclaim_weekly`
- `level_reclaim`'s rule on the prior UTC **week's** high and low. Weeks start Monday 00:00, and all 168 bars of the
  prior week must be present.
- **The sweep:** at least 0.4× H4 ATR beyond the level.
- **The reclaim:** an hourly close back through the level within 6h. Enter at that close. One event per level per week.

### D · `funding_basis_split`
- **SHORT:** funding ranks at or above the **80th** percentile of its last 30 days (longs paying), while the
  spot-perp basis is at or below its own 30-day median.
- **LONG:** the mirror case.
- Each series needs at least 360 prior hours. Cooldown 24h per coin.
- **The reading:** the funding print lags the tape, and the crowd it describes is already leaving.
- **What it needs:** the basis series has no public read route. This PR adds one, read-only:
  `GET /agent/basis-history/:coin`. It is counted once that route is deployed.

## Power check · 2026-11-07 (counts only)

Public series were read 2026-11-07 (`/agent/oi-history`, `/agent/candle-history`, 19 coins). These are counts only: no
return, hit rate or R was computed. **Main** = the 11 main-card coins. **Holdout** = the 8 holdout coins, counted over
recorded history (in a real registration they count only from the registration date). The bar, as in batches 1 and 2,
is about **100 events per 60 days** on the main card.

| Draft | Setting | Main, 60d | Longs | Main, 90d | Holdout, 60d | ~100 in 60d? |
|---|---|---|---|---|---|---|
| A · btc_lead_lag | **p95 · lag 0.5** (drafted) | 27 | 17 | 88 | 40 | No |
| | p90 · lag 0.5 | 79 | 37 | 181 | 92 | Borderline |
| | p95 · lag 0.75 | 56 | 31 | 155 | 49 | No |
| | **p90 · lag 0.75** | **143** | 71 | 286 | 110 | **Yes** |
| B · funding_settle_snap | **p90/10 · 0.5× ATR** (drafted) | 38 | 24 | 51 | 11 | No |
| | p90/10 · 0.25× ATR | 77 | 52 | 100 | 28 | Borderline |
| | p80/20 · 0.5× ATR | 66 | 42 | 89 | 16 | No |
| | p80/20 · 0.25× ATR | 127 | 82 | 169 | 39 | Yes, but p80 is no longer an extreme |
| C · level_reclaim_weekly | **sweep 0.4× ATR** (drafted) | 5 | 5 | 18 | 21 | No |
| | sweep 0.2× ATR | 6 | 5 | 22 | 32 | No |
| | any breach, reclaim ≤ 12h | 19 | 17 | 45 | 47 | No |
| D · funding_basis_split | p80/20 · basis vs median | not counted | | | | Waits for the route |

**What the counts say:**
- **A** passes at one setting, p90 · lag 0.75, which fires about 70 times a month and replicates on the holdout
  (110 in 60 days). ETH and SOL almost never fire; they move with BTC. Most events come from the higher-beta coins.
- **B** passes only at a setting where funding at the 80th percentile isn't an extreme any more. That is the same
  trap that dropped `funding_reset` in batch 2.
- **C** fires 5–19 times in 60 days at every setting. That is months to a first verdict, which makes it untestable on
  our clock (the same reason `vol_breakout` was dropped in batch 1).

## Power check D · 2026-11-07, after the basis route deployed (counts only)

`/agent/basis-history/:coin` read 2026-11-07 23:10Z for the 19 coins; same counter, same window. Basis is recorded on
9 of the 11 main-card coins (ARB and WLD have no OKX spot-perp series), from 2026-08-23; on the holdout from
2026-10-16. The rule needs 360 prior hours of each series, so the main card can fire from about 2026-09-08 and the
holdout from about 2026-10-31: the 60- and 90-day counts are the same.

| Setting | Main, 60d (9 coins) | Longs | Holdout (since ~Oct 31) | ~100 in 60d? |
|---|---|---|---|---|
| **p80/20 · basis vs median · 24h cooldown** (drafted 2026-10-27, before any count) | **195** | 86 | **45** | **Yes** |
| p90/10 · basis vs median | 119 | 56 | 35 | Yes |
| p80/20 · 12h cooldown | 290 | 133 | 77 | Yes |

- Per coin (drafted setting, main): BTC 26 · ETH 32 · SOL 28 · XRP 30 · DOGE 16 · BNB 17 · AVAX 11 · LINK 14 · HYPE 21.
  Holdout: ZEC 7 · NEAR 5 · SUI 4 · PUMP 6 · ENA 5 · ONDO 7 · INJ 6 · ZRO 5, in about a week of eligible history, so
  the holdout should reach 30 out-of-sample events in a few weeks.
- **It passes at every setting counted.** The drafted setting was written down on 2026-10-27, eleven days before any
  count, so it is the cleanest one to register.
- **Two cautions, before any outcome:**
  - p80 funding is "elevated", not "extreme". That is fine here: the claim is the DISAGREEMENT between the two prices,
    not the level of either one. It was never pitched as an extreme read.
  - `basis:hist` had holes before the paced `snapshotFlow` fix (CLAUDE.md). The rule only fires on an hour that has a
    basis row, so a hole means a missed event, never a made-up one.
- **Overlap.** It reads funding, as `confluence_follow` does. If registered, the pair goes in `OVERLAP_PAIRS` (a count,
  never a grade).
- **Recommendation: register at the drafted setting** (p80/20 · basis vs its 30-day median · 24h cooldown), counting
  from the next UTC midnight after you sign. That makes 12 registered reads.

## Two blockers on B, written before any outcome

1. **The settlement hours are assumed, not read.** This session can't reach Orderly. Before B can be registered, the
   hours have to come from Orderly's funding endpoint (`next_funding_time`) for each traded market. If any market
   settles on another schedule, the rule as written is wrong for it.
2. **The bar can't see the effect.** If it is real, it plays out within hours. The pipeline judges reads on the R
   contract, which holds up to 168h. A snap-back that completes in 3 hours, then drifts, grades as noise. That is a
   reason B can fail. It is not a reason to change the bar.

## The odds of a fluke

Ten reads are registered today. Each new one is another chance for one to clear the Lead bar by luck. The guards stay
as written in `read-pipeline.md`:
- only out-of-sample events count;
- the holdout is graded on its own;
- EDGE needs BEATS_RANDOM on its side;
- nothing is re-tuned after registration.

Registering A alone makes 11.

## Decisions for borst before anything is dated

1. **A · btc_lead_lag.** Ready to register at **p90 · lag 0.75** (143 main / 110 holdout in 60 days). The drafted
   setting (p95 · 0.5) fails the bar. My recommendation: register it at p90 · 0.75.
2. **B · funding_settle_snap.** My recommendation: **drop it** for this batch. Its only passing setting isn't an
   extreme, the settlement hours are unconfirmed, and the bar can't see an effect that lasts hours. If you want it
   anyway, it waits until the hours are confirmed and registers at p90/10 · 0.25× ATR (77, borderline).
3. **C · level_reclaim_weekly.** My recommendation: **drop it**. It is too rare at every setting.
4. **D · funding_basis_split.** The read-only basis route ships with this page. Once it's deployed, I count D and
   bring the numbers back here before anything is signed.
5. Whatever you sign is registered in its own dated PR. Its body moves unchanged from `explorerDrafts4.mjs` (at the
   setting you pick) into `explorerReads.mjs`, gets its own prereg page, and starts counting from the next UTC midnight.
