# The holdout universe · pre-registered before its numbers

Written 2026-10-16, before any of these coins has a basis or CVD row. borst signed off the coins, the floors and the
build on 2026-10-16, on three conditions:
1. Re-read the liquidity before anything is added, and drop any coin under a floor on the second read.
2. The eight stay on their own holdout line, never pooled with the original nine.
3. No trading changes.

Everything above "Results" is fixed. A change to a threshold or to the coin list is a new dated page, never an edit
here.

## The question

Basis × CVD was picked and graded on nine coins (BTC ETH SOL BNB XRP LINK DOGE AVAX HYPE). Oct 15: PREDICTIVE, +0.19R
over 62 events, LONG beat 97.3% of random entries. A read chosen on nine coins can look good on those nine by luck.
**Does it hold on coins it was never looked at on?**

## The coins (`app/lib/recordedUniverse.mjs` `HOLDOUT_COINS`)

**ZEC · NEAR · SUI · PUMP · ENA · ONDO · INJ · ZRO.** They were picked on liquidity only, never on the signal. None of
them had a basis or CVD row when they were picked, so nobody could have looked.

The floors (`workers/nexus-lab-api/universe.mjs` `UNIVERSE_RULES`, 24h USD):

| Leg | Floor | Why |
|---|---|---|
| OKX spot volume | ≥ $5M | the basis read |
| OKX perp volume | ≥ $20M | the CVD read |
| Orderly volume | ≥ $40k | real trades behind the graded candles |
| Orderly open interest | ≥ $30k | same |

The Orderly floors are "no thinner than the nine already graded". The first proposal was $1M / $500k, and that
failed six of the nine. Nothing fills on Orderly for these coins, so the Orderly legs only have to show the candles
are real. Any coin where the Orderly mark and the OKX perp price differ by more than 2% is treated as a different
asset (unmatched).

First read (`GET /intel/universe`, 2026-10-16T01:08Z):

| Coin | OKX spot | OKX perp | Orderly vol | Orderly OI |
|---|---|---|---|---|
| ZEC | $86.1M | $1,538.8M | $304,714 | $319,210 |
| NEAR | $39.1M | $370.5M | $453,000 | $38,255 |
| SUI | $23.3M | $135.8M | $81,318 | $45,725 |
| PUMP | $12.6M | $198.4M | $327,828 | $57,821 |
| ENA | $9.0M | $76.5M | $67,777 | $53,961 |
| ONDO | $9.7M | $49.9M | $111,340 | $47,106 |
| INJ | $5.1M | $38.0M | $1,202,393 | $41,429 |
| ZRO | $6.8M | $29.8M | $64,304 | $33,499 |

The second read is at least 12 hours after the first, so the two 24h windows overlap by half or less. It goes under
Results before anything is recorded. A coin under any floor on that read is dropped from the list in the same PR.

## What is recorded

- **lab-api `snapshotFlow`** (hourly): adds `basis:hist` + `cvd:hist` from OKX, the same rows the nine get.
- **brain** (each tick, hourly-gated): adds `oi:hist` (the price spine the R grade walks) and `candle:hist`, with
  candles backfilled ~90 days from Orderly as for every scorecard coin.
- **Nothing else.** No liquidation, smart-money or funding series. No preset, default config or paper wallet lists
  these coins. The graded-exit wallet stays on its nine. The staged `/signals/basis` feed leaves them out, so nothing
  is ever sold on them. A user can still choose one in the Lab like any Orderly market. That was already true before
  this page.

## The line

`GET /intel/axis-backtest` → `holdout`. It runs the same `runScorecard` on the holdout coins alone, for
**basis_x_cvd** (primary) and **basis_extreme** (the read under it), with the same horizons, minimum samples, R
contract, random baseline and per-side splits. The main card keeps its twelve coins. SUI was already on it for its
other reads, and it gets SUI with its basis + CVD emptied, the same as it saw before (`withoutHoldoutFlow`).
`/intel/evidence` leaves the holdout coins out. `axisbt.holdout.test.mjs` pins all of this.

Every holdout event is out of sample by construction. A basis signal can't fire until a coin has 48 hours of basis
history.

## The bar

Read only `holdout.axes[basis_x_cvd]` from `GET /intel/axis-backtest`.

- **Holds**: PREDICTIVE on R, with at least 30 R-graded events, AND BEATS_RANDOM (≥95%) on the side that carries the
  events (LONG on the nine). This is the Oct 4 page's own bar for a read, applied to coins it never saw.
- **Fails**: at 30 events or more, NOISE or BELOW_RANDOM, or mean R ≤ 0.
- **Not yet**: fewer than 30 events, or PROMISING. Nothing changes.
- basis_extreme is reported beside it and decides nothing.

A hold or a fail never changes the main card's verdict. Neither one changes a trade, a preset or a wallet. A hold
means borst can be asked whether the eight join the main universe. A fail is evidence that the read was fitted to
its nine coins, and is weighed alongside the graded-exit result.

How long: the nine produced 62 basis_x_cvd events in about seven weeks. Eight coins at a similar rate reach 30 in
roughly four to six weeks after the first 48 hours. The coins differ, so this is a guess, not a date.

## Results

(Append below. Never edit above this line.)

### Second read · 2026-10-16T05:06Z (`GET /intel/universe` v2, signed-off floors + price check)

PR #119 was merged at 01:45 UTC, before this read, so recording began then. This read came about 4 hours after the
first, not the planned 12, so the two 24h windows overlap more than intended. A third read at least 12 hours after the
first is scheduled. All eight pass. `holdoutFailing` is empty, and no coin's Orderly mark is more than 0.15% from its
OKX perp price.

| Coin | OKX spot | OKX perp | Orderly vol | Orderly OI | Price gap |
|---|---|---|---|---|---|
| ZEC | $75.4M | $1,378.2M | $284,705 | $318,397 | 0.13% |
| NEAR | $38.1M | $345.6M | $344,412 | $33,490 | 0.15% |
| SUI | $17.0M | $109.3M | $51,643 | $45,495 | 0.11% |
| PUMP | $7.2M | $148.2M | $261,472 | $58,312 | 0.11% |
| ENA | $7.1M | $63.2M | $68,187 | $52,539 | 0.11% |
| ONDO | $7.8M | $38.9M | $43,170 | $46,831 | 0.11% |
| INJ | $7.1M | $75.7M | $1,435,797 | $46,391 | 0.14% |
| ZRO | $7.0M | $32.1M | $61,227 | $34,191 | 0.10% |

Closest to a floor: ONDO's Orderly volume ($43k against $40k), NEAR's open interest ($33k against $30k) and ZRO's open
interest ($34k against $30k). BNB, one of the original nine, read $39.9k Orderly volume, just under the floor. The
floors only decide who joins the holdout, so this changes nothing for the nine.

Recording check at the same time: `basis:hist` + `cvd:hist` hold 3 hourly rows each for ZEC, NEAR, SUI and ZRO. The
`/intel/axis-backtest` `holdout` block lists all eight, and both reads are INSUFFICIENT (0 events), as expected before
48 hours of history.

### Third read · 2026-10-16T13:24Z (`GET /intel/universe` v2, about 12 hours after the first)

This read reports only. The page's drop rule applies to the second read, and the coin list is fixed. Dropping a coin
now is borst's call, and it would be a new dated page.

`holdoutFailing` = **[ONDO]**. ONDO's Orderly volume read $38,747, 3% under the $40k floor. Its other legs pass. No
coin's Orderly mark is more than 0.18% from its OKX perp price.

| Coin | OKX spot | OKX perp | Orderly vol | Orderly OI | Price gap |
|---|---|---|---|---|---|
| ZEC | $69.0M | $1,214.1M | $317,910 | $304,344 | 0.14% |
| NEAR | $38.5M | $344.4M | $231,809 | $31,664 | 0.14% |
| SUI | $14.3M | $97.7M | $40,040 | $48,756 | 0.10% |
| PUMP | $5.8M | $114.0M | $165,078 | $55,185 | 0.18% |
| ENA | $7.3M | $57.5M | $71,091 | $50,231 | 0.08% |
| ONDO | $7.7M | $37.6M | **$38,747** | $43,735 | 0.09% |
| INJ | $8.6M | $130.6M | $1,065,253 | $43,043 | 0.10% |
| ZRO | $5.5M | $34.5M | $59,158 | $31,249 | 0.17% |

Closest to a floor besides ONDO:
- SUI's Orderly volume: $40,040, right at the floor.
- ZRO's open interest: $31k.
- NEAR's open interest: $32k.
- PUMP's and ZRO's OKX spot: $5.8M and $5.5M.

Two of the original nine are under a floor on this read: BNB's Orderly volume ($12k) and LINK's OKX spot ($4.7M). The
Orderly floors are day-to-day noise at this size.

Scoreboard check at the same time: the `/intel/axis-backtest` `holdout` block lists all eight. basis_x_cvd and
basis_extreme are still INSUFFICIENT (0 events), as expected inside the first 48 hours.

### Exception rule · dated 2026-10-16 (written 21:21 UTC, before any holdout event was graded)

borst signed this off on 2026-10-16. At the time of writing, basis_x_cvd and basis_extreme had 0 holdout events, and every
registered read's holdout line starts counting at 2026-10-17T00:00Z. So no holdout outcome existed when this rule was
written.

- **Liquidity never removes a coin.** The floors decided who joined, on the second read. Later liquidity reads are
  reported and nothing more. ONDO stays on the list after the third read put it 3% under the Orderly volume floor.
- **A coin stops counting only when its data stops being valid:**
  - its Orderly mark sits more than 2% from its OKX perp price, so they are different assets;
  - OKX delists its spot or its USDT perp, so the basis or CVD rows stop;
  - Orderly delists its perp, so its hourly prices (`oi:hist`) and candles stop.
- **A break stops only the reads that use that data.** For example, an OKX spot delisting stops the basis reads. The
  candle and OI reads go on, because their inputs are still real.
- **Graded events stay graded.** Events up to the break keep counting. Nothing is regraded or removed afterwards.
- **The rule is applied without looking at outcomes.** It is decided on the data check alone, without reading that
  coin's R, hit rate or random-baseline result. Any change to this rule is a new dated page.
