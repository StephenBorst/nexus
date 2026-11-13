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
  /config, bankr/activate), DCA (402 `pro_dca_locked`), operator delta-cap + callbacks (402 `pro_operator_locked`),
  webhooks, backtest/sweep/validate, hosted AI. Core modes stay free.
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
- **nexus-lab-api** (`workers/nexus-lab-api`) → `og.nexustradinglabs.com` = `AGENT_API`. Crons: `17 * * * *` hourly jobs,
  `0 */12`, and `* * * * *` = the minute grader + (every 5th minute) agent push alerts; it returns before the hourly jobs. Its `*.workers.dev` is NOT
  routed (404/1042): always use the custom domain. `GET /agent/:a` returns `state` wholesale.
- **nexus-agent-exec**: 1-min cron, enters/monitors/closes. Stamps `ops:exec:heartbeat`; `GET /health`.
- **nexus-agent-brain**: 5-min cron, writes `agent:signal:{addr}` and the hourly history series. Its price/OI delta is
  measured from `market:prev:{symbol}` only when that snapshot is ≤ 12 min old (`prevSnapshotUsable`, shared rule
  `app/lib/marketSnapshot.mjs`; lab-api's `/signals` rows and trend-regime OI use it too, rows carry `delta_fresh`);
  candles are fetched only when the last closed bar is missing (`candleFetchDue`); the heartbeat stamps completed runs only.
- **nexus-carry-engine**: sector-neutral funding-carry basket. Hourly = PAPER record; `*/5` = LIVE maker re-quote, a
  no-op unless `CARRY_LIVE=true`. KV `CARRY` = `b34f3af62cfe4bc2b5d03ce9c7b55868`. Reached on
  `https://nexus-carry-engine.stephenpatrick24.workers.dev` (`CARRY_API` in `app/pages/proof/CarrySleeve.tsx` and
  `app/config/assistantTools.ts`); no custom domain exists, don't "fix" it. **Live path is built, deployed DISARMED,
  owner-only:** don't set `CARRY_LIVE` or add key secrets. Guardrails: no key / `carry:kill` / unbalanced plan ⇒ no-op,
  per-order cap, POST_ONLY. Maker execution is mandatory (taker fees ≈ breakeven). Ops routes need header
  `x-carry-token` = secret `CARRY_ADMIN_TOKEN` (≥16 chars), FAIL CLOSED: no secret = 401 for everyone (`carryAuth.mjs`;
  it used to let everyone in, 2026-11-09). `carryBasket.mjs` is shared with `tools/backtest/relvalue4.mjs`. Read `README.md` before touching it.
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
- **Live-entry pause (owner, platform-wide):** `ops:halt:live` in `NEXUS_AGENT`, switched on `/ops/revenue`
  (`POST /ops/halt`, `routes-halt.mjs`; its own 5-min EVM signature from a Safe owner / `OPS_WALLETS`, replay-guarded
  by `ops:halt:log`; public `GET /ops/halt`). exec reads it once per tick (`app/lib/liveHalt.mjs`; unreadable = halted)
  and skips every non-PAPER entry right before `enterPosition`. Exits, kill, DCA ladders, PAPER and parity untouched;
  closes nothing. No auto thresholds: a breaker rule is a read, graded first.
- **Controls:** ASSISTED = pause entries, still manages. DEACTIVATE = stop + delete key, position left open (no stop/TP:
  the Lab confirms first via `app/lib/agentControls.mjs`; `DELETE /agent/:a` returns `leftOpen` + `warning` for a live one). KILL =
  close + delete key + deactivate. The agent must be flat before you trade manually on the same account.
- **Kill order** (`nexus-agent-exec/killSwitch.mjs`, lab-api `routes-kill.mjs`, fixed 2026-11-06): the route only sets
  `agent:kill:{addr}` (and puts the wallet back on `agent:users`); it never deletes the key or the list entry. Exec closes
  WITH the key, then stops + deletes it. An unconfirmed close keeps flag + key and retries each tick; after
  `KILL_MAX_ATTEMPTS` (10) it stops anyway, keeps the record and Telegrams the owner to close by hand.
- **Tick order** (`processUser`, pinned by `nexus-agent-exec/tickOrder.test.mjs`): kill → active/config → webhook CLOSE →
  manage the open position → adopt a ghost → daily caps → entries. **Daily caps gate entries only** (fixed 2026-11-06:
  the cap check used to run first, so the day's last allowed trade went unmanaged until the 24h reset).
- **Reconcile:** exec reads the live position first; exchange flat ⇒ clear the stale record. On a read error it manages
  on cached data, never clears. An Orderly ERROR answer (`success:false`: rate limit, expired/removed key) is a read error,
  never "flat" (`exchangePositionQty` / `exchangePositionRows`, exec `logic.mjs`; fixed 2026-11-06).
- **Modes** (`deriveSignal`, brain `logic.mjs`): CONFLUENCE, FUNDING_ONLY, OI_ONLY, BASIS_FADE (free); MOMENTUM,
  MEAN_REVERSION (PRO). **LEVEL_RECLAIM = ON for PAPER only** (built off 2026-11-04; on 2026-11-05 when level_reclaim
  was served TRADEABLE): the registered read via the SHARED rule `app/lib/levelReclaim.mjs` (the grader's
  `levelReclaimEvents` moved there unchanged; explorerReads re-exports it), computed by the brain behind worker var
  `LEVEL_RECLAIM_LIVE = "true"` (brain wrangler.toml) and only for PAPER configs (`levelReclaimRefusal`); fires in the
  hour after an event, `sourceT` = the event time. **Loaded only by the hidden link `/lab?tab=agent&deploy=level-reclaim-paper`**
  (borst: a FRESH wallet, owner-only) with `LEVEL_RECLAIM_PAPER_CONFIG` (graded exit, 11 main-card coins, no filters, wide
  caps). No mode button, no Strategy Library preset, no /proof Load until its wallet has 30 paper trades with parity
  CLEAN, judged after fees (`/paper-costs`), tested. Parity: `levelReclaim.test.mjs` (hour by hour), `/agent/:a/parity`. **OI_DIV_4H = ON for PAPER only**
  (2026-11-13, oi_div_reversal_4h served TRADEABLE that day, #299): same pattern. Shared rule `app/lib/oiDivReversal.mjs`
  (the grader's `oiDivReversalEvents` + `oiDivReversal4hEvents` moved there unchanged; explorerReads re-exports them),
  computed by the brain on `oi:hist` behind `OI_DIV_4H_LIVE = "true"`, PAPER only (`oiDiv4hRefusal`, no live lift);
  fires in the hour after its row, `sourceT` = the row time. Hidden link `/lab?tab=agent&deploy=oi-div-4h-paper`
  (`OI_DIV_4H_PAPER_CONFIG`, a FRESH wallet); its paper wallet is recorded on the registration (`paperWallet`, readPipeline.mjs),
  which moves the served stage → PAPER. Parity: `oiDivReversal.test.mjs`. ~0.4 s brain CPU per tick for
  the 11 coins while that wallet is flat (full-history re-run, the same as the grader). Thresholds and risk params are read live each cycle. **An empty `config.symbols` = the brain
  evaluates nothing** (no "all" default).
- **Exits** (`evaluateExit`, exec `logic.mjs`): SL → TIMEOUT → trail before TP; `takeProfits` ladder OVERRIDES
  `tpPercent` (`normTakeProfits`); DCA has its own monitor path. Exit vocabulary: `SL · TIMEOUT · TRAIL · BE · TP ·
  TP_PARTIAL · KILLED · WEBHOOK_CLOSE` (no "signal flip").
- **Exchange-side backstop stop** (`nexus-agent-exec/backstop.mjs`, 2026-11-07; live plan §5 item 2): each LIVE
  single-entry position also rests a reduce-only Orderly position stop (`POSITIONAL_TP_SL`, STOP_LOSS child,
  CLOSE_POSITION, mark trigger, built as the SDK builds it) at 1.5× its stop distance beyond the entry, snapped away
  from the entry. It only catches a stalled worker; exec's own stop closes first. Placed right after the fill
  (`ensureBackstop`; retried each tick up to 5×, then Telegram), cancelled once exec's close is confirmed
  (`cancelBackstop`; a failed cancel queues in `state.backstop_cleanup`, swept before the next live entry, which is
  refused on a market that still carries one; 10 tries then Telegram). Exchange flat + the order fired = Telegram, NOT
  booked to `agent_trades` (no fill read). Not on DCA positions or paper; the trail/BE don't move it. DEACTIVATE leaves
  it resting with the position (the Lab + DELETE reply name it: `agentControls.mjs restingStop`, one copy for both).
  Orderly keeps ONE position TP/SL per market + side: a refused place reads the market's working one
  (`restingBackstop`, the SDK's match) and adopts ours by its exact trigger (a reply lost to a timeout); any other
  is the owner's (`backstop.foreign`): never a second one, never cancelled by exec. KILL retries the queued cancels
  with the key before deleting it (`io.sweep`), and Telegrams any still resting (fixed 2026-11-08).
- **Graded-exit contract** (`exitContract:"R_CONTRACT"`, `app/lib/gradedExit.mjs`): stop 1.2× H4 ATR-14, target 1.5×,
  168h. **PAPER ONLY**: `gradedExitRefusal` refuses non-PAPER configs and extra exit parts (exec at the top of
  `enterPosition`; lab-api 409 `graded_exit_refused`). **One-wallet live lift, BUILT DISARMED** (`app/lib/liveLift.mjs`,
  2026-11-08, build #3 of the live plan): worker var `GRADED_EXIT_LIVE_LIFT` ("0xWALLET@LEVEL_RECLAIM") is EMPTY in
  lab-api, exec and brain wrangler.toml (`liveLift.test.mjs` fails otherwise); a listed wallet is lifted only for the
  plan's exact config (`livePlanRefusal` / `LIVE_PLAN_LIMITS`: fixed-risk ≤ $10, 3×, margin ≤ $300, ≤ $30/day, ≤ 4/day,
  168h, main coins, no invert/ungraded gate). It passes `{ liveLift }` to `gradedExitRefusal`, `riskSizingRefusal` and
  `levelReclaimRefusal` (brain `deriveSignal` 5th arg); the Lab never decides it. A lifted wallet opens only the brain's
  read on a plan coin (`liftedSignalRefusal`, exec, before any read): no webhook, directive (its own size) or autocopy
  entry; autocopy on the config un-lifts it (2026-11-08). Arming = borst in person, its own PR.
- **Webhook (PRO):** `POST /agent/hook/:token` → `agent:webhook_signal:{addr}` (600s). **Strategy library:**
  `/agent/:a/strategies` + `/publish`; public board ranks by the author's GRADED record, never backtest.
- **Operator fields (PRO · same ARCHITECT/100M gate as momentum/mean-rev/DCA; all opt-in, default-OFF):**
  `config.maxPortfolioDeltaUsd` — exec sums signed notional across the account's live positions before any entry
  (`portfolioDeltaCheck`, exec `logic.mjs`) and REJECTS one that grows net directional exposure past the cap (a
  reducing trade always passes; LIVE reads `/v1/positions`, PAPER its own book; fail-OPEN only on a null read).
  `config.callbackUrl` (https) + `config.webhookSecret` (≥16c) → exec POSTs an HMAC-SHA256-signed body
  (`X-Nexus-Signature: sha256=…` + `X-Nexus-Event`) on ENTRY/DCA_ADD/PARTIAL_TP/CLOSE (CLOSE carries reason+pnl),
  within-tick + 1 retry, best-effort (`fireCallback`/`buildCallbackPayload`, exec; never blocks the trade lifecycle).
  Shape + PRO gate = `validateOperatorConfig` (lab-api `logic.mjs`) on all 3 config-write paths → 400 bad shape /
  402 `pro_operator_locked`. Surfaced in AgentView's OPERATOR card + the Bankr skill (`docs/SKILL.md`).
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
  Leftovers = DRIFT. The window starts where the record began (`parityWindowStart`: the later of `started_at`,
  stamped when activation creates the state, and `paper_reset_at`; a full 50-row ledger starts at its oldest row). A second entry on one read opened before exec's one-entry-per-read fix went live
  (`ONE_ENTRY_PER_READ_LIVE_MS`, 2026-10-30T17:14:41Z) is listed as explained (`PRE_FIX_REENTRY`); after it = DRIFT.
  Before calling DRIFT a brain bug, check the open position. **Known DRIFT cause (2026-10-29,
  `docs/research/price-spine-drift-2026-10-29.md`):** `priceByHour` rounds `oi:hist` rows to the nearest hour and the
  LAST row wins, so a row written minutes after the agent acted can rewrite that hour's price for the grader (Oct 28
  ETH LONG on all three wallets). Fixed 2026-10-30: the FIRST row in an hour wins, and the brain writes one `oi:hist`
  row per hour at the top of the hour (`oiSnapshotDue`, minute < 30). Both logged under "Measurement changes" in
  `docs/research/read-pipeline.md`.
- **One entry per read:** basis signals carry `sourceT` (the basis row's time, brain `signalSourceT`); exec takes a given
  symbol + side + `sourceT` once (`brainSignalKey`/`alreadyTradedSignal`, state `last_signal_key`). The 15-min cooldown
  counts from the exit as well as the entry (`closePosition` stamps `last_trade_time`).
- **Paper wallets:** graded-exit wallet `0x9A3012988d60D61b34660BE06a321F7BF7bCcB28` · 24h arm
  `0xa77ca113f39405b50617c2cc9ba5d6e3ced4a9a7` · nine-market 24h `0x325Da3ed024f533764407524918a847bCb3f95DE` · level_reclaim paper (fresh,
  2026-11-05, the hidden link) `0x95e26E980e300C34360933b849457F42c6Bd7622` · oi_div_reversal_4h paper (fresh, 2026-11-13
  19:35 UTC, the hidden link) `0xd446acE5934a0A337A9ee5F0D8ad37FdF8a1e2CD`.
- **Paper tape check** (borst 2026-11-13, `docs/research/paper-tape.md`): every paper fill (entry + exit) is checked
  against Orderly's public 1-minute bar for its minute or the one before (`app/lib/paperTape.mjs`: ON_TAPE / NEAR ≤
  `TAPE_TOL_BPS` 10 / OFF / NO_TRADES / NO_DATA / AVERAGED for a DCA blended entry, `entry_avg` on paper rows / PENDING).
  Checker = lab-api `paperTape.mjs`, hourly at :41 on the minute cron: READS agent state, writes only `ptape:{wallet}` in
  LAB_STORE (the bar + its public source per fill, final). Served at `GET /agent/:a/tape`, on `/proof/paper/:axis`
  (Tape column + line, `paperRun(axis, state, tape)`) and Arena rows (`tape`, summed per operator). Paper exits stay
  market exits at the mark (no wick fills); this only proves the price was real. **Trigger check:** an SL/TP row with
  its level (`sl_percent` / `tp_percent`, exec stamps both, record only, pinned) also gets TRADED or MARK_ONLY (the exit
  fired on the mark, no trade reached the level). A fill > 3 days old Orderly refused on 3 runs = NO_DATA + reason.
- **30-trade paper judgment** (borst 2026-11-13, `docs/research/paper-judgment-level-reclaim.md`, signed; text above
  Results sha256-pinned): `app/lib/paperJudge.mjs` (`PAPER_JUDGMENTS`, `judgePaperRun`) judges the FIRST 30 closed trades
  from the record start: per trade net bps = move − 2.5 bps taker each side (frozen) − funding paid; mean (unrounded) > 0
  = PASS, ≤ 0 = FAIL. Prices from the tape: OFF = the worse of the paper price and the bar's nearest traded edge;
  NO_DATA/NO_TRADES = paper price, counted; PENDING waits. Parity (`paperParity`) over record start → 30th ENTRY + 10 min,
  read once settled: DRIFT/UNVERIFIABLE = HELD. A paper reset after signing = RESET (final). lab-api `paperJudge.mjs`
  hourly at :47 records PASS/FAIL/RESET ONCE in LAB_STORE `pjudge:{axis}` (the 30 trades as judged), never rewritten;
  `GET /signals/paper-judge/:axis`; the paper run page's verdict block. Licenses nothing automatic. **oi_div_reversal_4h** has the same rules
  (`paper-judgment-oi-div-reversal-4h.md`, drafted 2026-11-13 at 0 trades, a word-for-word copy, test-checked) with
  signed by borst 2026-11-13 (recorded under its Results; `signature: "signed"`). A new page starts `"pending"`: no PASS/FAIL
  is final until it is signed. Events for parity come
  from `parityEvents.mjs` (one copy with `GET /agent/:a/parity`).
- **Live fills on the tape + $10 preflight** (borst 2026-11-13): the tape checker also checks each exchange-confirmed live
  fill in `state.live_slip` (`liveLegs`, keys `l:{order_id}`, kind `live_<kind>`), counted APART from paper
  (`tapeView().live`, `liveTapeLine`). `GET /agent/:a/preflight` (`routes-preflight.mjs`, rule `app/lib/livePreflight.mjs`,
  public, read-only, never asks Orderly) = the house rules' step-0 test line by line: exec heartbeat, `ops:halt:live`, a
  pending kill, mode + key stored (yes/no), the lift (FAIL only for a live graded-exit config not listed / not the plan's;
  INFO otherwise), the backstop exec RECORDED (1.5× the stop, snapped away; see it on Orderly too), queued cancels, live
  fills on the tape, slippage. Page `/ops/preflight?wallet=` (noindex, not in the nav, re-reads every 15 s).
- lab-api needs `SUPABASE_URL` / `SUPABASE_ANON_KEY` for History reads.
- `test-signal` and the Force button are DEV/PAPER-only. Feed bridge: `PUBLISH_AGENT_FEED=true` (real trades only).
- Multi-strategy concurrency = one Orderly sub-account per strategy, after a proven edge (deferred).
- Bankr chat-deploy: `POST /agent/:a/bankr/activate|mode` (spec `docs/bankr-agent-spec.md`). Deposits go to the
  trading balance only; OmniVault is not available to external brokers, don't chase it.

## Backtest + replay (`workers/nexus-lab-api/backtest.mjs`)
- ONE engine: imports the deployed `deriveSignal` + `evaluateExit`/`computePnl`; `stepExit` and `entryAt` are shared by
  the per-market replay, the portfolio replay and the random baseline. `tools/backtest` imports it too.
- **Fills** (`stepExit`, measurement change 2026-10-31, `backtest.fill.test.mjs`): each exit fills at its own level
  (stop, target, trail, BE, TP slice); a bar that opens past it fills at the open (a gap); TIMEOUT closes at its bar's
  open. Never at the hour's extreme (the live exec closes at the market within a minute). Logged in `read-pipeline.md`.
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
- **CPU budget:** the scoreboard's cold rebuild (hourly) runs each generator several times and sits near the Worker CPU
  limit (error 1102 seen 2026-11-08 right after batch 4). A new read's generator must slide its windows (O(n·window)),
  never re-scan from the start or redo per-coin work that doesn't depend on the coin; time it on the public series
  before registering. A faster body must fire identical events (kept-reference test, as for btc_lead_lag /
  funding_basis_split in explorerReads.test.mjs).
- **Built on a schedule, not in a request (2026-11-13, `scoreboardCache.mjs`):** the minute cron rebuilds the min-20 board at
  `SCOREBOARD_REBUILD_MINUTE` (:53) via `buildAxisScorecard(env, min)` (index.js; the route's old body moved unchanged) and
  stores it for 2h + a 24h last-good copy. A request serves the stored copy, builds only when none exists, and serves the
  last good one marked `stale` if that build fails (503 `scoreboard_unavailable` only with nothing stored). Check
  `[scoreboard] rebuilt in N ms` in the lab-api logs.
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
  `spotcvd:hist` (spot-book CVD, same fold as `cvd:hist`, from 2026-11-05) is read ONLY by the registered `spot_absorb`
  (loaded into each scoreboard coin set as `spotCvdHist`; emptied for holdout coins on the main card like basis/CVD).
- **One rule, two users:** traded and graded rules live once in `app/lib/` (`basisFade.mjs`, `basisStack.mjs`,
  `gradedExit.mjs`, `funding.mjs`) and both the brain and the grader import them. Parity tests prove live gate ==
  graded read hour by hour. Same-hour semantics: the LAST row in an hour with a side wins (`sideAtHour`); the price
  spine (`priceByHour`) keeps the FIRST row in an hour. Coalesce
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
  confluence_follow (from 2026-10-17); oi_div_reversal_4h and oi_coil_break (from 2026-10-28, their own prereg pages); batch 3
  (borst's go 2026-11-06, own prereg pages): `session_fade` (session_momentum's event traded the other way, a NEW read) and
  `level_reclaim_tight` (level_reclaim only when its H4 ATR ranks ≤ its own 30-day median) from 2026-11-08, `spot_absorb`
  (perp-led 4h move, spot the other way, OI flat → follow spot) from 2026-11-20; batch 4 (borst 2026-11-07):
  `btc_lead_lag` (BTC 1h move ≥ its own 30-day p90, an alt that moved < 0.75 of it follows BTC) from 2026-11-08, the
  first read on another coin's tape: the holdout line gets the main card's BTC set as CONTEXT only (`ctxSets` in
  axisbt `buildEvents`, never graded) and `funding_basis_split` (funding ≥ its 30-day p80 while the basis sits ≤ its
  30-day median → SHORT, mirror → LONG; 9 main coins, ARB/WLD have no basis) from 2026-11-08. Registered
  bodies live in `explorerReads.mjs`; unregistered drafts in `explorerDraftsB.mjs` (batch 2, `explorer-drafts-b.md`; tests
  fail if a draft is graded or axisbt imports it) and `explorerDrafts4.mjs` (batch 4, `explorer-drafts-4.md`: settled, A + D
  registered, B funding_settle_snap + C level_reclaim_weekly DROPPED; generators get axisbt's `ctx.btcCandles`;
  `powerCheck.mjs --batch=4`). `GET /agent/basis-history/:coin` = read-only basis:hist. A new registration also adds its read to `pipeline-stages.json`.
- **Retired:** the Basis × CVD graded exit (2026-10-26, `RETIRED_GRADED_EXITS` in proofCopy.mjs), final.
- **Regime window** (`docs/research/graded-exit-regime-prereg.md`, signed 2026-10-26; counts from 2026-10-27T00:00Z,
  limit 2027-04-27): the same read + graded exit, judged once by the watcher via `judgeRegimeWindow`
  (`app/lib/regimeWindow.mjs`, numbers pinned to the page). The scoreboard serves `axes[basis_x_cvd].regimeWindow` (main
  + holdout) and the BTC day counts (`regimeWindow.regime`, Orderly daily candles). `REGIME_RESULT` is set once by the
  judging watcher PR and is final.
- **Stress-hour study** (`docs/research/stress-hours-prereg.md`, signed 2026-10-30; counts from 2026-10-31T00:00Z,
  limit 2027-04-30): a conditioner, not a read. Stress hour = ≥5 of the 9 main coins OI −2%/4h AND the board's median
  4h move ≥ its 30-day p90 (`workers/nexus-lab-api/stressHours.mjs`, pinned). Grades the seven reads registered at
  signing STRESS vs CALM (time-shift null, Holm, 30/30). WORSE_IN_STRESS licenses one reviewed per-read pause PR,
  nothing automatic. Brain/exec never import it. Judge = `stressGrading.mjs` (pure, R in from axisbt `gradeEventR`):
  judging time = 30/30 cutoff + 168h (or the limit), so any re-run gives the same p; shifts ≥7d both ways
  (mulberry32, golden-pinned); empty-side shifts left out (`validShifts`); interim Holm: p ≤ α/7 in, p > α out, else
  PENDING_HOLM. borst's rulings (2026-11-04, under the page's Results): significantly lower but STRESS mean R ≥ 0 =
  `LOWER_STILL_POSITIVE` ("lower in stress, still positive", licenses nothing; `licensesPause` only on WORSE); ≥20
  STRESS but <30 CALM at the limit = judged as it stands. Served live as `stressStudy` on `/intel/axis-backtest`
  (`stressStudy.mjs`, 2026-11-04): events + R from axisbt `eventsWithR` (the builder `scoreEvents` uses; a no-touch
  event is pending until its 168h window is recorded, never a 0). Recording a verdict under Results = its own PR.
- **Pre-registered studies are append-only:** a doc's text above Results is pinned (sha256 tests); verdicts are appended;
  a new idea found on a closed population is a new dated registration (e.g. structure × house fade: CLOSED, not shown).
- **level_reclaim exit gap** (`docs/research/level-reclaim-exit-gap.md`, signed 2026-10-31): the read grades +R while its
  graded exit loses; `tools/explorers/exitBridge.mjs` bridges the two on the same trades (read-only, reconciles with the
  served `netBps`). The first pull found the as-traded walker filling exits at the hour's extreme (S3b −23.9 bps); fixed
  2026-10-31 as a measurement change (below), S3b now 0. At 30 trades (2026-11-03) the cause is H2, stop-width
  weighting: narrow stops +0.50R/+63 bps, wide −0.06R/−60 bps. Recommendation on the page: keep the bps money bar.
- **Daily pipeline watcher** (prompt `docs/routines/pipeline-watch.md`, `tools/pipeline/watch.mjs`,
  `app/lib/pipelineWatch.mjs`): compares served stages with `docs/research/pipeline-stages.json`; a change opens a PR on
  `pipeline-watch/<date>`. It also watches `stressStudy`: a read's verdict turning FINAL is the change (`STRESS_TRIGGERS`; record a
  dated line under the stress page's Results; WORSE's pause PR stays borst's), a recorded final verdict is terminal.
  **The watcher merges its own `Pipeline watch:` PR** (borst's go, 2026-11-02) only when checks are green, it is mergeable, the change is display/record only, no parity DRIFT and nothing arms live money; any other session leaves watcher PRs alone. A scheduled task stores its own copy of the
  prompt: after editing the doc, update the task (`update_trigger`).
- **Live money** = `docs/research/live-money-review.md` (the checklist) + `docs/research/live-plan-level-reclaim.md` (the
  first concrete plan, DRAFT, unsigned, arms nothing; written 2026-11-07 before the paper gate): $1,000 dedicated wallet,
  fixed $10 risk a trade (1R) sized from the graded stop, 3×, $30/day, kill at −10R, 10-trade first tranche vs the paper
  wallet. Needs built first, each its own PR: `riskPerTradeUsd` sizing (BUILT 2026-11-07, PAPER only, below), an
  exchange-side backstop stop (BUILT 2026-11-07, #268), a one-wallet lift of `gradedExitRefusal` (BUILT DISARMED
  2026-11-08, `liveLift.mjs`). **House rules**
  (live-money-review.md, SIGNED by borst 2026-11-08; a change = a new dated section) bind every plan: a $10 mechanics test first (backstop shows, KILL clears it;
  plumbing, not edge), 1R = 1% of a dedicated account, 3R/day, −5R/7d pause, kill at −10R or equity < 90% of deposit,
  parity CLEAN, size ×2 at most after 30 live trades meeting the bar. Arming and size increases = borst, in person.
- **Fixed-risk sizing** (`config.riskPerTradeUsd`, `app/lib/riskSizing.mjs`): notional = risk ÷ the trade's own graded
  stop %, so P&L ÷ risk = R. Graded exit + PAPER only, never with `volTargetPct` or DCA (`riskSizingRefusal`: exec
  before any read; lab-api 409 `risk_sizing_refused` on all 4 config paths). `capitalPerTrade` = the margin ceiling.
  exec reads the graded stop BEFORE sizing and stamps `sizing:"RISK"`, `risk_usd` (actual, after snap/cap) on the
  position + paper row (never the Supabase row). Replays book `tradeNotional` per trade (incl. the random baseline).
  Lab: the "FIXED RISK / TRADE" field shows under the graded-exit toggle; whole-strategy loads clear it.
- **Overlap pairs** (`OVERLAP_PAIRS`, axisbt.mjs → the scoreboard's `overlap` block): basis_x_cvd×rsi_reset_deep,
  level_reclaim×{level_reclaim_tight, session_fade, spot_absorb}, session_fade×oi_div_reversal_4h,
  confluence_follow×funding_basis_split, oi_div_reversal×oi_div_reversal_4h (one rule, two windows). A filtered read and its
  parent are one bet, never stacked as two.
- `/intel/evidence?axis=&hold=` replays a preset across every mature market (pooled ≠ independent; say so).
- basis:hist had holes from our own OKX burst until the paced `snapshotFlow` fix: read older windows with that in mind.
- **The Read / Briefing / FADE:** show inputs, never a tally or crown of ungraded reads; the Board's FADE is "a
  mechanical rule, not graded yet" with the nearest graded relative's live grade (`app/lib/fadeGrade.mjs`). Never call
  a read "proven" or "graded" unless the scoreboard grades that exact rule.
- **/proof layout:** verdict (the headline is a claim COMPUTED from the served stage, `proofHeadline` in proofCopy.mjs, since
  2026-11-05: "Nothing has proven itself yet" until a read is served TRADEABLE/PAPER with positive exit net, then the read,
  trades and date; unread/stale board = no claim, never "proven") → board by stage
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
- **Minute grading** (borst 2026-11-12, `docs/research/minute-grading.md`): calls published from `MINUTE_GRADE_FROM_MS`
  (2026-11-13T00:00Z, `app/lib/minuteGrade.mjs`) are graded by the SAME `gradeCall` on 1-minute bars (`cd.step = 60`;
  the time stop stays counted in hours). Forward-only, no `GRADE_V` bump. Archive `m1:{PERP}:{day}` (`minuteCandles.mjs`,
  no expiry, public `GET /candles/1m/:symbol/:day`; today's chunk carries `contigFrom` so finished days aren't re-read
every minute); open index `open1m:{wallet}:{id}` (`minuteIndex.mjs`, written at
  publish in `labWrite commit`, re-built by the hourly pass); grader `minuteGrader.mjs` on lab-api's `* * * * *` cron
  (re-grades only calls whose levels traded in minutes that are NEW or CHANGED vs the archive, never-stamped calls, or a
  due time stop: a re-read unchanged minute never re-triggers, since KV reads can be ~60 s stale) + a `full` sweep after
  the hourly pass; one run at a time (`LOCK_KEYS.minuteGrade`); each fill/grade alert once (`claimOnce`, a NexusLock lease
  never released). Field ownership on a minute call: the minute grader writes
  `GRADE_FIELDS`, the hourly pass `PLAN_FIELDS` only (`writePassFields`). The board counts its sealed stamp; `/verify`
  re-runs it on the archive (`orderly_1m_regrade`). Never grade on the websocket mark: the cards' "· CONFIRMING" hint
  (`provisionalTouch`) is display only. Hourly suites that build calls from `Date.now()` pin
  `_pinMinuteGradeFrom(Infinity)` (tests only; a test fails if app/ or workers/ code calls it).
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
- **Declared time stop** (borst 2026-11-06, `docs/research/engine-ab-time-stop-note-2026-11-06.md`): `timeStopH: N` (whole
  hours 1–168) frozen at publish like the split, graded by the shared `gradeCall` for ANY caller (`callMath timeStopPlan`;
  no wallet logic): no TP/SL by bar N's close ⇒ settle at that close, R = move ÷ risk, R > 0 WIN else LOSS, `exitReason:
  "TIME"` (server field, carried by the pass). Bar 0 = posting hour (at post) / fill hour (resting); TP/SL first in every
  bar; window in TIME; settles only once a later bar exists. Read only on calls published from `TIME_STOP_FROM_MS`
  (2026-11-06); refused with a split; on-chain as `#TIMESTOP_<N>H`; copies keep it (`copiedTimeStop`). Engine B's
  main track declares 4h; Track M declares none. No `GRADE_V` bump.
- **Cards** re-read an open call every 30 s on its own page (`callPollMs`, stops once graded). They read R:R from the levels (`callRR`), show a position only once the entry trades (`callLifecycle.mjs`,
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
  re-run), `/theses/ledger` (+ chain, anchored). Fill/TP1 alerts go out from the pass that stamps them (hourly, or the minute grader).
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
  route accepts a session yet. **`AUTH_V2_KEYS = "true"` in lab-api wrangler.toml since 2026-11-06 (borst):
  additive, v1 walletSig unchanged; test on 0xd9f7…b449's way back before the skill moves.** Step 2 (built 2026-10-31): `v2Keys.mjs` +
  `routes-key.mjs`: random 32-byte keys, AddOrderlyKey `read,trading`, 30 days, sealed in `v2key:{addr}` (NOT
  `agent:key`); `/v2/key/begin|complete|remove` (session; complete/remove also need the challenge, always on) and
  `/v2/key/bankr-register`; rotation removes the old key signed by the new one; NexusLock `LOCK_KEYS.v2Key`. Nothing
  reads the stored key until step 3. #14 is closed into the spec (challenge = §C; `/trade` + kill session-only).
  Step 3a (built 2026-10-31, same flag): the 10 trading routes accept `{walletAddress, session}` and sign with the stored
  key (`tradingSigner.mjs v2Signer`: 409 `key_required` / `key_expired`); v1 `walletSig` branch unchanged beside it;
  `/trade` dropped its per-trade challenge. Step 3c (built 2026-11-03, same flag, `withdrawV2.mjs`): `/proxy/bankr-withdraw`
  uses the stored key for a wallet WITH a `v2key` record (Bankr signs only the Withdraw, which must recover to the
  wallet); `/withdraw/prepare|submit` take a session, submit always needs the `withdraw` challenge bound to the signed
  units. A `read,trading` key can drive a withdrawal the wallet signs (Orderly's SDK registers that scope) but can't
  withdraw alone. Second switch `AUTH_V1_REGISTER_OFF="true"` (`v1Registration.mjs`, unset): `/proxy/bankr-register` →
  the v2 Bankr registration, `/derive-key` + `/proxy/register-key` → 410, `/register-orderly-key` → the v2 page
  (`GET /v2/session/new` mints the unsigned session). Flip it when the Bankr skill moves (step 4), not before: the skill
  trades with walletSig. Step 3b (built 2026-11-06, same flag, `agentAuth.mjs` + exec `agentKey.mjs`): agent + TWAP
  mutations take a session too; going live with one stores a POINTER `{v:2, ref:"v2key"}` in `agent:key` / `twap:key`
  (never the secret) once `v2key:{addr}` is active; exec follows it to the current key (a missing key throws, so closes
  retry), opens nothing whose max hold ends after `expiresAt`, alerts daily from 3 days out; kill has no challenge.
  Session path, always on: arming AUTONOMOUS or raising capital/leverage needs the §C challenge (`configChallengeNeeded`,
  `sessionChallenge`); `/v2/key/remove` refuses under a live agent position or active TWAP (`keyInUse.mjs`).
  Next = step 4, the Bankr skill PR.
- **Settle PnL** (`workers/nexus-lab-api/settlePnl.mjs`, read from Orderly's SDK 2026-11-06): GET `/v1/settle_nonce` (key-signed)
  → the WALLET signs EIP-712 `SettlePnl {brokerId, chainId, settleNonce, timestamp}` on the on-chain domain (`0x6F7a…D203`)
  → POST `/v1/settle_pnl {signature, message+chainType "EVM", userAddress, verifyingContract}`. An empty `{}` settles nothing
  (every path did that until 2026-11-06). Bankr withdraws settle via Bankr's signature (`runSettle`; a failed settle =
  502 `settle_failed`, nothing re-sent). `/settle-pnl`: `bankrApiKey` = one call; else prepare (typed data) → submit
  `{message, signature}`. Orderly's -1117 ("no PNL to settle") = nothing to settle, not a failure (`nothingToSettle`:
  runSettle stage `nothing`, /settle-pnl 200 `nothingToSettle:true`, the withdraw retry carries on; 2026-11-09, live on
  0xd9f7…b449). The code-78 retry sizes from `/v1/positions` `free_collateral`, never the holding; `withdrawnAmount`
  = what Orderly accepted (0 on a refusal).
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
- **Live rows book the exchange's fill, not the mark** (since 2026-11-06): after each live market order (entry, DCA add,
  partial TP, close) exec reads `GET /v1/order/{id}` and books `average_executed_price` when FILLED (`fillPriceFrom`,
  exec `logic.mjs`; `readFill` tries twice ~0.5 s apart), else the mark. The position carries `entry_fill`
  ("exchange" | "mark" | "paper"). Rows before this date are mark-priced (no slippage shown). Paper is unchanged.
- **Live slippage** (borst 2026-11-13, `app/lib/slippage.mjs`): at each live market order (entry, DCA add, partial,
  close) exec records the exchange fill vs the mark it decided on, bps signed so + = paid worse, in `state.live_slip`
  (last 100; only `source:"exchange"` fills, a mark fallback is unknown, never 0). `GET /agent/:a/slippage` + the
  Lab's LIVE EXECUTION line. Record only, nothing trades on it; paper has none by construction.
- `GET /agents/ledger` + chain, anchored on Arbitrum by `NexusLedgerAnchor` `0x57a698df84a44F3dA3dac3E08CA455a55A4eff84`
  (dedicated signer, `ANCHOR_PRIVATE_KEY`). The call-ledger hash has a fixed field list: changing it breaks the chain.

## Engagement surfaces
- `/agents/live` (uPnL from public marks; humans opt in via signed `POST /live/publish`, ~6-min TTL), Desks (score =
  members' graded calls via `computeCallerStats`), `LiveAlerts`, watch-only banner. Sparse at cold start by design.
- **Lab pulse** (`GET /calls/pulse`, `routes-pulse.mjs`, rule `app/lib/callPulse.mjs`, 5-min KV cache, CORS `*`):
  open calls (entry traded) + graded in 7 days + the last grade + the /proof headline read from the scoreboard's
  own cache (`axisbtCacheKey`). **People and our engine callers counted APART, never blended** (borst 2026-11-05):
  top-level = people, `engines` = the wallets in worker var `ENGINE_CALLER_ADDRESSES` ("Ember", "Ember M"); both house callers (`HOUSE_CALLER_ADDRESS`, `HOUSE_CATALYST_ADDRESS`) left out; no copies. Rows carry the
  caller's display name (`caller`) + `engine`; `engineRecords` = each engine's all-time graded record (graded, wins, net R)
  → /proof's "Our engine callers" fold (losses included, "not a signal service"). Each engine row carries a plain
  line of what it trades (`ENGINE_NOTES` in proofCopy.mjs, keys pinned to `ENGINE_CALLER_ADDRESSES`). Public names (borst
  2026-11-06): `0x3b2c…bfe4` = "Ember", `0x493d…c086` = "Ember M" (Ember's breakout track). `0xd9f7…b449` was "Engine A"
  (STOPPED mid-October 2026: its Bankr automation ran out of executions, the original instructions are unrecoverable; the
  A/B comparison is CLOSED as not runnable, engine-ab-prereg.md Results 2026-11-07; Bankr's memory spec for it was
  Ember's). Since 2026-11-08 it is "Apex Tape", discretionary manual calls (borst 2026-11-07): worker var
  `PERSON_FROM_ADDRESSES` (`addr@ISO`) counts it as a PERSON only for calls with server `publishedAt` ≥ that date; its
  older bot calls count nowhere (`parsePersonFrom`, callPulse.mjs). No engine row for it on /proof. A
  name lives in the wallet's own profile (PUT /profile, its Lab signature), never set by us. Each row shows "last graded Nd
  ago" (`lastAt`), so a quiet engine reads as quiet. A new engine wallet goes in that var, or it counts as a person. Feeds the Trade/Spot strip
  (`LabPulseChip.tsx`, → /proof), Lab home's Calls panel (`LabCallsPanel.tsx`: the "graded from public price" line + the
  newest open/graded calls, first on Market Intel) and the landing hero's record panel. A quiet week shows the last grade's age, never a fake number.
  **Paper run page** (`/proof/paper/:axis`, 2026-11-12, borst: "no running dollar pnl"): `GET /signals/paper-run/:axis`
  (`routes-paperrun.mjs`, rule `app/lib/paperRun.mjs`) = the read's paper wallet as n of 30, TP/SL/time-stop counts and
  each trade's R; NEVER a dollar figure, size, or a sum/average of R until the 30-trade judgment (`paperJudge.mjs`, bps after fees).
  R = move ÷ `sl_percent` (exec stamps it on paper rows from 2026-11-12, record only), else by the contract (TP +1.5,
  SL −1, labelled). Link card from `functions/proof/paper/[axis].js` (live count; no paper wallet = real 404).
  That Function also swaps index.html's boot screen for a static copy of the run (`paperRunSnapshotHtml` + `withSnapshot`,
  pinned to the boot markup by test; React replaces it on mount) and reads lab-api through a 60 s edge cache. The open
  trade is a table row (number, entry, tape; "Open", R "—" until it closes).
  `signals` (pulse v5, `app/lib/signalProgress.mjs`) = reads served TRADEABLE/PAPER with positive exit net + the paper
  wallet's lifetime trade COUNT vs `PAPER_MIN_TRADES` 30 (`paperWallet` on the registration, `readPipeline.mjs`; no state =
  null "unread", never 0; never a paper P&L). The last good {headline, signals} sits in `calls:pulse:board:v1` ≤6h, so a cold
  scoreboard cache no longer blanks the landing. /proof's FeaturedLead prints the same line under the headline.
  **Caller pipeline:** Lab home's Calls panel turns into "Your first call, in 30 seconds." → the Thesis Engine when no person
  has a call open; /proof's "𝕏 Share this week's record" posts `recordShareText` (`app/lib/recordShare.mjs`: pulse counts,
  people and engines apart, the cleared read's paper count; unreadable pulse = no link). The post links
  `og.nexustradinglabs.com/share/record?v=<day-hash>` (`recordShareLink`), which unfurls into the 1200×630 card
  `/og/record.png` (`routes-recordshare.mjs`, `recordCard`; counts only, no green/red; an unreadable pulse = an honest
  "counts unavailable" card that claims nothing about the signals) and forwards people to /proof.
- **Position → call (Trade, 2026-11-05):** `PositionCallButton.tsx` sits at the right end of the Trade strip, only when the
  wallet holds a position in the market on screen; one tap opens the Thesis Engine with a draft (`app/lib/positionCall.mjs`):
  side from the position, ENTRY = the mark at the tap (never the average open price: a call starts when posted), stop/target
  = the position's TP/SL only when on the right side of the mark (else dropped, the note says so). No size/P&L in the draft.
  The trader publishes; nothing auto-posts. No position but a resting limit ENTRY (LIMIT/POST_ONLY, not reduce-only,
  newest) → "Post your ETH limit buy as a call" (`orderCallDraft`): entry = the order's EXACT price (never rounded), counted
  once price trades there like the order; the note says a published call is permanent (cancelling the order won't cancel it).
- **After publish (2026-11-06):** the Thesis Engine shows "Your BTC long is live." + "𝕏 Share your call" (same links as the
  card's 𝕏 SHARE: `callShareLinks` in `app/lib/callShare.mjs`, the call's OG page) until "Not now".
- **Follow → new-call alert (2026-11-06, `followAlerts.mjs`):** after a save commits, each call it published for the first
  time (`sealed.newlyPublished`; public, not holders-only, not a copy; ≤3 per save) notifies the author's followers (scan of
  `follows:*`, ≤200 per call) as `followed_call` ("kai posted a call: ETH SHORT", links the AUTHOR's call via
  `thesisWallet`). Both publish paths (`PUT /lab`, `/theses/index`). Phone push only behind its own topic `following`
  ("New calls from callers you follow"), OFF by default (`DEFAULT_TOPICS`). Telegram links use `thesisWallet` too.
- **Folds (2026-11-05):** Lab home's Briefing (`nexus_briefing_collapsed`, folded unless the viewer chose "0") and Board
  (`nx_board_open`) start folded. Spot's Cross-chain card is folded (`nx_xc_open`) but opens itself for a bridge prompt
  (`xcPreset`) or a transfer still moving (`hasTransferInFlight`: tracking only runs while the card is mounted).
  Header "Total value" reads "Orderly balance" (`common.totalValue` in `public/locales/extend/en.json`; also the SDK's
  trade/portfolio asset panels, same number).

## Phone alerts + Android
- **Android** = the live site in a Trusted Web Activity, `com.nexustradinglabs.nexus`, live on Google Play. Runbook
  `docs/android-app.md`. `public/.well-known/assetlinks.json` (3 fingerprints: Play signing, upload, dApp Store, on BOTH packages:
  Play `com.nexustradinglabs.nexus` + dApp Store `com.nexustradinglabs.trade.twa`) —
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
  value, and any whose approve target ≠ swap target ≠ a router read live for that chain (`app/lib/spotRouters.mjs`
  `pinnedRouter`: Nordstern on 1/8453/42161/10/137, 0x AllowanceHolder on 1/8453/42161/137; Robinhood 4663 none yet =
  deep link only; a provider moving its router = "no in-app route" until added). Signing lives ONLY in
  `app/pages/token/swapExec.ts` (exact-amount approve against OUR USDC, value 0, chain check, the same router pin at
  plan time and again right before the approve, receipt status). `ZEROX_API_KEY` IS set (2026-11-12: 0x answered dust
  quotes Nordstern refused); 0x simply loses on price at normal sizes. Fabric is dead (shut down 2026-09-16). Previews (no wallet) quote for `PREVIEW_SWAPPER`
  `0x…10000`: 0x refuses any taker ≤ `0x…ffff` (the old `0x…dEaD` kept 0x out of every preview until 2026-10-31).
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
  `POST /xc/quote` with `ONE_CLICK_JWT`, falling back to direct. **`quoteRequest.deadline` is NOT signed** (the SDK hash
  merges request + quote and `quote.deadline` overwrites it): the card passes the deadline it asked for
  (`intent.deadline`) and the guard uses that, never the reply's copy. Refusal sweep: `nearIntents.attack.test.mjs`
  (every signed field tampered/injected/removed, real signed quotes for someone else's swap, unsigned fields).
- **1Click settlement, proven on-chain** (since 2026-11-05): `GET /xc/settlement?depositAddress=` (`routes-xcsettle.mjs`,
  read-only, own per-IP budget) takes the signed quote 1Click's status echoes (re-verified, same deposit address), reads
  each listed tx from its own chain (EVM Transfer logs of the PINNED token / native value to the signed recipient,
  Solana token-balance deltas by owner+mint, BTC outputs) and judges vs the SIGNED `minAmountOut` (refund: sent −
  signed `refundFee`), never the status's amounts (`app/lib/nearSettlement.mjs`). Only DELIVERED / REFUNDED are
  settled; UNREAD / UNPROVEN / CONFIRMING are never green. The card shows green "Delivered · confirmed on <chain>"
  only on DELIVERED to the recipient it sent the quote for (`settlementLine`). **Native coin paid inside a contract
  call** (2026-11-05): `debug_traceTransaction` callTracer (only CALL/SELFDESTRUCT value, nothing under a reverted
  frame) else a balance diff across the block, only if no other tx in that block touches the address; else UNPROVEN.
  The row's `method` says which (direct / trace / balance); the proof is memoised in LAB_STORE `xc:credit:*` (7 days)
  by tx + block HASH (`kvMemo`). **Finality:** Ethereum `finalized`; Base/Arbitrum `safe` (falls back to `finalized`;
  no tag known = not final). The card re-checks ~30 min (15 s × 8, then 60 s) and re-opens itself while a check is
  open (`hasTransferInFlight`); INCOMPLETE_DEPOSIT keeps polling (it refunds by the deadline). "Copy receipt"
  (`settlementReceipt` / `receiptWanted`) appears on SHORT / mismatch / UNPROVEN / FAILED / INCOMPLETE / timed out.
- **1Click FROM Solana** (2026-11-05): SOL / USDC on Solana are send options when a Solana signer is connected (the Spot
  page's `solProvider`). The ONE signer is `app/pages/token/xcSolSend.ts`; rules in `app/lib/solDeposit.mjs` (tested, with
  web3.js as referee). SOL = one System transfer; USDC = ATA create-idempotent for the deposit address (1Click's Solana
  deposit addresses are fresh owners) + one TransferChecked. Only System / SPL Token / ATA programs, v0, no lookup tables,
  payer = wallet. Simulated on the exact bytes via `/sol/rpc`: deposit side gains the amount, USDC drops ≤ the amount, SOL
  drops ≤ amount (SOL) + 0.01 SOL. After signing the bytes must still decode to ours (`checkSignedDeposit`: only a capped
  compute-budget price may be added); we send them. Refunds go to the Solana wallet. Solana→Solana is refused (a swap).
  An EVM destination with no EVM wallet = a typed address, strict EIP-55. Mainnet dry run (no signing) passed 2026-11-05.
- **Fund my trading account** (card chip, or `navigate("/token", { state: { xcFund: true } })`): USDC to the trading
  account's own wallet (EVM account → USDC Arbitrum; Solana account → USDC Solana). Once the delivery is DELIVERED to
  that wallet (`depositHandoff`), "Deposit to your trading account" opens Orderly's dialog by its registered id
  `DepositAndWithdrawWithDialogId` (`@orderly.network/ui` modal; `/portfolio` if it isn't registered).
  **"Other chains" tab inside Orderly's own Deposit / Withdraw window** (2026-11-05): an Orderly plugin
  (`app/components/orderlyProvider/xcDepositPlugin.tsx`, registered via `OrderlyAppProvider plugins={XC_PLUGINS}`)
  intercepts the SDK's injectable `Transfer.DepositAndWithdraw` and adds one `extraTabs` entry (`withFundTab`,
  `app/lib/xcFundTab.mjs`, tested: once, keeps others). The tab moves nothing: it closes the window and opens the card in
  fund mode (`/token` + `{ xcFund: true }`). Same tab in the mobile sheet. SDK upgrade: re-check that target name.
- **Card polish** (2026-11-05, rules in `app/lib/xcCardKit.mjs`, tested): live "You'll receive ≈" from a signed DRY quote
  ~0.6 s after typing (`checkPreview`: signature, dry, same assets + amount; never a deposit address; Review still runs
  checkQuote); balance of the sent asset read on ITS chain (EVM public RPCs, Solana `/sol/rpc`) + Max (`maxSendable`:
  tokens whole, native keeps `GAS_RESERVE`), over-balance blocks Review; 1Click's errors in plain words
  (`quoteErrorText`, "try at least N" is base units of the asset SENT); progress timeline (`xcSteps`, last step = the
  on-chain proof); Recent transfers on this device (`nx_xc_history_v1`, `pushHistory`, 5 max, receipts).
- **Solana swap (Jupiter) — the ONE signer is `app/pages/token/solSwapExec.ts`**, BUY (SOL or USDC → token) and SELL
  (token → USDC), Jupiter `/build` via our `/swap/jup/*` proxy, RPC via our `/sol/rpc`. Pre-sign, on the exact bytes it signs
  (re-fetched fresh right before signing): quote bound to our mints + amount; slippage ≤ 300 bps and the quote's
  minimum respects it (`checkMinOut`); fee payer = the wallet; top-level programs allowlisted; every instruction outside
  Jupiter's program has a swap's shape (`instructionShapeRefusal`, jupBuild.mjs: ATA create for the wallet, wrap/sync/
  close its own wSOL account; Approve / SetAuthority / Assign / any transfer out refused: the balance-only simulation
  can't see them); the reply's lookup tables match the chain (`altClaimRefusal`, read via `/sol/rpc`); simulation must
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
  account skipped for now (SOL buys carry no fee). **LIVE since 2026-10-29** (`JUP_FEE_LIVE="true"`, borst, after a passing dry run).
  Set it to anything else = STAGED: only quotes tagged `feetest=1` carry the fee (use that for dry runs of a change).
- **Jupiter Swap API V2 `/build` (since 2026-10-31; v1 "Metis" is unmaintained).** `GET /swap/jup/build` (proxy,
  `jupBuildParams`: whitelisted params, our `platformFeeBps` + `feeAccount` set server-side, payer/destination/tip/
  version never forwarded) returns the quote + RAW instructions + the worker's `nexus {feeBps, feeAccount}` echo. The
  signer checks the response first (`app/lib/jupBuild.mjs checkBuild`, tested on real replies: mints/amount/ExactIn/
  slippage/min out, only the wallet signs, no tip, v0, compute-budget price only and clamped, our fee ≤ 100 bps with
  our account IN the swap instruction), then assembles the v0 tx itself (`compileBuild`: wallet pays, limit from a
  measuring simulation × 1.2, ≤ 1232 bytes) and runs the simulate guards on the exact bytes. Price reads (SOL/USD,
  the no-wallet preview) use `/build` with `PRICE_TAKER` (an empty key) + `nofee=1`. The v1 `/swap/jup/quote|swap`
  routes still exist but nothing in the app calls them. Real-code dry run: bundle solSwapExec.ts with esbuild and
  give `executeSolBuy` a provider whose `signTransaction` throws.
- **Spot ledger** (`workers/nexus-lab-api/spotLedger.mjs`, tested; since 2026-10-28) → the "Spot" box on `/ops/revenue`
  (`spot` in its reply, last 30 days). Counts only what's proven: Flash = the proxy logs each accepted order id
  (`spot:flash:{id}`, with the funder only until booked) and the hourly job books final orders from Flash (one trade +
  fills' notional + our `integratorFeeNotional`, on the last fill's day); spanDEX / Jupiter / NEAR = the app calls
  `POST /spot/fill {route, id, chainId?}` (`app/lib/spotReport.ts`, fire-and-forget) after a confirmed trade and the
  worker books it only if the receipt is 0x1 / the signature is confirmed / NEAR: `settleDeposit` finds the signed
  minimum on-chain at the recipient (DELIVERED or CONFIRMING; the card reports once the check shows it); WooFi = widget OPENS
  (the widget reports no fills). Each id once (`spot:fill:{route}:{id}`), day totals `spot:day:{YYYY-MM-DD}` under a
  NexusLock lease. No wallet address is stored.
- **Best price (EVM USDC buys, read-only):** `GET /spot/best?chain=&tokenOut=&amount=` (`routes-spotbest.mjs`, rule
  `app/lib/spotBest.mjs`) quotes spanDEX (preview, our fee on) and a Flash market quote (our key + fee, no funder) and
  compares each router's own "you receive". Flash prices its gas in; for spanDEX the worker takes off an estimate
  (live `eth_gasPrice` × `SWAP_GAS_UNITS` 200k + the OP-stack L1 fee upper bound on Base/Optimism, in ETH at Orderly's
  ETH mark, converted at the quote's own rate), so both are "after gas". Approval gas isn't counted (both need one).
  Any unreadable part (or Polygon, POL unpriced) = no estimate and the line says "Flash incl. gas". Under 5 bps =
  "about the same". The /token ticket shows one line; it routes nothing and signs nothing. Cached 20 s, origin-gated.
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
- **SDK = 3.4.0** (all `@orderly.network/*` aligned; `trading-points` stays 2.0.2). Since 3.3 every SDK feature is ON
  unless explicitly false: **Orderly Predict is OFF** via `features={ORDERLY_FEATURES}` (`app/lib/orderlyFeatures.mjs`,
  test-pinned). **Skipped (borst, 2026-11-06): don't pitch or build it.** Read then: BTC 5-min binary rounds, ~1.5% taker
  fee (builder keeps user rate − tier base), US block is the front end's job, settlement can be recorded by hand, likely
  conflicts with Google Play's binary-options rule (our Android app is the live site). After any SDK bump re-check the
  `Transfer.DepositAndWithdraw` injectable (Other chains tab), the build's amplitude/trim guards, and `features` defaults.
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
- **Page meta** (2026-11-12): `app/lib/routeMeta.mjs` = ONE title/description per indexed route (/proof /lab /feed /arena
  /analyze /token /intel). `functions/<route>/index.js` writes it into the HTML head (`gateRoutePage`, seoGate.mjs, the call
  pages' `injectCallMeta`; fail open) for crawlers + X/Telegram previews; the tab title = the route's `<PageMeta route=… />` (main.tsx, Helmet).
  `public/sitemap.xml` is generated from it (test-pinned); robots.txt points at it. A new indexed route = all four.
  /proof's Function also swaps the boot screen for a static header from `GET /calls/pulse` (`gateProofPage` →
  `app/lib/proofSnapshot.mjs`, 60 s edge cache): the served headline (null = the no-claim default), paper COUNT, the bar
  line (`PROOF_BAR_LINE`, one copy with FeaturedLead), people and engines apart. Unreadable pulse = boot screen, fail open.
  /analyze's Function swaps it for the X-Ray frame (`gateAnalyzePage` → `app/lib/xraySnapshot.mjs`, no fetch): the header
  (`XRAY_TITLE` etc., one copy with the page) + for `?address=0x…` that wallet and an "Analyzing…" block over empty
  placeholders. It claims nothing about the wallet (no grade, no money); only a well-formed 0x address is echoed.
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
  is on another repo (BankrBot/skills, nexus-landing), a `Pipeline watch:` PR you did not open as the watcher, or anything that arms live money. After
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
- Cold start / feed liveness is behind us. In-app EVM buy/sell is live and tested. The mini app is parked. Orderly Predict
  is skipped (2026-11-06).
- Focus = the engine and its signals. The engine has no proven edge yet: that's the #1 risk, and the failure mode is
  copy shipping ahead of the grade.
- The Oct-15 engine freeze is over. Engine work happens when borst asks for it.
- Positioning: the trading terminal that grades itself in public. The DEX is the commodity; the Lab, the grading and
  the social graph are the moat.
