# Scanner rule check · posted vs skipped vs off-rule

Built 2026-11-16 (borst: "check the scanners against their own rules first so we can verify posted vs skipped vs
off-rule calls"). A measurement, not a grade: it moves no stamp, licenses nothing and never feeds the scoreboard.

## Why

The two Bankr scanners post calls from their engine wallet (`0xbce4…f432`). The scoreboard also runs their rules itself
every hour (`shelf_breakdown_short`, `bb_rsi_momentum`, registered from 2026-11-17, `scanner-reads-prereg.md`). The calls
are graded like everyone's, but a caller that posts only its best-looking setups looks better than its own rule. This
check lines the two records up so a skipped setup or an off-rule call shows.

## The match (`app/lib/ruleCheck.mjs`, served by `GET /engines/rule-check/:wallet`)

- **Setup** = an event the registered rule fired on one of the engine's coins (BTC, ETH, SOL, HYPE, ZEC) after
  2026-11-17T00:00Z, from the scoreboard's own generators on the recorded hourly tape (`candle:hist`). The two rules on
  the same coin, side and hour are one setup.
- **Posted** = a public call from the wallet on that coin and side, published from the bar's open to 2h after its close
  (`MATCH_AFTER_MS`). Each call matches one setup at most.
- **Skipped** = a setup with no matching call once that window has closed. **Pending** = the window is still open.
- **Off-rule** = a public call from the wallet that matches no setup, including a second call on one setup and a call on
  a coin the check doesn't cover.
- A coin whose tape can't be read is named `unread`; its setups and calls are left out, never counted as a skip.

## Known gaps (said on the page, never fixed by loosening the match)

The scanners also use a macro freeze, 5m/15m volume and (breakout) a ≤ 0.60% retest entry, which the registered rules
leave out. Some skips and some off-rule calls are expected. A big gap is a question for the scanner, not a grade.

## Where it shows

/proof → Our engine callers → the scanner row: "Rule check since Nov 17: N setups on its coins · posted · skipped ·
pending · M calls off its rules." Every engine wallet now gets its row before its first grade (posted count + last call).
