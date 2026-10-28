# Nexus Trading Labs — Project Memory

The current rules. Dated history (how each rule came about, live reads, old numbers, retired designs) lives in
**`docs/history.md`**, a full copy of this file as it stood on 2026-10-26, same headings. Search it before
re-deriving anything; add new history there, not here.

## What this is
An **Orderly Network white-label perp DEX** (`dex-creator-template`) customized into **Nexus Trading Labs**. The base
DEX (markets, swap, vaults, portfolio, leaderboard, points, rewards) is the Orderly SDK, the commodity layer. The
product is what sits on top:
- **The Lab** (`app/pages/lab/index.tsx`, header `// THE LAB`): Market Intel, Nexus Thesis Engine, Agent, Copy Trades,
  Trade Log, Holders Room, Analytics.
- **Thesis Engine**: sizing, R:R, funding cost, live P&L, on-chain thesis registry. A published thesis = a graded call.
- **Agent**: PAPER (default, simulated) · ASSISTED (signals only) · AUTONOMOUS (real orders). Guardrails: daily-loss
  cap, max trades/day, kill switch, order-only keys (cannot withdraw).
- **Social**: Feed, trader profiles, copy trades, XMTP DMs (`app/pages/messages`, envelope `MessagesNavButton.tsx`,
  deep link `/messages?dm=0x…`).
- **/proof**: the public scoreboard of our own reads, graded the way we grade callers.

## Money map + revenue
- Broker fees → `borst.eth` `0x34dF…B45c` (Orderly-registered, don't churn). Subs/AI revenue → EOA
  `0x06cD9c281E6ab09906B46a10e059F2770EfdE49A` (`SUBSCRIPTION_RECEIVER`). **Treasury Safe**
  `0x4Fe2c01bbeFaFFa35706C994646a3F8493B1C733` (1/1, Arbitrum + Base, signer `0x53Ce…9D33`, = `NEXUS_TREASURY_ADDRESS`).
  Sweep the receivers → the Safe on a cadence.
- **x402 data (Bankr-hosted, priced in $NEXUS on Base):** `nexus-signals` (50k/req, `/signals`; the read grades NOISE,
  so every response carries the live `grade` from `/intel/axis-backtest` and the listing says "not a proven edge";
  swap only to a read that clears), `nexus-callers` (10k, `/theses/leaderboard`), `nexus-agents-live` (10k,
  `/agents/live`). Handler + config in `bankr-x402/`; changes go live only via `bankr x402 deploy <name>`. Payout = the
  DEPLOYER wallet (Bankr wallet `0xd9f7…b449`, 95% after Bankr's 5%) → sweep it to the Safe (a multisig can't be the
  deployer). Token-demand framing is internal analysis only, never public copy.
- **PRO** (`PAYMENTS_LIVE=true`): `POST /sub/verify {txHash,chain}` verifies one receipt and grants 30d PRO to the tx's
  `from` (spoof-proof, replay-guarded). USDC/Arbitrum $20 · $NEXUS/Base $15 (DexScreener-priced, 12% tolerance, fails
  closed). `walletIsPro` = paid `sub:{addr}` OR $NEXUS ≥ ARCHITECT (100M) on Base (fails closed). Config single source:
  `app/config/subscription.ts` (`PRO_FEATURES`, `PRO_AGENT_STRATEGIES`). PRO is a software subscription: NO revenue
  share / yield / dividends to holders, ever.
- **Server-enforced PRO gates:** MOMENTUM + MEAN_REVERSION agent modes (402 `pro_strategy_locked` on PUT /agent, PUT
  /config, bankr/activate), DCA (402 `pro_dca_locked`), webhooks, backtest/sweep/validate, hosted AI. Core modes stay free.
- **Owner revenue page `/ops/revenue`** (noindex, not in nav): `POST /ops/revenue {address, labAuth, refresh?}`
  (`routes-revenue.mjs` + `revenue.mjs`). Reads receivers, the Bankr wallet, borst.eth, the Safe and the NEAR Intents
  fee balance; moves nothing. Only a Lab-signed Safe owner or a wallet in `OPS_WALLETS`. Unreadable holding = "unread",
  never 0. Flash + Orderly broker fees aren't on-chain readable.

## Hosted AI (`POST /ai/chat`, PRO)
- Wallet-signed, PRO-gated proxy with our key, prompt caching and a **per-MODEL daily cap**
  (`ai:usage:{addr}:{model}:{date}`). Tiers: Haiku 4.5 100 · Sonnet 4.6 40 (default) · Opus 4.8 20 · Sonnet 5.5 30 ·
  Opus 5.5 12 · Fable 5.1 5. `resolveHostedModel`/`hostedCaps` (lab-api `logic.mjs`) whitelist the id (unknown →
  default tier); client mirror `HOSTED_TIERS` in `config/assistant.ts` (`logic.test.mjs` fails if they disagree).
  Env: `HOSTED_CAP_*`, `HOSTED_AI_DEFAULT_MODEL`.
- The counter is read + bumped under a NexusLock lease (`LOCK_KEYS.aiUsage`): busy → 409, lock down → 503, nothing sent.
- **Spend path = Bankr LLM Gateway** (`AI_GATEWAY=bankr` in wrangler.toml + secret `BANKR_LLM_KEY`) →
  `https://llm.bankr.bot/v1/messages`, dot-notation ids mapped by `bankrGatewayModel` (`BANKR_MODEL_*`). Falls back to
  direct Anthropic (`ANTHROPIC_API_KEY`) if the key is absent. Revert = remove `AI_GATEWAY`. Credits at bankr.bot/llm.
- **Thinking (5.x) tiers:** `shapeHostedBody` sets effort `low` + a 4096 ceiling and drops `thinking`/`temperature`/
  forced `tool_choice`; the client reads text by block TYPE and sends thinking blocks back unchanged with their
  signature (`app/lib/anthropicTurn.mjs`, `createStreamAssembler`). BYOK users get the same handling.
- **Copilot** (`NexusAssistant.tsx`, `config/assistant.ts`, `config/assistantTools.ts`): BYOK keys stay in the browser.
  Bounded tool loop (max 5), models listed live from the key, thesis drafts via localStorage `nexus_thesis_draft` →
  `/lab?tab=thesis` (bare ticker, not `PERP_`). Its prompt must not call PREDICTIVE an edge or suggest inverting a read.

## Stack
- React + Vite + react-router-dom, TypeScript. Orderly SDK (`@orderly.network/*`), `@xmtp/browser-sdk` v7, wagmi.
- Nav + global chrome: `app/utils/config.tsx` (top-nav order by href in `NAV_HREF_ORDER`). Lab storage:
  `app/hooks/useLabStorage.ts` (KV via lab-api). XMTP: `app/hooks/useXMTP.ts` (production), unread `app/utils/xmtpUnread.ts`.
- **Yarn 4**: `yarn add`, never `npm install` at the root (a root `package-lock.json` breaks CI install). Workers use npm.

## Deployment
- **Repos:** prod = `StephenBorst/nexus` (fork of Orderly's `nexus-4421`, which deploys only to GitHub Pages). The
  `dex.orderly.network` config UI writes to Orderly's fork, NOT prod: make every config change in `public/config.js`.
  Don't sync the two repos.
- **Live app** = Cloudflare Pages project `nexus-trading-lab` (`trade.nexustradinglabs.com`, `nexus-trading-lab.pages.dev`),
  NO Git connection: deployed only by `.github/workflows/deploy.yml` (push to main, or `workflow_dispatch` "Build &
  Deploy to Cloudflare Pages"). deploy.yml runs tests, builds, `wrangler pages deploy build/client`, and redeploys
  **nexus-lab-api, nexus-agent-exec, nexus-agent-brain, nexus-carry-engine** from committed source: commit worker
  changes (a var set only in the dashboard is overwritten by wrangler.toml; secrets persist). nexus-ledger-anchor and
  nexus-lab-alerts are manual `npx wrangler deploy`.
- `wrangler pages deploy` compiles `./functions` from the repo root (the call-permalink Function).
- "pages build and deployment" runs = GitHub's own Pages workflow, not Cloudflare (Settings → Pages → Source: None stops them).
- A deploy run failing in ~21s is almost always a `yarn install` flake.
- **If Actions runs stop:** trigger a `workflow_dispatch` first. "Actions has been disabled for this user." = an
  account-level flag (GitHub support, not repo settings; Oct 17–22 2026). Any other message → repo Settings → Actions.
  While runs are blocked, hold merges. After a merge, check a run started (cloud sessions can't read Actions settings).
  A commit that never got a check suite rides the next real change; never an empty commit or a close/reopen.
- **nexus-landing** (`StephenBorst/nexus-landing`, `landing.nexustradinglabs.com`) = a Workers static-assets deploy
  (`wrangler.jsonc`, `npx wrangler deploy` from the root, never `pages deploy`); its own deploy.yml ships every push to
  main. `.assetsignore` must keep excluding `.git`. `llms.txt` is ONE file kept identical in `public/llms.txt` and the
  landing: edit both.
- Cloud sessions reach `og.nexustradinglabs.com`; they can't reach the app/landing domains, Orderly, Quotient, MiroShark,
  Nordstern/0x or GeckoTerminal. Read deploy results in the Action log.

## Cloudflare Workers
- **nexus-lab-api** (`workers/nexus-lab-api`) → `og.nexustradinglabs.com` = `AGENT_API`. Its `*.workers.dev` is NOT
  routed (404/1042): always use the custom domain. `GET /agent/:a` returns `state` wholesale.
- **nexus-agent-exec**: 1-min cron, enters/monitors/closes. Stamps `ops:exec:heartbeat`; `GET /health`.
- **nexus-agent-brain**: 5-min cron, writes `agent:signal:{addr}` and the hourly history series.
- **nexus-carry-engine**: sector-neutral funding-carry basket. Hourly = PAPER record; `*/5` = LIVE maker re-quote, a
  no-op unless `CARRY_LIVE=true`. KV `CARRY` = `b34f3af62cfe4bc2b5d03ce9c7b55868`. Reached on
  `https://nexus-carry-engine.stephenpatrick24.workers.dev` (`CARRY_API` in `app/pages/proof/CarrySleeve.tsx` and
  `app/config/assistantTools.ts`); no custom domain exists, don't "fix" it. **Live path is built, deployed DISARMED,
  owner-only:** don't set `CARRY_LIVE` or add key secrets. Guardrails: no key / `carry:kill` / unbalanced plan ⇒ no-op,
  per-order cap, POST_ONLY. Maker execution is mandatory (taker fees ≈ breakeven). Ops routes need header
  `x-carry-token`. `carryBasket.mjs` is shared with `tools/backtest/relvalue4.mjs`. Read `README.md` before touching it.
  Its tests are split by concern; glob the dir.
- **nexus-ledger-anchor**: hourly anchor + `runMonitor` (Telegram ops alerts: signer gas, ledger drift >6h, brain down
  >15 min via `ops:brain:heartbeat`, exec down >10 min). `GET /monitor-now`.
- **nexus-lab-alerts**: alerts worker. Other legit CF apps: nexus-landing, orderly-proxy.
- KV: brain/exec/lab-api agent routes share `NEXUS_AGENT` = `c3c0582ec71c4d049d0795872f39f033`; lab data = `LAB_STORE`.
  Agent keys: `agent:users|config|key|state|signal|pending|kill:{addr}`.
- Observability logs on in every wrangler.toml. "Agents down" is usually idle by design (`direction:NONE`): check the
  exec Triggers → View events before declaring an outage; ~2 ms CPU ticks are normal.

## Agent
- **Ownership:** `agent:state:{addr}` is written ONLY by exec. The brain writes ONLY `agent:signal:{addr}`. Kill = a
  dedicated `agent:kill:{addr}` (lab-api sets, exec consumes). lab-api GET merges the signal into the state response.
- **Every mutation** (`PUT /agent`, `PUT /agent/config`, `DELETE`, `kill`, `bankr/activate|mode`, `pending/:id/*`,
  `paper/reset`, `test-signal`, webhook enable/rotate/disable) needs `walletSig` = sign_message('nexus-trading-key-v1')
  in the JSON BODY, checked by `requireOwner`. Never via query string. Only `GET /agent/:a` (+ read routes) is public.
  A new mutation without `requireOwner` is a bug.
- **Keys:** AES-256-GCM at rest under `AGENT_ENC_KEY` (same value on lab-api + exec), `v1:<iv>:<ct>`. Bankr path:
  `seed = SHA-256(walletSigBytes)` → `bs58Encode(seed)`; never address-only. AUTONOMOUS needs `confirm:"GO LIVE"`.
- **Orderly signing:** `@noble/ed25519 signAsync` + `bs58` (not `crypto.subtle`), base64url signature, `orderly-key` =
  `ed25519:` + bs58(derived pubkey). GET = `application/x-www-form-urlencoded`, POST = JSON. POST `/v1/client/leverage`
  before each order. Step size/min notional from `/v1/public/info/{symbol}` (not `/futures`). `/trade` must check
  `orderResult.success`. Off-chain EIP-712: registration/AddOrderlyKey verifyingContract = the all-C sentinel
  `0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC`; withdraw passes `0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203` in the body.
- **Qty:** snap with `parseFloat((steps*baseTick).toFixed(decimals))` (plain floor×tick → -1104); ceil one step if the
  value dips under min_notional; guard base_min. -1101 = margin too close to balance (keep a buffer;
  `capitalPerTrade ≈ floor(freeCollateral*0.6)`). Orderly position rows have no uPnL field: compute it.
- **Controls:** ASSISTED = pause entries, still manages. DEACTIVATE = stop + delete key, position left open. KILL =
  close + delete key + deactivate. The agent must be flat before you trade manually on the same account.
- **Reconcile:** exec reads the live position first; exchange flat ⇒ clear the stale record. On a read error it manages
  on cached data, never clears.
- **Modes** (`deriveSignal`, brain `logic.mjs`): CONFLUENCE, FUNDING_ONLY, OI_ONLY, BASIS_FADE (free); MOMENTUM,
  MEAN_REVERSION (PRO). Thresholds and risk params are read live each cycle. **An empty `config.symbols` = the brain
  evaluates nothing** (no "all" default).
- **Exits** (`evaluateExit`, exec `logic.mjs`): SL → TIMEOUT → trail before TP; `takeProfits` ladder OVERRIDES
  `tpPercent` (`normTakeProfits`); DCA has its own monitor path. Exit vocabulary: `SL · TIMEOUT · TRAIL · BE · TP ·
  TP_PARTIAL · KILLED · WEBHOOK_CLOSE` (no "signal flip").
- **Graded-exit contract** (`exitContract:"R_CONTRACT"`, `app/lib/gradedExit.mjs`): stop 1.2× H4 ATR-14, target 1.5×,
  168h. **PAPER ONLY**: `gradedExitRefusal` refuses non-PAPER configs and extra exit parts (exec at the top of
  `enterPosition`; lab-api 409 `graded_exit_refused`). Lifting that = its own reviewed PR.
- **Webhook (PRO):** `POST /agent/hook/:token` → `agent:webhook_signal:{addr}` (600s). **Strategy library:**
  `/agent/:a/strategies` + `/publish`; public board ranks by the author's GRADED record, never backtest.
- **Whole-strategy loads reset the experimental filters** (`EXPERIMENTAL_FILTERS_OFF` in `app/utils/agentPrefill.ts`,
  incl. `basisConfirm` and `exitContract`): presets, sweep rows, scoreboard Load, Proof Deploy, trader COPY, saved/copied
  strategies (`deployToAgent(..., { replaceFilters: true })`, applied by the receiver). Partial hand-offs keep filters.
- **Defaults:** new agents start PAPER on the Basis × CVD Stack preset (`DEFAULT_CONFIG` spreads
  `presetById("basis-cvd-stack")` in `app/pages/lab/types.ts`).
- **Paper record:** `state.paper_trades` keeps the last 50 rows (a window); the lifetime record is `state.paper_agg`,
  accrued once at close (`app/lib/paperStats.mjs`, shared by exec and the Lab). LIVE (Supabase) and PAPER never mix.
  `paper/reset` clears both and stamps `paper_reset_at`. **Paper P&L (`computePnl`) has NO fees and NO funding;**
  `GET /agent/:a/paper-costs` re-reads the retained rows with a taker fee on both legs + recorded funding
  (`app/lib/paperCosts.mjs`; fee = worker var `PAPER_TAKER_FEE_BPS` = 2.5, the account's rate (Gold tier); unset = 3 bps/side labelled "assumed"; a row with no
  recorded rate is counted missing, never free), shown as AFTER COSTS (`PaperCostLine`). Display only.
- **Parity** (`GET /agent/:a/parity`, `app/lib/paperParity.mjs`): pairs paper entries with the graded events, explains
  misses (busy incl. the OPEN position, daily caps on the wallet's own day via `lastReset`, another market won).
  Leftovers = DRIFT. Before calling DRIFT a brain bug, check the open position.
- **Paper wallets:** graded-exit wallet `0x9A3012988d60D61b34660BE06a321F7BF7bCcB28` · 24h arm
  `0xa77ca113f39405b50617c2cc9ba5d6e3ced4a9a7` · nine-market 24h `0x325Da3ed024f533764407524918a847bCb3f95DE`.
- lab-api needs `SUPABASE_URL` / `SUPABASE_ANON_KEY` for History reads.
- `test-signal` and the Force button are DEV/PAPER-only. Feed bridge: `PUBLISH_AGENT_FEED=true` (real trades only).
- Multi-strategy concurrency = one Orderly sub-account per strategy, after a proven edge (deferred).
- Bankr chat-deploy: `POST /agent/:a/bankr/activate|mode` (spec `docs/bankr-agent-spec.md`). Deposits go to the
  trading balance only; OmniVault is not available to external brokers, don't chase it.

## Backtest + replay (`workers/nexus-lab-api/backtest.mjs`)
- ONE engine: imports the deployed `deriveSignal` + `evaluateExit`/`computePnl`; `stepExit` and `entryAt` are shared by
  the per-market replay, the portfolio replay and the random baseline. `tools/backtest` imports it too.
- Routes (PRO, walletSig): `/agent/backtest`, `/agent/backtest/sweep`, `/agent/validate`; publish runs `revalidateStrategy`.
- **Data:** OI and flow (basis/cvd/sm/liq) come from our recorded hourly KV series, gated PER SYMBOL (≥14 days, ≥200
  samples; `loadOiHistForBacktest`, `loadFlowHistForBacktest`). Run the mature subset and name the excluded markets;
  `MIN_VALIDATE_SYMBOLS=2`. Replays are sized to recorded coverage.
- **Not simulated:** `respectRegime`, `respectSmartMoney`, `maxSignalAgeSec`, and `maxTradesPerDay` in the per-market
  replay (the portfolio replay does simulate caps). Surfaced via `backtestGateSupport()`.
- **Portfolio replay** (`runPortfolioBacktest`) = what the agent does (one position across the watchlist, the brain's
  single best signal, daily caps). Sweeps rank by portfolio net; walk-forward verdict stays per-market.
- **Random-entry baseline** (`randomEntryBaseline`, 300 seeded runs): BEATS_RANDOM ≥95 · LEANS_ABOVE ≥80 ·
  NOT_DISTINGUISHABLE · BELOW_RANDOM ≤5 · TOO_FEW <5. One ladder (`baselineVerdict`), exported and reused by axisbt.
  BELOW_RANDOM is never a licence to invert: an inverted rule is a new read, graded first.
- Labels from `app/lib/strategyLabel.mjs` (invert/gates named); the card prints TESTED AS.
- Don't curate the market list to the winners, and don't loosen fold math to make a verdict pass.

## Signal engine — the scoreboard
- `GET /intel/axis-backtest` (`axisbt.mjs runScorecard`, cached; bump the `axisbt:vN` key when the payload changes) →
  /proof and the Feed SIGNALS tab. Forward returns, no lookahead, pooled across the recorded markets, half-vs-half
  stability, horizons 4/12/24h, R on a frozen contract (1.2×ATR stop, 1.5R, 168h).
  Tiers: PREDICTIVE > PROMISING > NOISE > ACCRUING (`INSUFFICIENT`). **PREDICTIVE grades a read, not a strategy, and is
  not an edge**: an edge = BEATS_RANDOM on its side.
- Each axis carries per-side splits, a bps `drift` baseline, a window-matched R `random` baseline, `exit` / `exit24h` /
  `exitGraded` lines for reads a preset trades (contracts in `app/lib/axisExits.mjs`, pinned to the presets by test),
  and `exitGraded.funding` (net of the funding paid while held, `heldFundingBps`; compare with its own `feesNetBps`,
  never the headline; informational, not part of the bar). `tide` = what a random long/short earned.
- **Reads:** basis (OKX spot-perp, `flow.mjs`), CVD, liq-flush, smart money, OI, book imbalance, RSI reset, vol regime
  (Deribit). Basis ≠ contango: basis is a signal, contango/backwardation is a conditioner. Recorded hourly as
  `basis:hist` / `cvd:hist` / `liq:hist` / `sm:hist` / `oi:hist` / `candle:hist` in `NEXUS_AGENT`.
- **One rule, two users:** traded and graded rules live once in `app/lib/` (`basisFade.mjs`, `basisStack.mjs`,
  `gradedExit.mjs`, `funding.mjs`) and both the brain and the grader import them. Parity tests prove live gate ==
  graded read hour by hour. Same-hour semantics: the LAST row in an hour with a side wins (`sideAtHour`). Coalesce
  option defaults per field (a spread of `undefined` over defaults silently disabled a signal once).
- **Basis-fade wiring:** `BASIS_FADE` + `basisConfirm` (OFF / CVD / SMART / LIQ). The brain reads the flow series only
  when a user opted in; stale (>3h) or under warmup ⇒ no signal, never a fallback to funding/OI. Zero-anchored basis is
  long-only in practice (OKX perp sits at a discount); the two-sided `basisAnchor:"MEAN"` path is staged behind brain
  var `BASIS_TWO_SIDED_LIVE` with a test that fails if it's set. Turning it on = a reviewed PR, only after it grades
  PREDICTIVE with both sides.
- **Presets ↔ scoreboard:** `AXIS_PRESET` maps an axis to the preset that trades its exact rule; `AXIS_PAUSED` hides a
  Load with the reason (basis_extreme, basis_x_cvd). Staged and off: `OCT15_BASIS_SMART_LIVE`, `BASIS_SIGNALS_LIVE`
  (`/signals/basis`). Every receipt on the /proof lead must be true of the exact preset its button loads.
- **Recorded universe** (`app/lib/recordedUniverse.mjs`): `RECORDED_COINS` (9) + `HOLDOUT_COINS` (8, ZEC NEAR SUI PUMP ENA
  ONDO INJ ZRO). The holdout is graded separately, never pooled into the main card, `/intel/evidence` or
  `/signals/basis`, and no preset/default/wallet lists it. `GET /intel/universe` = read-only liquidity report.
- **Read pipeline** (`docs/research/read-pipeline.md`, `app/lib/readPipeline.mjs`): REGISTERED → LEAD → EDGE → TRADEABLE →
  PAPER, RETIRED. Only out-of-sample events (after `registeredAt`) count; back-graded history never does. A changed rule
  = a new name + a new dated registration. Stage triggers = `docs/research/pipeline-if-then.md`, applied one PR per
  trigger from the SERVED stage. Registered reads: rsi_reset_deep, level_reclaim, oi_div_reversal, session_momentum,
  confluence_follow (from 2026-10-17); oi_div_reversal_4h and oi_coil_break (from 2026-10-28, their own prereg pages). Registered
  bodies live in `explorerReads.mjs`; unregistered drafts in `explorerDraftsB.mjs` (batch 2, `explorer-drafts-b.md`; tests
  fail if a draft is graded or axisbt imports it). A new registration also adds its read to `pipeline-stages.json`.
- **Retired:** the Basis × CVD graded exit (2026-10-26, `RETIRED_GRADED_EXITS` in proofCopy.mjs), final.
- **Regime window** (`docs/research/graded-exit-regime-prereg.md`, signed 2026-10-26; counts from 2026-10-27T00:00Z,
  limit 2027-04-27): the same read + graded exit, judged once by the watcher via `judgeRegimeWindow`
  (`app/lib/regimeWindow.mjs`, numbers pinned to the page). The scoreboard serves `axes[basis_x_cvd].regimeWindow` (main
  + holdout) and the BTC day counts (`regimeWindow.regime`, Orderly daily candles). `REGIME_RESULT` is set once by the
  judging watcher PR and is final.
- **Pre-registered studies are append-only:** a doc's text above Results is pinned (sha256 tests); verdicts are appended;
  a new idea found on a closed population is a new dated registration (e.g. structure × house fade: CLOSED, not shown).
- **Daily pipeline watcher** (prompt `docs/routines/pipeline-watch.md`, `tools/pipeline/watch.mjs`,
  `app/lib/pipelineWatch.mjs`): compares served stages with `docs/research/pipeline-stages.json`; a change opens a PR on
  `pipeline-watch/<date>`. **Watcher PRs are never merged by a session.** A scheduled task stores its own copy of the
  prompt: after editing the doc, update the task (`update_trigger`).
- **Live money** = `docs/research/live-money-review.md` (draft, unsigned, arms nothing).
- `/intel/evidence?axis=&hold=` replays a preset across every mature market (pooled ≠ independent; say so).
- basis:hist had holes from our own OKX burst until the paced `snapshotFlow` fix: read older windows with that in mind.
- **The Read / Briefing / FADE:** show inputs, never a tally or crown of ungraded reads; the Board's FADE is "a
  mechanical rule, not graded yet" with the nearest graded relative's live grade (`app/lib/fadeGrade.mjs`). Never call
  a read "proven" or "graded" unless the scoreboard grades that exact rule.
- **/proof layout:** verdict (headline is a claim: change it in the same PR a read clears the bar) → board by stage
  (`stageGroups`, never ranked by in-sample R) → calls + callers → agents/arena/desks/carry → ledger.
  Plain-words copy in `app/lib/proofCopy.mjs`; method in `HowWeGrade.tsx`.
- **House caller is OFF** (`HOUSE_SIGNALS_ENABLED` deleted; gates the Catalyst caller too). Check "off" by reading
  `enabled` on `/signals/house` and `/signals/catalyst-house`, never by a quiet run. `POST /signals/house` with
  `HOUSE_SIGNALS_ADMIN` still posts by hand regardless. Keep `HOUSE_CALLER_ADDRESS` set (the dedupe reads it). On again
  only for a read that clears.

## Calls (human + house) — graded from public price
- A published thesis is a call, graded from Orderly 1h candles (`tvhist:v2:{PERP}`, `gradeCandles.mjs`, contiguous
  pages; a call whose window isn't loaded is left out, never graded on a partial window). First touch; same candle =
  LOSS. A WIN pays the GEOMETRIC R from the levels (`callR`), never the stored `riskReward`. Wrong-side levels = INVALID.
  `GRADE_FLOOR_MS`: no grading of times before 2026.
- **The entry must trade:** filled at the post only if the entry is within 0.3% (`ENTRY_AT_MARK_PCT`, in
  `app/lib/entryAtMark.mjs`) of the server's `publishMark`, else inside the posting hour's range (calls without a mark);
  otherwise a resting order graded from its fill hour; never filled = PENDING. Stamps: `fillState` WORKING/OPEN,
  `filledAt`, `tp1HitAt`, `exitedAt`.
- **Published calls are permanent:** the first public save registers the call in `callreg:{addr}` (server clock,
  frozen copy). Every writer of `lab:{addr}` goes through `labWrite.mjs prepareSeal → commit` → `callLock.mjs
  sealTheses`. `SERVER_FIELDS` never come from a client. Owners may only append `updates` and set `lossReason`.
  `callowner:{id}` = first publisher. Publish refuses ungradeable levels and invalid splits. `DELETE` → 409. The hourly
  pass writes onto a fresh read, copying only `PASS_FIELDS`. A grading change that moves stored stamps bumps `GRADE_V`
  (or `PLAN_V`) in grading.mjs so the pass re-derives them once.
- **Split exit:** `exitPlan:"SPLIT_50"` (half TP1, half TP2, both on the original stop); TP2 = TP1 grades as one target;
  TP2 short of TP1 = INVALID. Rules in `app/lib/callMath.mjs` (`splitPlan`, `callInvalidReason`, `callRR`).
  LATE_ENTRY flags only calls filled at the post. A copy keeps the source's split (`copiedExitPlan`, both Lab copy
  modals): TP2 without `exitPlan` grades TP1-only, a different trade (+2R vs +0.5R on TP1-then-stop).
- **Cards** read R:R from the levels (`callRR`), show a position only once the entry trades (`callLifecycle.mjs`,
  `AwaitingFill.tsx`), and show NOT GRADED for INVALID. `/feed` carries resolution rows: filter them before treating rows as calls.
- **One call, one wallet:** the Lab device cache is per wallet (`app/lib/labCache.mjs`); copies held by other wallets
  are marked `duplicateOf` (`callDedupe.mjs`, `CALL_DEDUPE_LIVE="true"`), only on proof (house id or the registry
  event's sender); nothing is deleted. Every board/feed/grader skips marked copies.
- **Registry event** is read by its layout (indexed id + address), never a guessed signature hash
  (`app/lib/registryEvent.mjs`). `GET /wallets/onchain` = incremental KV index over the public Arbitrum RPC; the Feed
  shows the count only when `backfilled:true`.
- **Registration:** `/proxy/thesis-register` checks levels/split/notes and simulates before Bankr, dedupes via
  `thesisreg:pending:*` + the NexusLock lease (409 `in_flight`, 503 `lock_unavailable`). `POST /theses/index {txHash,
  walletAddress}` (keyless) builds the call from calldata (`#SPLIT_50` declared on-chain in notes).
- **Reads:** `GET /theses/leaderboard` (≥5 graded, net-positive R; an empty board is correct when nobody qualifies:
  check `/theses/process/:wallet` before debugging), `/theses/status/:wallet`, `/verify/:wallet/:id` (the grader
  re-run), `/theses/ledger` (+ chain, anchored). Fill/TP1 alerts go out from the hourly pass.
- **Ranks:** only graded callers, in the grader's order, then emerging unranked. No self-scored REP anywhere; Rep Score
  code is deleted. Merit ranks (`rankCaller`): Signal / Sharp / Apex. Identity card = `app/lib/identityCard.mjs` on
  `loadIdentity`; no badge unless the grader gave one.
- **Public only:** share cards, permalinks and `/verify` answer `isPublicCall` (public, not holders-only, not a
  copy) → else 404. The call page's HTML meta comes from `GET /thesis/:w/:id/meta` (stored call, current stamps only).
- Orderly's trading API is private per account; the public dashboard indexer
  (`orderly-dashboard-query-service.orderly.network`) is not (Smart Money uses it).

## Signatures + auth
- **Lab signature** (`labSaveMessage`, `app/lib/labAuth.mjs`; EVM or Solana; valid 24h; body only, never stored, never
  in a URL) is required for: Lab writes + full read (`PUT /lab`, `DELETE /lab/.../thesis`, `PUT /profile`, `POST
  /lab/:a/read`), comments, reactions, takes, follows, notifications (read = `POST /notifications/:w`; GET 401),
  push subscribe/topics, the Telegram link, `/ops/revenue`. `socialAuth.mjs provenWallet`; client `useLabAuth` /
  `sendSigned`. `labAuthScope.test.mjs` fails if a new file accepts it or a use isn't named in the message. The Bankr
  skill's copy of the message must match word for word.
- Notification text names the author the server FINDS (`verifiedAuthor`) and the stored market/side, never the body's.
- **Trading signature** 'nexus-trading-key-v1' seeds agent keys: body only (`/positions`, `/balance` refuse it in a URL).
  Nothing stores a seed (`scrubStoredSeeds` removes old ones; a test fails if index.js writes `seed`).
  `/account-snapshot` is retired (410). `/proxy/register-key` stores only on `success === true` with the SIGNED key.
  It is a fixed message, so a wallet's signature never changes or expires: a leaked copy can't be rotated by
  re-signing. **Revoked wallets** = worker var `REVOKED_TRADING_WALLETS` (addresses, never the signature):
  `revokedTrading.mjs` refuses their signature in front of every route (403 `trading_signature_revoked`), and the
  Bankr register/deposit flows by `walletAddress`; withdrawals and `/balance` + `/positions` stay open. It doesn't stop
  the derived key at Orderly directly: withdraw, then `POST /proxy/bankr-remove-key {walletAddress, bankrApiKey}`
  (`routes-removekey.mjs`: Bankr signs as the owner, refuses `withdraw_first` while funds or positions remain, removes
  the key at Orderly signed by itself, confirms with the public key lookup; never returns the signature).
  Listed: `0xd9f7…b449` (until a new signing message is live).
- **Auth v2** (`docs/auth-v2-spec.md`, signed off 2026-10-27): random Orderly keys registered via `AddOrderlyKey` (30 days,
  one per wallet) + a 24h trading session that derives nothing. Built step by step; step 1 = `app/lib/tradingSession.mjs`
  (one message builder for client and worker) + `routes-session.mjs` (`checkTradingSession`; `POST /v2/session/end-all`
  ends every session issued before the caller's, the stamp `auth:sessions-after:{addr}` only moves forward). No live
  route accepts a session yet.
- **Telegram:** `POST /tg/link {wallet, labAuth}` → one-time code; `/start <address>` links nothing. Webhook secret
  derived from `TELEGRAM_TOKEN`; check `GET /tg/status` after a deploy.
- **Holders gate:** `GET /feed/holders` = signed challenge + on-chain `balanceOf ≥ OPERATOR_MIN`; `OPERATOR_MIN` must
  match the frontend OPERATOR tier (50M).
- **appkv (Bankr) is not private:** no credential of any kind goes there. Tracker plan = `docs/bankr-tracker-spec.md`
  (positions from public `/smart/xray`; orders refreshed on demand in chat). `/order-history` answers a refused Orderly
  read with 502 `orderly_error`, never an empty book.
- Never put a wallet key or signature in a routine or a scheduled task.

## Locks (KV has no compare-and-set)
- `NexusLock` Durable Object (`lock.mjs`, binding `NEXUS_LOCK`, migration `v1-nexus-lock`). `withLock` /
  `lockFor`; busy → `LockBusy`, unreachable → `LockError` (paid paths stop before money moves). Keys in `LOCK_KEYS`:
  payment-tx redeem, sim credits, sim daily cap, thesis registration, arena operators, hosted-AI counter.
- A new read-modify-write on money or a capped budget takes a lease. Tests run each race unlocked (both win) and
  locked (one wins) in `lock.test.mjs`.

## Leaderboard integrity
- Supabase `agent_trades`: RLS on, SELECT-only for anon; exec writes with `SUPABASE_SERVICE_KEY` (the only writer: if
  trades stop appearing, that secret is wrong; canary `supabase log failed`). `CREATE POLICY` doesn't enable RLS and
  policies are OR'd: verify, don't assume.
- Rows carry Orderly `entry_order_id` / `close_order_id`; "auditable insert REJECTED" in exec logs = investigate.
- `GET /agents/ledger` + chain, anchored on Arbitrum by `NexusLedgerAnchor` `0x57a698df84a44F3dA3dac3E08CA455a55A4eff84`
  (dedicated signer, `ANCHOR_PRIVATE_KEY`). The call-ledger hash has a fixed field list: changing it breaks the chain.

## Engagement surfaces
- `/agents/live` (uPnL from public marks; humans opt in via signed `POST /live/publish`, ~6-min TTL), Desks (score =
  members' graded calls via `computeCallerStats`), `LiveAlerts`, watch-only banner. Sparse at cold start by design.

## Phone alerts + Android
- **Android** = the live site in a Trusted Web Activity, `com.nexustradinglabs.nexus`, live on Google Play. Runbook
  `docs/android-app.md`. `public/.well-known/assetlinks.json` (3 fingerprints: Play signing, upload, dApp Store) —
  regenerate only via `tools/android/assetlinks.mjs`. Solana dApp Store listing in `marketing/solana-dapp-store/`.
- **Manifest:** edit `tools/manifest/manifest.mjs`, never `public/manifest.json` (regenerated on every deploy).
- **Web Push** (`webpush.mjs`, `push.mjs`, `routes-push.mjs`): on when secret `VAPID_PRIVATE_JWK` is set (make it ONCE:
  a new key breaks every device). Endpoint allowlist (SSRF). Subscribe/topics need `labAuth`. "On" = the server knows
  the device (`POST /push/status`). Pushes: graded calls, fills/TP1, agent opens/closes (lab-api `*/5` cron, which must
  RETURN before the hourly jobs). Service worker `public/push-sw.js`, scope `/push/`, no fetch handler, no cache.
- **XMTP device limit:** every browser/app that turned on messaging is an XMTP installation, capped per wallet. At the
  cap `Client.create` throws "…already registered N/M installations…"; `useXMTP` catches it (`app/lib/xmtpLimit.mjs`) and
  the Messages page offers REMOVE OLD DEVICES: one signature, `Client.revokeInstallations` without a client, keeps the 3
  newest, then enables here.
- The nav bell is `SignalsNavButton.tsx`. Before adding UI to a component, grep that something mounts it.

## Spot, swap, cross-chain
- **Orderly SDK has no spot.** In-app spot = routers + the user's signature.
- **$NEXUS** (Base `0x3D958634ab725B627919EF8F2Ed59227309fDba3`, Uniswap v4 pool with a vetted hook): no aggregator
  routes it; the honest buy path is the Uniswap deep link (`BuyNexusButton`). Liquidity depth is the real lever.
- **EVM swap = spanDEX** (`spotQuote.mjs`, `@spandex/core` 0.11.1 pinned): Nordstern always + 0x via `SafeZeroX` when
  `ZEROX_API_KEY` is set (key in a header). Fee `SPOT_FEE_BPS=10` → borst.eth, `feeApplied` only when the provider
  confirms it. The worker drops any quote that spends ≠ the asked amount, approves another token, or carries native
  value. Signing lives ONLY in `app/pages/token/swapExec.ts` (exact-amount approve against OUR USDC, value 0, chain
  check, receipt status). Fabric is dead (shut down 2026-09-16).
- **Flash (Definitive)**: ticket `FlashSpotButton.tsx`, orders `FlashOrders.tsx`, proxy routes whitelisted by
  `flashUpstream`. Every order signs the same `FlashOrder` (the trigger price is NOT signed). Guards: deadline per
  type, swapper = recipient = wallet, spend ≤ size + 1 unit, no permits, approvals capped by `approvalPlan` (open
  orders share one allowance), bracket approval sent and capped, balance check, stop triggers checked against FLASH's
  price. Fee `FLASH_FEE_BPS=10` on /quote and /order; builder code `FLASH_ATTRIBUTION_CODE` on /order only.
  **Check a settled order (read-only):** `GET /flash/settlement[/<orderId>]?funderAddress=0x…` (no id = the wallet's
  newest filled order; `routes-flashcheck.mjs`, rules `app/lib/flashSettlement.mjs`, ERC-8021 parse checked against ox).
  `fee` = our bps asked on the order AND paid per fill (`integratorFeeNotional` ÷ `notional`, ±1.5 bps or 1¢);
  `code` = our builder code at the END of each settlement tx's calldata (Base RPC). PASS / FAIL / PENDING / UNREAD /
  NOT_BASE; an unreadable tx is never a PASS.
- **Flash on Solana — guard core only, NOT wired to any screen (2026-10-28):** `app/lib/flashSvm.mjs` (tested on a real
  quote fixture). A Solana order = an SPL Approve to Flash's delegate (`FLASH_SVM_DELEGATE` pinned from a real quote) +
  an Ed25519 signature over `DFS|m=<mint>|t=<total>|h=<hash>`; the hash binds the user's OUTPUT account and needs OUR
  Definitive Solana trading group id (ask Definitive with our org id). No group = refuse (fail closed). Flash's default
  Solana approval is UNLIMITED (u64 max): request `forceMinimalAllowance`; prebuilt `setupTxs` / `sponsoredDelegateTx`
  are never signed. The ticket gets built once the group id is in and the first real quote's hash matches.
- **NEAR Intents 1Click** (`CrossChainCard.tsx`, `app/lib/nearIntents.mjs checkQuote`): verify the signature against
  the pinned key AND the signed request (our recipient/refund, pinned assets incl. canonical BTC
  `1cs_v1:btc:native:coin`, exact amount, ≤100 bps, no memo, deadline). Build the deposit tx from `XC_ASSETS`, never the
  response. Fee 10 bps asked (5 bps ours) → borst.eth's intents.near balance (recipient must be an EOA). Quotes go via
  `POST /xc/quote` with `ONE_CLICK_JWT`, falling back to direct.
- **Solana swap (Jupiter) — the ONE signer is `app/pages/token/solSwapExec.ts`**, BUY (SOL or USDC → token) and SELL
  (token → USDC), Jupiter via our `/swap/jup/*` proxy, RPC via our `/sol/rpc`. Pre-sign, on the exact bytes it signs
  (re-fetched fresh right before signing): quote bound to our mints + amount; slippage ≤ 300 bps and the quote's
  minimum respects it (`checkMinOut`); fee payer = the wallet; top-level programs allowlisted; simulation must
  succeed and, from simulated balances, SOL drop ≤ SOL input + 0.02 SOL, input-token accounts drop ≤ the typed amount
  (`checkSpend`, summed across all the wallet's accounts for that mint), the wallet's OWN output accounts gain ≥ the
  minimum (`checkReceive`; first-buy account derived under the mint's own program, classic SPL or Token-2022). Every
  read fails CLOSED (2026-10-27; the receive check used to fail open and USDC/sell spends weren't checked). Pure checks
  in `app/lib/solSwapGuards.mjs` (tested). The result screen shows ✓ only on an on-chain confirmation (`swapOutcome`);
  a timeout reads "Submitted, not confirmed yet · check Solscan". Dry-run any change on a real swap without signing:
  quote + swap for a public wallet, `simulateTransaction`, run the checks.
- **Our fee on Solana swaps** (`workers/nexus-lab-api/jupFee.mjs`, tested): Jupiter v1 `platformFeeBps` on /quote +
  our `feeAccount` on /swap, set by the worker only (browser values dropped). Jupiter takes no cut on v1 (V2 /order
  would keep 20% with a 50 bps floor; V2 enterprise needs a deal). Fee mint: USDC if either side is USDC, else wSOL.
  `JUP_FEE_BPS` (10) + `JUP_FEE_ACCOUNT_USDC` / `_WSOL` (token-account addresses) in wrangler.toml; an account must be
  an initialized token account of the right mint (RPC, cached 10 min) or that fee is off. `GET /swap/jup/fee-status`.
  Price reads pass `nofee=1`. Client refuses a quote with `platformFee.feeBps` > 100 and shows a "Nexus fee" row.
  Fee wallet `6uB2ugTM4m7P1BpEG6pLAc2B327nb75JUqVE6svoMRWT` (borst), USDC account `Fqqax7…wagKr` (never close it). wSOL
  account skipped for now (SOL buys carry no fee). `JUP_FEE_LIVE` != "true" = STAGED: only quotes tagged `feetest=1` carry
  the fee (dry runs); flip to "true" only on borst's word after a dry run.
  ⚠️ v1 ("Metis") is marked unmaintained by Jupiter; the successor for our path is V2 `/build` (same fee params).
- **Spot ledger** (`workers/nexus-lab-api/spotLedger.mjs`, tested; since 2026-10-28) → the "Spot" box on `/ops/revenue`
  (`spot` in its reply, last 30 days). Counts only what's proven: Flash = the proxy logs each accepted order id
  (`spot:flash:{id}`, with the funder only until booked) and the hourly job books final orders from Flash (one trade +
  fills' notional + our `integratorFeeNotional`, on the last fill's day); spanDEX / Jupiter / NEAR = the app calls
  `POST /spot/fill {route, id, chainId?}` (`app/lib/spotReport.ts`, fire-and-forget) after a confirmed trade and the
  worker books it only if the receipt is 0x1 / the signature is confirmed / 1Click says SUCCESS; WooFi = widget OPENS
  (the widget reports no fills). Each id once (`spot:fill:{route}:{id}`), day totals `spot:day:{YYYY-MM-DD}` under a
  NexusLock lease. No wallet address is stored.
- **Key proxies** (`keyProxy.mjs`): `/flash/*`, `/swap/jup/*`, `/xc/quote` accept only our origins + per-IP budgets.
- **Discovery** rules in `app/lib/spotDiscovery.mjs` (recent views, address search, real-market floors incl. padded/thin
  pools, safe logo hosts, read brief, callers line). No long/short split on callers until the board has a net-positive caller.
- Local live checks: Node's fetch ignores HTTPS_PROXY here; use `NODE_USE_ENV_PROXY=1`.

## x402 patterns
- **Q Signals (client pays, `app/pages/lab/qpay.ts`):** Quotient 403s datacenter IPs, so the browser calls it directly;
  never build a worker relay. x402 v2 wire: challenge in the `payment-required` header, EIP-3009 typed data, retry with
  `PAYMENT-SIGNATURE` (not `X-PAYMENT`), UTF-8-safe base64. Guards pinned to Base USDC + Quotient's payTo, cap $0.05.
  PRO-gated, explicit load, 15-min cache. Shaper `qshape.ts` mirrors lab-api `quotientSignals`.
- **MiroShark sims (server pays, `payGuards.mjs`):** our hot wallet signs ONLY Base USDC "exact" to MiroShark's pinned
  receiver for ≤ the credit price; anything else fails closed and refunds. One payment tx buys one product. Credit + cap
  are taken under the lock before paying. Don't delete the pin to "fix" a run.

## Orderly data limits
- **10 req/s per IP** on public endpoints (shared Cloudflare egress). Fan-outs use `mapLimit` (≤3 in flight, ≥250 ms
  apart); reads use `orderlyGet` (retries 429 + HTML challenge with backoff, logs, throws `OrderlyError`). Brain and exec
  use the same helper. Never a bare `Promise.all` over markets.
- **No 4H candles** (`/tv/history` 240 = `no_data`): build them from 1H with `app/lib/fourHourBars.mjs`.
- Challenge bursts: `/intel/mispriced` serves its last good board ≤2h old as `stale:true` from its own key
  (`intel:mispriced:lastgood`); don't lengthen `intel:mispriced:v1` (house calls use it as the entry).

## Wallet X-Ray (`/analyze`, rules in `app/lib/xrayGrade.mjs`)
- Windows 24H/7D/30D/ALL with minimums 5/10/20/20 (else ACCRUING). Every COPY goes through `edgeGate` (30D net > 0 and
  PF > 1, or a ≥20-day watched record; any negative graded evidence vetoes). Never estimate Orderly leverage/liq.
- Hyperliquid: read every perp dex (`perpDexs`), and HL serves only the latest 10k fills, so we collect forward
  (`GET /xray/hltape`, `hlTape.mjs`; gaps disclosed via `completeFrom`). Share card + copilot use the same grade.

## Token + tokenomics
- $NEXUS = a meme token with cosmetic/access perks only (tiers OPERATOR 50M / ARCHITECT 100M / ORACLE 250M,
  `useNexusTier.ts`). Holders-only theses stay out of `/feed`.
- Treasury: discretionary buys, held not burned, disclosed after the fact (`docs/treasury-buyback-policy.md`). No
  automated or marketed fee→buyback→burn, no revenue share/yield. Keep a strong free tier. Seasons plan in
  `docs/nexus-seasons.md`.

## Farcaster mini app — PARKED
`/mini` is parked (borst): don't work on it, audit it or pitch it until he says so. History has its gotchas (manifest
limits, EIP-712 verifyingContract: registration = the all-C sentinel, withdraw = `0x6F7a…D203` in the body).

## Perp page (SDK widgets)
- `TradingPage`/`MarketsHomePage` are black boxes: only their props. `disableFeatures={["orderBook"]}` (string literal;
  `key` the page on toggle). Restyle scaffold regions via `classNames={{…}}` + CSS with `!important`.
- PnL posters (`public/pnl/poster_bg_*.png`): keep the left side dark/empty (Orderly overlays text + QR there).

## Testing + checks
- `node tools/run-tests.mjs` (= `yarn test`) runs every `*.test.mjs` under app/ tools/ workers/ and gates PRs and the
  deploy. Worker tests need `npm ci` in nexus-lab-api, nexus-agent-exec, nexus-carry-engine. Don't hand-roll a `find`
  (it picks up vendored node_modules tests).
- PR checks: `tsc --noEmit` (keep it at 0), lint (`tools/check-lint.mjs`, baseline 0: clickable divs use `role` +
  `tabIndex` + `pressKey()`, modals `useEscapeKey()`, caught errors `errText(e)`, ’ not ' in JSX copy), palette
  (`tools/check-palette.mjs`), text contrast (`tools/check-ink.mjs`), button style (`tools/check-ui.mjs`).
- Pure logic lives in `.mjs` modules the workers import, so tests cover deployed code. **Tests never touch the real
  network**: inject fetch.
- New app route = two lines in `public/_redirects` (`appRoutes.test.mjs`); unknown paths 404 via `404.html`; the call
  permalink Function fails open on anything but a 404.
- `git add` new files and check `git status` before trusting a local build (CI builds a clean checkout).

## Build + mobile load
- Minified build; `vendorChunk()` puts the entry's static node_modules graph in one `vendor` chunk (never a catch-all
  node_modules rule). `public/_headers` `/assets/*` needs `! Cache-Control`.
- `firstLoadTrims()` (vite.config.ts): sha256-only crypto shim, lodash-es for two importers, Amplitude autocapture
  stand-in (top-level client only). Importer allowlists, guarded by `tools/firstLoadTrims.test.mjs`. What's left is
  Orderly's SDK tree: no free trims remain.
- `amplitudeOptOut()` turns Orderly's Amplitude default tracking + IP off at build; the build fails if the SDK's init
  changes (`tools/amplitudeOptOut.test.mjs`).
- In cloud sessions don't `pkill` servers (it kills your shell). A build takes ~3 min and ~7 GB.

## Conventions
- **Browser-first triage:** borst uses Brave. Before investigating "an embed/preview/wallet popup/fetch doesn't work",
  have him retry with Shields down or in clean Chrome, and check the server side (logs/curl). If the server served it,
  it's the client.
- **Mobile:** inline styles, so no media queries. Fixed-pixel `gridTemplateColumns` are the recurring clip: stack on
  mobile, or scroll dense rows (`overflowX:auto` + `minWidth`), or `flexShrink:0` columns. `useIsMobile()` is per
  component (a missing call white-screens the tab). Calendar cells use a fixed height.
- **Commits** end with the attribution lines the harness reminder supplies (name the model that did the work; never
  hard-code one here). No model ids in commits, PRs or code.
- **Merge your own green PR** on `StephenBorst/nexus` once CI is green on the head and it's mergeable. Hold and tell
  borst on: red/pending CI, a conflict, an unanswered review, a failing Claude Approvals check, a PR that isn't yours or
  is on another repo (BankrBot/skills, nexus-landing), a `Pipeline watch:` PR, or anything that arms live money. After
  a merge, check the deploy run started.
- **Bankr skill:** published at `BankrBot/skills` → `nexus-trading-labs/`; our fork `StephenBorst/skills`. Change it in
  BankrBot first (PR from the fork), then copy the folder back here byte for byte; never copy this folder over theirs
  without diffing. "Signer rejected it" = Bankr's wallet, not our code (test with a trivial sign).
- borst's local env is Windows PowerShell (use `;`, no `&&`).
- Before building on a component, grep that something imports it.

## Brand + voice (read `docs/brand.md` and `marketing/VOICE.md` before any brand-facing work)
- Tokens in `app/config/theme.ts` (`C`), mirrored by the landing `:root`; share cards read `app/lib/brand.mjs`.
- Black surfaces, bone type, **bone `#ededf0` is the accent mark** (card top rule, active nav/tab, PREDICTIVE chip).
  Don't re-open the accent. **Green/red = money and price only.** Amber `SIGNAL.watch` = caution; `C.warn` = danger.
  A new colour gets a named job in theme.ts or isn't used. Not neon green.
- Ink ladder: bone → fog `#a1a1aa` → muted `#71717a` → faint `#52525b`; never text in a border tone.
- Type: IBM Plex Mono, Manrope, Libre Baskerville. Atmosphere = silk light (gradients only, transform/opacity motion,
  reduced-motion still, text off the hairline).
- Voice: a terminal that speaks. Short end-stopped lines, fact → rule → action, numbers over adjectives, no hype, no
  emoji in brand copy. Verifiability stated calmly, once. Never "proven" unless the scoreboard says so.
- Share previews render from `tools/brand/previews.html`; bump the image `?v=` after a change (X caches by URL).
  `ogCards.test.mjs` enforces card colours.

## Settled — don't re-raise
- Cold start / feed liveness is behind us. In-app EVM buy/sell is live and tested. The mini app is parked.
- Focus = the engine and its signals. The engine has no proven edge yet: that's the #1 risk, and the failure mode is
  copy shipping ahead of the grade.
- The Oct-15 engine freeze is over. Engine work happens when borst asks for it.
- Positioning: the trading terminal that grades itself in public. The DEX is the commodity; the Lab, the grading and
  the social graph are the moat.
