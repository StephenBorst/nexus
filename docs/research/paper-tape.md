# Paper fills, checked against the public tape

borst, 2026-11-13: "verifying paper agent trades against the public minute tape kills the last 'trust our
server' skepticism on arena and /proof. proof and trust come before growth hooks."

## The gap

A live agent trade carries Orderly order ids: anyone can check it against the exchange. A paper trade is a
row our own exec wrote (an entry price, an exit price, two times). The hash-chained paper log
(`paperLedger.mjs`, anchored) proves rows weren't edited after the fact. Nothing proved the prices were
real.

## The rule (`app/lib/paperTape.mjs`)

Each paper fill (entry and exit) is checked against Orderly's PUBLIC 1-minute bar for the minute it was
taken, or the minute before (exec reads the price a moment before it stamps the row):

| Verdict | Meaning |
|---|---|
| ON_TAPE | inside that minute's traded low–high |
| NEAR | outside it by ≤ 10 bps (`TAPE_TOL_BPS`). Paper fills at the mark, an index price, not a trade, so at a minute's extreme the mark can sit a hair past the trades. Shown with its distance. |
| OFF | further out. Shown with its distance, never hidden. |
| NO_TRADES | no bar printed in either minute |
| NO_DATA | Orderly answered nothing for a fill older than 3 days (it no longer serves that minute) |
| AVERAGED | a DCA position's blended entry (exec stamps `entry_avg` on the paper row from 2026-11-13): no single trade printed it, so it's labelled, not judged. Its exit still is. |
| PENDING | not checked yet |

**Trigger check** (2026-11-13). A stop or target exit fires when the MARK crosses its level, and the mark can
spike past a level no trade reached. For an SL or TP row carrying its level (`sl_percent`, `tp_percent`: exec
stamps both on paper rows; a TP ladder has no single level and isn't judged), the exit check also asks whether
any bar from 2 minutes before the exit's minute through that minute traded at or through the level:

| Trigger | Meaning |
|---|---|
| TRADED | the tape reached the level |
| MARK_ONLY | no bar reached it: the exit fired on the mark alone (a phantom stop/target). Shown with the gap. |

On paper a MARK_ONLY is a measurement error. Live it would be money lost to an index wick (the exchange-side
backstop triggers on the mark too). The bars judged are kept with the check.

What this does NOT do: it doesn't change how paper exits. Paper still exits at the mark the way live exits
with a market order (borst agreed: "paper exits must match live market-order execution, not fantasy wick
fills"). It checks the price was real, not that a wick could have filled it.

## The checker (`workers/nexus-lab-api/paperTape.mjs`)

- Independent of the writer: exec writes `agent:state`; the checker only reads it and keeps its findings
  under its own key, `ptape:{wallet}` in LAB_STORE. It never writes NEXUS_AGENT (tested).
- Each check keeps the bar as Orderly served it and the public request it came from (`source`). A check is
  final: a finished minute never changes.
- Runs at :41 every hour from lab-api's minute cron (its own invocation, away from the :17 jobs). /proof's
  paper wallets first (`paperWallet` on the read registrations), then a rotating slice of `agent:users`
  (200 a run). A fill waits 3 minutes for its minute to close; at most 60 Orderly requests a run, newest
  fills first. A refused read is retried next run; a fill older than 3 days that Orderly refused on 3 runs is
  recorded NO_DATA with the refusal as its reason (2026-11-13: fills from the last ~61h checked fine, everything
  from 89h+ back kept being refused, so they would have been asked about every hour forever). Never a pass.

## Where it shows

- `GET /agent/:wallet/tape`: every paper fill with its verdict, distance, bar and source, plus the rule.
- `/proof/paper/:axis`: a Tape column (entry → exit: ✓ ≈ ✕ · ? avg …) and a summary line.
- Arena: each agent's row shows `tape ✓n ≈n ✕n` (an operator's wallets summed).
- `/proof` → How we grade: one sentence.

## Cost

One Orderly request and one stored check per paper fill, ever. Reading agent states costs one KV read per
wallet per hour.
