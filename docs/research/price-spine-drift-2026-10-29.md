# The ETH drift of Oct 28 · the price spine is rewritten after the agent acts

Found 2026-10-29. Nothing has been changed yet. The fix proposed at the end needs borst's go.

## What parity showed

On 2026-10-29 all three paper wallets read DRIFT on one trade. No other entry was unmatched, and none of the misses
was unexplained.

| wallet | entry | exit | P&L |
|---|---|---|---|
| `0x9A30…cB28` | ETH LONG, 2026-10-28 21:20:41 UTC | 2026-10-29 01:40 | −$3.67 |
| `0xa77c…a9a7` | ETH LONG, same second | 2026-10-29 01:48 | −$10.32 |
| `0x325D…95DE` | ETH LONG, same second | 2026-10-29 01:48 | −$5.16 |

All three wallets got the brain's one signal. Parity said: "no graded event in that market within 3h before entry".

## Why

The basis × CVD read needs the price move over the CVD hour. Both the brain and the grader take that price from
`oi:hist` through `priceByHour` (`app/lib/basisStack.mjs`). That function buckets each row to the NEAREST hour
(`Math.round`), and when two rows land in one bucket, the later row wins.

The brain writes an `oi:hist` row whenever the last one is 55 minutes old, so the write minute drifts. On Oct 28 the rows
were:

| written (UTC) | bucket | price |
|---|---|---|
| 19:30:05 | hour 20 | 2358.36 |
| 20:30:05 | hour 21 | 2351.36 |
| 21:25:14 | hour 21 (overwrites) | 2365.57 |

The basis row at 21:17 was an extreme discount (LONG). The CVD row at 21:17 leaned to buying (tilt +0.18).

- **The brain at 21:20** saw hour 21 = 2351.36 against 2358.36, a −0.30% move on buying: accumulation, CVD confirms
  LONG. It traded.
- **The grader afterwards** sees hour 21 = 2365.57, written at 21:25, five minutes after the trade: +0.31% on buying.
  Price and flow agree, so the read is neutral and there's no event.

Replayed with the shared `basisCvdConfirm` on the stored rows from the public `/intel/flow/ETH` and
`/agent/oi-history/PERP_ETH_USDC`: live `confirmed: true, LONG`; full data `CVD neutral (no divergence)`.

So the brain did what it should with what it had. The grader read a price recorded after the decision. That's a small
look-ahead in the grader, not a fault in the live path.

## How often

Over the last 30 days, each market's `oi:hist` has 22–27 hours where a second row overwrote the first. That's about one
hour a day per market where the brain and the grader can see different prices. Most of those hours fire nothing. This
ETH trade is the first time it reached a paper trade.

The same 30 days also show about 190 empty hours per market. Those are two brain outages (Oct 1–4 and Oct 4–9), not this
issue.

## What it touches

- Every read whose events use the `oi:hist` price spine: the basis × CVD family, the CVD reads and the registered
  pipeline reads that build on them. They are all graded on the same rule.
- The graded-exit variant this wallet ran is already retired (2026-10-26, `graded-exit-prereg.md`), so this drift
  decides nothing there.

## Proposed fix (not done)

In `priceByHour`, keep the FIRST row in each hour instead of the last. That's one line, and the brain, the grader and the
backtest all share it. The grader then reads the price the agent could have seen, and a later row can't rewrite an
hour after a decision.

It changes past events in roughly one hour a day per market, so a few registered reads' out-of-sample counts may move
by a handful. Two ways to take it:

1. Apply it now, logged as a dated data-validity amendment on the read pipeline: the ruler gets fixed, and no read's
   rule changes.
2. Leave the grader as it is and teach parity to name this case "explained: price spine rewritten after entry".

Recommendation: 1. It's early, the counts are small, and the grader shouldn't use a price the agent couldn't have
seen.

## Applied · 2026-10-30

borst's go, 2026-10-30: first row wins, applied in `priceByHour`. The brain, the scoreboard, parity and the backtest all
read it, so the live view and the grade can't diverge on a rewritten hour again. A test replays the Oct 28 ETH rows: the
brain's view at 21:20 and the grader's later view give the same answer (`app/lib/basisStack.test.mjs`).

It is a measurement fix, not a rule change. The re-scored numbers are logged under "Measurement changes" in
`docs/research/read-pipeline.md`, before and after.

Not covered: if the brain decides before an hour's first row exists, it sits out ("no price"), and the grader, reading
later, can still fire on that hour. That shows up as an unexplained miss, not a phantom trade. Closing it means the brain
writing its row at a fixed minute, a separate change.
