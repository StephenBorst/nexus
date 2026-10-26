# Live money · the review a strategy passes before it trades real funds

Written 2026-10-26, while every registered read is still at Registered and nothing is close. **Draft: not signed.**
borst signs it, or rewrites it, before any strategy reaches the Paper stage. It arms nothing. No flag, key, secret,
mode or wallet changes because of this page.

The stages and their bars are `docs/research/pipeline-if-then.md` and `app/lib/readPipeline.mjs`. That page says what
happens at Paper: "After 30 or more paper trades with parity CLEAN and net positive after fees: a written live plan
(size, daily cap, kill switch, who signs) as its own dated PR. Arming stays borst's call, in person." This is the
checklist that plan answers to.

## Where it stands (`GET /intel/axis-backtest`, 2026-10-26 00:14 UTC)

- No read is past Registered. Nearest by count: level_reclaim (26 of 30 events, mean R −0.10, halves disagree).
  session_momentum is failing (40 events, −0.76R).
- Basis × CVD, graded exit: 4 of 30 out-of-sample trades, +44.9 bps. The read itself now grades PROMISING. Under
  `graded-exit-prereg.md` ("the read itself falls below PREDICTIVE") that is the Fails condition. borst decides.
- Live money anywhere: none. The carry sleeve's `CARRY_LIVE` is off. The graded exit refuses every non-PAPER config in
  code.

## What paper does not test (each one is a gap the plan has to close or price in)

1. **Fees.** Paper P&L is price move × size (`computePnl`, exec `logic.mjs`). It subtracts no fee. The grader assumes
   3 bps a side. Live orders are MARKET (taker). Before the review, the paper ledger is re-read with the account's real
   taker fee (Orderly base + our broker fee, read from the account, not assumed) on every entry and exit. "Net
   positive after fees" means after THAT, not after the paper number.
2. **Funding.** Neither paper nor the grader charges funding. A 168h hold pays or earns funding at every interval it spans. The
   re-read adds the recorded funding over each trade's hold.
3. **Fills.** Paper fills at the mark. Live MARKET orders fill at the book, with slippage that grows with size. The
   plan states a size small enough that the top of the book covers it on every listed market, or measures slippage
   on a first live tranche and reports it beside the paper record.
4. **The graded exit's stop has no cap.** 1.2× H4 ATR runs 4–6% on volatile coins (the flat-stop path caps at 3%).
   It is paper-only in code (`gradedExitRefusal`). Lifting that is its own reviewed PR, which also states the cap (or
   the reason for none) and the leverage that keeps a full stop well inside margin.
5. **One position across markets.** Paper already trades as the agent does (parity checks it). Live adds the -1101
   margin rule: `capitalPerTrade` stays near 60% of free collateral or the order is refused.

## The plan (one dated PR per strategy; every field filled in before it's reviewed)

| field | what it says |
|---|---|
| Strategy | The read, the preset id, the stage as served, the date it reached Paper. |
| Paper record | Wallet, trades since reset, parity (must be CLEAN), net after the fee + funding re-read above. |
| Wallet | A dedicated account with only the risk capital in it. Never the treasury Safe, never a wallet holding anything else. |
| Size | `capitalPerTrade`, leverage, the max loss per trade in $ at the graded stop. |
| Daily cap | `maxDailyLossUsdc` and `maxTradesPerDay`. |
| Total cap | The $ drawdown at which it stops for good and goes back to paper (kill + write-up, not a pause). |
| First tranche | Size and number of trades for the first live run, and what is compared after it (slippage, fees, parity live vs paper). |
| Kill switch | Who can hit it and how (Lab KILL, `POST /agent/:a/kill`). Tested on the wallet before arming. |
| Key | Order-only Orderly key (cannot withdraw), encrypted at rest, scoped to that account. |
| Who signs | borst, in person. The PR records the date and that it was him. |
| Stop rules | Parity DRIFT, a live record that falls below the paper record by more than fees explain, or the read retiring on the scoreboard ⇒ back to paper the same day. |

## What already exists (don't rebuild it)

Daily-loss cap, max trades a day, kill switch on its own KV key (`agent:kill:{addr}`), AUTONOMOUS behind
`confirm: "GO LIVE"`, order-only keys with AES-GCM at rest, owner-signed agent mutations, reconcile/self-heal, the
live ledger anchored on Arbitrum, live vs paper records kept apart.

## Never

- No arming by a session, a scheduled task or a PR merge. Arming is borst, in person, per strategy.
- No live money on a strategy that hasn't reached Paper as served, or whose read has dropped since.
- No pooled wallet, no user funds, no "copy into live" for other users until the house strategy has its own live record.
- No changing a bar to make a strategy pass. A changed bar is a new dated page.
