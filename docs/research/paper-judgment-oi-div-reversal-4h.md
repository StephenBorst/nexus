# oi_div_reversal_4h on paper · the 30-trade judgment, locked before trade 1

Drafted 2026-11-13 at borst's request ("run it"), as a copy of the level_reclaim page
(`paper-judgment-level-reclaim.md`, signed by borst the same day). Only the read, its wallet, its config and its record
are changed; every rule is that page's rule. **Signature: pending.** borst's signature is recorded under Results, so
the text above it never moves. The same rules are in code in `app/lib/paperJudge.mjs` (`PAPER_JUDGMENTS`,
`judgePaperRun`). `paperJudge.test.mjs` fails if the text above Results changes, or if this page and the code state
different numbers.

## Where the bar comes from

The Paper gate was written before this wallet existed (`pipeline-if-then.md`, signed 2026-10-23): "After 30 or more
paper trades with parity CLEAN and net positive after fees: a written live plan". This page adds nothing to that bar.
It fixes how each part of it is counted, so the answer at trade 30 is computed, not argued.

What was visible when this was written: nothing. The wallet started at 2026-11-13T19:35:47Z and had 0 trades. The
rules are level_reclaim's, written before this read had a paper wallet.

## The rules

1. **Wallet.** `0xd446acE5934a0A337A9ee5F0D8ad37FdF8a1e2CD`, the oi_div_reversal_4h paper wallet, trading
   `OI_DIV_4H_PAPER_CONFIG` (graded exit, 11 main coins, fixed $50 margin at 3×).
2. **The trades judged.** The first 30 paper trades closed after the record start (the later of the wallet's
   `started_at` and its `paper_reset_at`), numbered by close time as `/proof/paper/oi_div_reversal_4h` numbers them.
   Trade 31 and later never count toward this verdict.
3. **A reset ends the run.** If the wallet's paper record is reset after this page was written (`paper_reset_at`
   later than 2026-11-13T00:00:00Z) the verdict is RESET: final, shown, and the run it replaced is not judged. A
   new run needs a new dated page.
4. **The money bar.** Each trade's net, in bps of its entry notional:
   `net = move − fees − funding`, where
   - move = the price move in the trade's direction, from its judged entry to its judged exit (rule 5);
   - fees = 2.5 bps taker on the entry notional plus 2.5 bps on the exit notional (the account's Gold-tier rate on
     the day of writing; frozen here, a later change of rate doesn't move this run);
   - funding = what the position paid while held, from the recorded hourly rates (`heldFundingBps`); collected
     funding counts as a negative cost. A trade whose funding can't be read is judged without it and counted.
   The 30 trades weigh the same (the wallet trades a fixed notional). **Mean net above 0 bps = PASS. Mean net at or
   below 0 = FAIL.** No slippage is charged: paper fills at the mark, and live slippage is measured on its own
   (`GET /agent/:a/slippage`).
5. **Judged prices come from the public tape** (`paper-tape.md`, the stored check of each fill):
   - ON_TAPE or NEAR (within 10 bps of what traded): the paper price.
   - OFF (more than 10 bps outside what traded in that minute): the worse of the paper price and the nearest price
     that traded in the checked bar. A buy is judged at no less than the bar's low, a sell at no more than its high.
     A price that wasn't on the tape can only hurt the run, never help it.
   - NO_DATA or NO_TRADES (Orderly had no bar to check against): the paper price, and the count is printed with
     the verdict.
   - Not checked yet (PENDING): the verdict waits.
6. **Parity.** `paperParity` over the run's entries: from the record start to the 30th trade's entry (plus parity's
   10-minute clock slack). Each of the 30 entries must pair with a graded event, and every graded event the wallet
   was free to take before then must have an entry. Events while the 30th trade is held are its own (busy) and
   outside the run. Read once that window is settled (2 hours, parity's settle time) and the 30th trade has closed.
   CLEAN = the verdict is given. DRIFT or UNVERIFIABLE = HELD: no verdict until the drift is explained ("a DRIFT
   stops every step below until it's explained", pipeline-if-then.md). An explanation is a change to the parity
   rule in its own PR, never an edit here.
7. **Final once.** PASS, FAIL or RESET is recorded once in `pjudge:oi_div_reversal_4h` (LAB_STORE) with the 30
   trades as judged, and never rewritten. Served at `GET /signals/paper-judge/oi_div_reversal_4h` and on the paper
   run page. The verdict is then appended under Results in its own PR.
8. **What a verdict licenses.** Nothing automatic.
   - PASS: a written live plan may be drafted and signed (its own dated page and PR; none exists for this read). The
     house rules (`live-money-review.md`) still bind: the $10 mechanics test first; arming and size are borst's, in
     person.
   - FAIL: the read stays Tradeable on the scoreboard and nothing goes live. The gap between graded and traded is the
     next question, written down before it is looked at.

## Results

(none yet)
