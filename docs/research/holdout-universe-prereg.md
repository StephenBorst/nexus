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
