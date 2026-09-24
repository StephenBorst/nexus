# Routine prompt — "Re-validate Nexus engine — basis + conditioner stack"

Routine: `trig_01E1U5mnh4qcNMqFDxQKzJcx` · fires 2026-10-15 15:00 UTC · edit at
https://claude.ai/code/routines/trig_01E1U5mnh4qcNMqFDxQKzJcx (only the owner can edit it —
it was created outside an agent session). Paste everything below the line as the prompt.

⚠️ The cloud environment's network policy blocks `og.nexustradinglabs.com` (verified
2026-09-24: curl AND WebFetch both denied). Add it to the environment's allowed domains
(environment settings → Network access) or the routine can't fetch the scorecard.

---

Re-validate the Nexus trading engine's edge on now-matured data. You run in the cloud with no access to local files — everything you need is in this prompt.

BACKGROUND (Sept-14 2026 baseline, when basis:hist was ~3 weeks old): An exhaustive walk-forward search found the naive funding/OI dials are all dead (funding_fade = NOISE, meanR -0.27). The breakthrough was the spot-perp BASIS. The axis scorecard graded basis_extreme (fade the perp premium/discount at its trailing-p90 extreme) = PREDICTIVE, meanR +0.07, n=209, maxDdR 42, +93bps@24h stable — the first predictive axis in the whole search. Then a CONDITIONER STACK (take the basis fade ONLY when a second orthogonal read agrees on side at that hour) improved it:
- basis_x_smart (basis fade + smart-money lean agrees): PREDICTIVE, meanR +0.17, n=98, maxDdR 22 — the best risk-adjusted config.
- basis_x_cvd (basis fade + CVD divergence agrees): PREDICTIVE, meanR +0.15, n=26 (THIN), maxDdR 5.5.
- basis_x_liqflush (basis fade + liquidation-flush timing): PROMISING, meanR +0.15, n=60, maxDdR 11.5 (not halves-stable yet).

WHAT IS WIRED TO THE AGENT NOW (as of Sept-24 2026 — PAPER presets only, nothing live):
- basis_extreme → agent signalMode BASIS_FADE (preset "Basis Extreme Fade"). The rule lives once in app/lib/basisFade.mjs; the scoreboard grades it and the brain trades it.
- basis_x_cvd → BASIS_FADE + basisConfirm:"CVD" (preset "Basis × CVD Stack"). Rule lives once in app/lib/basisStack.mjs; a parity test proves the live gate fires on exactly the hours/sides the scoreboard's basis_x_cvd grades.
- basis_x_smart and basis_x_liqflush are NOT wired to the agent yet (research only).
- POST /agent/backtest refuses BASIS_FADE (basis history isn't in the replay) — the scoreboard is the only grade.

TASK:
1. Fetch the scorecard twice: GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=20' and GET 'https://og.nexustradinglabs.com/intel/axis-backtest?min=10' (try curl via Bash; if that fails, try WebFetch). Each returns JSON with an `axes` array; each axis has {name, verdict, r:{samples,meanR,hitRate,maxDdR,stable}, best:{h,meanBps,hitRate,samples,stable}}. Verdicts rank PREDICTIVE > PROMISING > NOISE > INSUFFICIENT.
   ⚠️ If BOTH fetch methods fail (network/egress block, non-200, or non-JSON), STOP. Your final message must start with "BLOCKED — could not reach og.nexustradinglabs.com", include the exact error, and say the fix: add og.nexustradinglabs.com to the cloud environment's allowed domains (environment settings → Network access), then re-run this routine. Do NOT estimate, recall, or invent any numbers.
2. For basis_extreme, basis_x_smart, basis_x_cvd, basis_x_liqflush: report the CURRENT verdict, n, meanR, maxDdR, and stability, side by side with the Sept-14 baseline above.
3. Judge: (a) did basis_extreme HOLD PREDICTIVE on the longer window? (b) did basis_x_smart hold or improve (target: still PREDICTIVE, n~200+, meanR >= +0.10, maxDdR not worse)? (c) did basis_x_cvd mature to a healthy sample (n well above 20) and stay positive/stable — i.e. is the wired "Basis × CVD Stack" preset trading a read that survived? (d) did basis_x_liqflush become halves-stable / PREDICTIVE?
4. Recommend clearly, one line each: (i) keep, pause, or drop each of the two WIRED presets (Basis Extreme Fade, Basis × CVD Stack); (ii) whether basis_x_smart has earned being wired next as basisConfirm:"SMART" (same shared-rule + parity-test pattern as the CVD gate); (iii) whether anything is robust enough to discuss moving from PAPER toward live. If any config DECAYED like past in-sample mirages (the pct98 / RV-v5 lessons — a lucky short window that didn't hold), say so plainly. Discipline over hope.
5. Output a concise, structured report as your FINAL message (borst reads the run log). Do NOT modify code, open PRs, or arm any capital — everything stays PAPER until borst signs off in person.

Be honest and specific with the numbers. A null or declining result is a valid and valuable outcome — report it straight.
