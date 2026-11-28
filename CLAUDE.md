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
- **x402 data (Bankr-hosted, priced in $NEXUS on Base):** `nexus-signals` (50k/req, `/signals`; the read's grade is live, read from `/intel/axis-backtest` on every call
  and carried as `grade` in every response; the listing and README state no grade as current (it moves; a static
  "NOISE" tripped Bankr's check 2026-11-27, test-pinned) and say "not a proven edge";
  swap only to a read that clears; the CLEARED gate is built in, borst 2026-11-27: the handler serves btc_lead_lag only on a cleared 200 from `GET /signals/read/:axis` (`routes-readsignals.mjs`, rules `app/lib/soldRead.mjs`, 403 `not_cleared` with no signals until then), else funding-fade with its live grade), `nexus-callers` (10k, `/theses/leaderboard`), `nexus-agents-live` (10k,
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
  never 0; a holding the parallel burst lost gets ONE retry on its own (`readRevenue`, 2026-11-14), and the digest names
  each still-unread one ("Unread: Bankr wallet $NEXUS on Base"). Flash + Orderly broker fees aren't on-chain readable.

## Hosted AI (`POST /ai/chat`, PRO)
- Wallet-signed, PRO-gated proxy with our key, prompt caching (`hostedCacheBreakpoints`: the proxy drops the client's
  marks and sets two, the stable prompt block + the question's last turn; the client sends the system as [prompt, live
  context], `systemBlocks` in anthropicTurn.mjs) and a **per-MODEL daily cap of QUESTIONS**
  (`ai:usage:{addr}:{model}:{date}`). Tiers (borst 2026-11-15, the current model of each family): Haiku 5.5 100 ·
  Sonnet 5.5 40 (default) · Opus 5.5 12 · Fable 5.2 5; the 4.x tiers and Fable 5.1 are retired (a stored old id falls
  back to the default). `resolveHostedModel`/`hostedCaps` (lab-api `logic.mjs`) whitelist the id; client mirror
  `HOSTED_TIERS` in `config/assistant.ts` (`logic.test.mjs` + `app/lib/hostedCopilot.test.mjs` fail if they disagree).
  Env per family: `HOSTED_CAP_HAIKU|SONNET|OPUS|FABLE`, `HOSTED_AI_DEFAULT_MODEL`.
- **One slot per question** (`takeHostedSlot`): the client sends `_q` (random, one per question); its first request takes
  the slot, its tool rounds ride on it (≤ `HOSTED_QUESTION_ROUNDS` 5 within 15 min, `ai:q:{addr}:{q}`, else 429
  `question_rounds`). No `_q` = one slot per request (the old rule).
- **What reaches our key** (`shapeHostedBody`, 2026-11-15): only model (whitelisted), max_tokens (server ceiling),
  system, messages, CUSTOM tools (name / description / input_schema; server tools such as web search / code execution
  dropped), tool_choice auto/none, stream, effort "low". Everything else (speed, fallbacks, mcp_servers, container, …)
  is dropped. Bodies over `HOSTED_BODY_MAX_BYTES` (200 KB) → 413 `too_long` before parsing. The copilot shows the
  proxy's `hint` (`errText`).
- The counter is read + bumped under a NexusLock lease (`LOCK_KEYS.aiUsage`): busy → 409, lock down → 503, nothing sent.
- **Spend path = Bankr LLM Gateway** (`AI_GATEWAY=bankr` in wrangler.toml + secret `BANKR_LLM_KEY`) →
  `https://llm.bankr.bot/v1/messages`, dot-notation ids mapped by `bankrGatewayModel` (`BANKR_MODEL_HAIKU|SONNET|OPUS|FABLE`;
  all four ids confirmed on Bankr's model list by borst, haiku-5.5 + fable-5.2 on 2026-11-15). Falls back to
  direct Anthropic (`ANTHROPIC_API_KEY`) if the key is absent. Revert = remove `AI_GATEWAY`. Credits at bankr.bot/llm.
- **Thinking tiers (all four):** `shapeHostedBody` sets effort `low` + a 4096 ceiling (`isThinkingModel` includes Haiku 5.5); the client reads text by block TYPE and sends thinking blocks back unchanged with their
  signature (`app/lib/anthropicTurn.mjs`, `createStreamAssembler`). BYOK users get the same handling.
- **Copilot** (`NexusAssistant.tsx`, `config/assistant.ts`, `config/assistantTools.ts`): BYOK keys stay in the browser.
  Hosted sign-in signs with the connected wallet's provider (`useLabWallet`, so WalletConnect / the Android app work;
  EVM only). Each question sends the last `HISTORY_MAX_MESSAGES` 20 (`trimHistory`); BYOK requests carry top-level
  `cache_control` (prompt caching on the user's key); a stream `error` event surfaces as a line (`streamErrorText`),
  never "(empty response)". Rules in `app/lib/anthropicTurn.mjs`.
  **Lab panels in chat (2026-11-15, `app/lib/copilotLab.mjs`):** `get_funding_venues` (/intel/funding-venues), `get_calendar`
  (/intel/calendar, UTC) and `get_book_risk`'s `desk` (the risk desk's `riskDesk()` from `useRiskDesk`, in the browser) are shaped
  by the panels' own rules; unread sources stay named. `get_watchlist` (2026-11-16) reads the Watching list (`readWatch`) +
  /intel/markets through `watchRow`, read only: chat never moves the "since your last look" baseline.
  `get_my_calls` (2026-11-16) reads `/theses/status/:wallet` through `callsForCopilot`: the grader's state in words, levels,
  live distance in R ("not a grade"), recent results with TIME / TRAIL / BE exits named.
  `get_signal_scoreboard` (2026-11-16, `scoreboardForCopilot`) adds the `tide` and each REGISTERED read's served stage + its
  new-data split per side vs a random entry on that side; the prompt's THE TIDE rule: judge a side against its random
  entry, never zero, and say both numbers.
  **Words (2026-11-16, `app/lib/copilotWords.test.mjs`):** every model-facing string is checked sentence by sentence: no
  "proven"/"provably"/"+EV"/"funding-edge"/"guaranteed", and "edge" only beside a denial, the grade, or the user's own record.
  **Token readout:** each answer shows "N in (X% from cache) · M out" (`usageLine`, anthropicTurn.mjs; Anthropic paths only).
  Bounded tool loop (max 5), models listed live from the key, thesis drafts via localStorage `nexus_thesis_draft` →
  `/lab?tab=thesis` (bare ticker, not `PERP_`). Its prompt must not call PREDICTIVE an edge or suggest inverting a read.
  **Grades (2026-11-14, pinned by `app/lib/assistantGrades.test.mjs`):** `get_market_read` = the drawer's
  `/intel/market/:coin` (each lens + its grade line), the default for "read X for me". No tool hands the model a
  conviction verdict over ungraded inputs (`get_read` lists inputs with / against a side; `get_conviction` counts them
  and carries the plain fade's own grade from `/intel/fade-grade`); the prompt's GRADES rule forbids summing inputs.

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
  When no market fires, `agent:signal.reason` carries the grouped sit-out reasons (`quietReason`, brain `logic.mjs`, 2026-11-13:
  "no signal · 11 of 11 markets: …", plus markets unread that tick), so "switched off" and "nothing qualified" differ.
  Shown (2026-11-14, `app/lib/quietLine.mjs`): the agent card's scanning box (AgentView, `last_signal`) and the paper run
  page while flat (`quiet` on `GET /signals/paper-run/:axis`), with the check's age; > 20 min old = "the brain may be down".
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
  >15 min via `ops:brain:heartbeat`, exec down >10 min, lab-api scheduler down >15 min via `ops:labapi:beat:m1`). `GET /monitor-now`.
- **lab-api job heartbeats** (2026-11-16, `workers/nexus-lab-api/jobBeats.mjs`): the minute grader (every 5th minute), on-chain
  watchdog, paper tape check, paper judge and scoreboard rebuild each stamp `ops:labapi:beat:{job}` (NEXUS_AGENT, one key per
  job) after a run that finished; the daily digest's "Background jobs" line names any late one (`jobsLine`, own limits).
- **nexus-lab-alerts**: alerts worker. Other legit CF apps: nexus-landing, orderly-proxy.
- **Owner digest + alerts (lab-api, borst 2026-11-14, rules `app/lib/opsDigest.mjs`, runner `opsDigest.mjs`):** hourly at :49
  on the minute cron (after the :47 judge). READS the stored scoreboard, each paper wallet's state/config/signal, tape,
  recorded judgment, parity (`parityEvents` + `paperParity`, as `/agent/:a/parity`), claims + judgment signatures, and
  once a day the receivers (`readRevenue`). Sends to `OPS_TELEGRAM_CHAT_ID` (lab-api wrangler.toml, the ops monitor's
  chat) via `TELEGRAM_TOKEN`: an ALERT when something changed that needs the owner (stage move, parity DRIFT /
  UNVERIFIABLE or clean again, verdict recorded, a new register / wire / sign item); the DIGEST once a day from 15:00 UTC
  (needs you · paper runs in R with tape, open trade or quiet reason, parity · stages · receivers not swept, tokens only).
  **Engine heartbeat** (borst 2026-11-16, rules `app/lib/engineBeat.mjs`): each engine row's last call from the pulse
  (`lastPostedAt`); no call in `ENGINE_QUIET_H` 48h = QUIET (never-posted = not started, never quiet). The digest's "Engine
  callers" section lists each + the rule-checked wallets' line (once a day); an ALERT the run one goes quiet and when it
  posts again (`engineAlerts`, state `quietEngines`; no burst on the first run); /proof prints "quiet: no call in 48h+".
  The first run sends "digest is on". Writes only `ops:digest:state:v1` + `ops:digest:sent:{day}`; a failed send keeps
  the old state so the alert retries next run. Moves, signs and trades nothing.
  **After a verdict** (`verdictSteps`): a PASS lists the ordered path under "Needs you", marked done / next: sign the live
  plan → fund a NEW dedicated wallet → arm it (borst's own PR into `GRADED_EXIT_LIVE_LIFT`) → the $10 mechanics test
  (`/ops/preflight?wallet=`) → the written compare after 10 live trades. Plan signed + the lifted wallet are read live
  (`readPlanSigs`, `parseLiveLift`); FAIL = "Nothing goes live" + the gap question; RESET = a new dated rules page.
- **Live plan signing (borst 2026-11-14, `app/lib/livePlanSign.mjs`, `routes-plansign.mjs`):** the judgment's rule 8
  ("PASS: a written live plan may be signed") done with the owner wallet on `/ops/revenue` (Live plans box). Signs the
  sha256 of the plan page's text above `## Sign-off`, served from the GENERATED `app/lib/livePlanText.mjs` (after
  editing a plan page run `node tools/pipeline/livePlans.mjs --write`; `livePlanSign.test.mjs` fails otherwise). Refused
  until the read's `pjudge:{axis}` verdict is PASS (`not_licensed`), on another hash (`page_changed`) or twice; Safe
  owner / `OPS_WALLETS`, 5 min, NexusLock `planSigs`, LAB_STORE `pipeline:plansigs:v1`. The watcher's step 5
  (`nextPlanRecords`) appends the signed line under Sign-off once, after re-checking hash + signer. A plan is listed in
  `LIVE_PLANS`. Also refused unless the read is SERVED TRADEABLE / PAPER (`read_demoted`; unread board = 503) with no
  promotion lock (`promotion_locked`, Backwards moves under the watcher). **Signing ARMS NOTHING:** `GRADED_EXIT_LIVE_LIFT` stays empty (test-pinned); arming is borst's own PR.
- **KV list() returns ≤ 1000 keys a page:** every `lab:*` reader in lab-api (grader passes, /feed, leaderboard, theses
  boards, call dedupe, the Holders Room) goes through `workers/nexus-lab-api/kvList.mjs listAllKeys` (2026-11-27;
  `kvList.test.mjs` fails on a single-page `list({ prefix: "lab:" })`). nexus-lab-alerts (manual deploy) still reads
  one page.
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
- **"What your agent is doing"** (top of the Agent tab, 2026-11-14, rules `app/lib/agentStory.mjs`): status + mode,
  markets watched (empty = evaluates nothing), the position or why it sits out (`quietLine`, stale > 20 min says so),
  the last close in words (`EXIT_WORDS`), today vs `maxTradesPerDay` / `maxDailyLossUsdc` ("Capped" when either hits).
  Display only. Regime filters are labelled "not graded"; no inverted-read pitch.
- **Before a wallet connects** (borst 2026-11-21, rules `app/lib/agentShowcase.mjs`, UI `AgentShowcase.tsx`): live proof
  leads, the six feature cards fold under "What it does". Every registered read's own paper agent from
  `/signals/paper-counts` as n of 30 (a dot on a track with the 30 tick, never a filling bar), "TRADE OPEN" flags, each row
  → `/proof/paper/:axis`; live entries open / paused from `GET /ops/halt`; live agents publishing from `/agents/live`.
  Counts and states only, never an R, sum or dollar figure; unread says unread (test-pinned).
- **Logged-out Quick Trade + Holders Room** (2026-11-21, `app/components/GuestPanel.tsx`, `app/lib/guestPanels.test.mjs`):
  what the tab does + the next step instead of one line. Holders tiers read `TIER_THRESHOLDS` (Operator = the room,
  Architect = + PRO while held, Oracle = the badge, no extra access); "no yield, no revenue share" stays.
- **PRO-locked clicks + the shelf's words** (borst 2026-11-22): a PRO preset / strategy button clicked without PRO shows
  `ProLockNote.tsx` right under what was clicked (words `app/lib/proLock.mjs`: what it is, "wasn't loaded", hold
  100M $NEXUS or $20/mo USDC / $15 in $NEXUS, "See PRO ↓" → `#nexus-pro`; "Checking…" while the tier loads, never
  "not PRO"). Every read row on the shelf links its public paper run (`paperCountLine`). Tests `proLock.test.mjs`.
- **Strategy Shelf is OPEN** (borst 2026-11-22, "everything runs on paper, only the CLEARED badge is gated"; rules
  `app/lib/strategyShelf.mjs`, tested): every row loads into the agent ON PAPER whatever its stage (Testing, Lead,
  Failing, Retired), button "Load on paper", stage chip + grade line (`readGrade`: new-data trades + proofLayout's
  `randomWord` / `beatSentence`) beside it. A registered read loads `readPaperConfig(read)` (housePaper.mjs; the house
  run's config exactly: REGISTERED_READ + `read`, graded exit, 11 main coins); both Basis × CVD rows load
  `BASIS_CVD_GRADED_PAPER` (BASIS_FADE + CVD on the graded exit). Load forces `mode: "PAPER"`, `invertSignal: false` +
  `EXPERIMENTAL_FILTERS_OFF`, and refuses over a live position. Safe by construction: the brain refuses REGISTERED_READ
  off paper, lab-api 409s the graded exit live. A user's run moves no stage and is never a read's `paperWallet`. Brain
  cost is per READ (shared), not per wallet; a user adding coins beyond the 11 adds series reads.
- **Execution gap** (borst 2026-11-26, the moat list; rules `app/lib/executionGap.mjs`, route `GET /agent/:a/gap`
  `routes-gap.mjs`, card `ExecutionGapCard.tsx` on the Agent tab): a PAPER agent on a registered read vs that read's own run
  (paper wallet, claim, else house id, as `paperRun` resolves it), from the later record start. Pairs = same coin + side
  opened within `PAIR_WINDOW_MIN` 10 min, nearest first; per pair the lag, entry / exit in bps (+ = yours worse) and both
  R's side by side (never summed); missed / extra; config fields that change entries named (sizing apart). Both paper at
  the mark: timing, caps and busy, "not slippage". Display only. **Numbers only** (borst 2026-11-28, "counts + pairs until
  30"): each run as n of 30 (`runs`, `lifetimeCount`), medians only from `GAP_MIN_MATCHED` 5 pairs, signed bps / minutes,
  no comparative words, no mean R / beat-random before a run's 30-trade verdict, `NO_STAGE_LINE` always (test-pinned).
  One read (`useExecutionGap`) feeds the Agent-tab card, the read's Shelf card (compact) and its `/proof/paper/:axis` page
  (the connected wallet's run; renders only when the wallet's run IS that read and isn't the read's own wallet).
- **What a read still needs** (borst 2026-11-28, pipeline item #2; rules `app/lib/readChecklist.mjs`, UI
  `app/components/ReadChecklist.tsx`, tested): on each read's Shelf card (compact: head + next 2 open rows + "Show all")
  and its `/proof/paper/:axis` page (full). No new source: the next stage's served `gates` (/intel/axis-backtest, numbers
  now vs bar, the checklist's own number-only titles) → the later stages' bars from `PIPELINE_RULES` ("checked at that
  stage") → the CLEARED stretch (30 closed paper trades from the judgment's count or /signals/paper-counts; after-fees
  average > 0 from `/signals/paper-judge/:axis`; ≥ `BADGE_BAR.beatPct`% of 300 random entries under it) + the failing
  label / a promotion lock. CLEARED (`isCleared`) is the only passed state; rows are ✓ ○ … ? in ink; a row that can't be
  measured says "needs N more closed trades". No comparative words (test-pinned). The Shelf fetches a judgment only at
  30+ trades or Tradeable / Paper.
- **Paper record card** (Agent tab, borst 2026-11-27, rules `app/lib/paperGraduation.mjs`, `PaperRecordCard` in
  AgentPanels.tsx, tested): replaced READY TO GO LIVE?, which offered "Go autonomous" after 5 trades of fee-free paper
  P&L. Under 30 lifetime trades (`paper_agg`) = "n OF 30", nothing to switch; 30+ = judged on the after-costs re-read
  (`/paper-costs`, one shared request with `PaperCostLine`): ≤ 0 = says so, > 0 = "a reason to look closer, not proof" +
  one button, ASSISTED. It never offers AUTONOMOUS (the mode picker keeps its GO LIVE confirm). State, guardrail caps
  (ink → SIGNAL.watch → C.warn), exit reasons and stop levels in ink; green/red stays on P&L.
- **Controls:** ASSISTED = pause entries, still manages. DEACTIVATE = stop + delete key, position left open with no TP or
  trail and only what rests on Orderly (the backstop stop, or the owner's own; none on DCA/paper): the Lab confirms first via `app/lib/agentControls.mjs`; `DELETE /agent/:a` returns `leftOpen` + `warning` for a live one). KILL =
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
  CLEAN, judged after fees (`/paper-costs`), tested. (Superseded for paper by the open shelf, 2026-11-22: anyone can
  load the read on paper through REGISTERED_READ; the LEVEL_RECLAIM mode itself stays on the hidden link.) Parity: `levelReclaim.test.mjs` (hour by hour), `/agent/:a/parity`. **OI_DIV_4H = ON for PAPER only**
  (2026-11-13, oi_div_reversal_4h served TRADEABLE that day, #299): same pattern. Shared rule `app/lib/oiDivReversal.mjs`
  (the grader's `oiDivReversalEvents` + `oiDivReversal4hEvents` moved there unchanged; explorerReads re-exports them),
  computed by the brain on `oi:hist` behind `OI_DIV_4H_LIVE = "true"`, PAPER only (`oiDiv4hRefusal`, no live lift);
  fires in the hour after its row, `sourceT` = the row time. Hidden link `/lab?tab=agent&deploy=oi-div-4h-paper`
  (`OI_DIV_4H_PAPER_CONFIG`, a FRESH wallet); its paper wallet is recorded on the registration (`paperWallet`, readPipeline.mjs),
  which moves the served stage → PAPER. Parity: `oiDivReversal.test.mjs`. **REGISTERED_READ = ON for PAPER only** (house paper runs step 2, borst
  2026-11-17; brain var `REGISTERED_READ_PAPER = "true"` since 2026-11-19): `signalMode:"REGISTERED_READ"` + `config.read` =
  any registered read (`BRAIN_READS` = `BRAIN_GENS`: explorerReads `EXPLORER_GENS` + rsi_reset_deep, whose rule moved
  unchanged to `app/lib/rsiReset.mjs` on 2026-11-19 and runs through `rsiResetDeepAtStamp`: its loop ends one row short,
  so the brain probes one copy row to see each event at its own row, pinned equal to the generator's later output by
  `rsiReset.test.mjs`). `workers/nexus-lab-api/registeredReadLive.mjs` runs the scoreboard's OWN
  generator, called as axisbt `buildEvents` calls it (OI price spine, `priceByHour(oiHist)`, BTC's candles as context), on
  the series the brain loads once a tick (all seven `READ_SERIES`, watched coins + BTC), each read once; fires in the hour
  after an event, `sourceT` = the event time. `registeredReadRefusal`: PAPER only, no invert, no unknown read; NO live lift.
  Parity read by read, hour by hour: `registeredReadLive.test.mjs`. ~0.35–0.5 s brain CPU a tick with all 16 in use (19 Nov,
  public series). **House paper runs** (borst 2026-11-17, step 2; lab-api var `HOUSE_PAPER_RUNS = "true"` since 2026-11-20): one KEYLESS
  paper record per registered read (`app/lib/housePaper.mjs`): id = "0x" + sha256("nexus/house-paper/v1/" + read)[0:40]
  (`HOUSE_PAPER_IDS`, recomputed by test; no one holds a key, so no owner signature or trading key exists). 14 runs: every
  registered read but `HOUSE_PAPER_SKIP` (level_reclaim + oi_div_reversal_4h have their own wallets, session_momentum was
  retired Nov 13 under the old rule, a run for it is borst's call); a new registration adds its read in the same PR (test-pinned). Config = `LEVEL_RECLAIM_PAPER_CONFIG` field
  for field with `signalMode:"REGISTERED_READ"` + `read`. Setup job `housePaperSetup.mjs` (hourly): writes config, a fresh
  state (`started_at`) and the agent:users entry ONCE; a stored config that differs is reported, never rewritten. The
  agent routes 403 `house_paper_readonly` on every non-GET for a house id (before any owner check); exec refuses any
  non-PAPER entry for one. House runs move NO stage (they are not a read's `paperWallet`). **Judged** by ONE page,
  `docs/research/paper-judgment-house-runs.md` (SIGNED by borst 2026-11-20, pinned above Results): rules 2-7 are
  oi_div_reversal_4h's word for word, rule 8 ties a PASS to the read's own served stage (CLEARED only once also served
  TRADEABLE/PAPER with no lock); `HOUSE_JUDGMENTS` in paperJudge.mjs (wallet = the house id, reset cut-off 2026-11-20).
  `parityEvents` loads all `READ_SERIES` + BTC context for a REGISTERED_READ config (it used to load only the two older
  reads' series, so house parity would have read DRIFT); the tape checker covers the house ids; `usePaperJudgments`
  reads their verdicts for the CLEARED badge. **On /proof** (2026-11-20): `paperRun` falls back to the read's house
  id (own wallet, then claim, then house; `house: true`), so `/proof/paper/:axis` + its link card work for every run;
  `GET /signals/paper-counts` (routes-paperrun.mjs, 60 s KV cache `paper:counts:v1`) = every read's run as a COUNT
  (wallet, house, count, target, open; unread, never 0); each board row prints `paperCountLine` ("Paper run: 3 of 30
  trades · 1 open →", `usePaperCounts`), never an R, sum or dollar figure. **Paper-wallet registration (borst 2026-11-14, `app/lib/paperClaim.mjs`,
  `routes-paperclaim.mjs`):** no more hand-made PR per wallet. On `/ops/revenue` (Paper wallets box) the owner pastes a
  fresh wallet and signs `paperClaimMessage` (5 min; Safe owner / `OPS_WALLETS`). `POST /pipeline/paper-wallet` binds it
  only if the read is SERVED TRADEABLE (stored scoreboard, unread = 503), has a `PAPER_SETUPS` entry (brain mode + preset;
  a new read's brain wiring stays its own reviewed PR), no wallet yet (code or claim), the wallet isn't another read's,
  config = the preset (`paperConfigMismatch`; tp/slPercent ignored, the graded exit sets its own) and the record is fresh
  (`freshnessRefusal`: started_at, 0 trades, no open position, never reset). NexusLock `paperClaims`; first wins, never
  overwritten. Stored in LAB_STORE `pipeline:paperwallets:v1`; the scoreboard build fills `paperWallet` on its rows
  (`readsWithClaims`, code wins) → PAPER at the next build; paper run page, pulse and tape checker read it too.
  `GET /pipeline/paper-wallets` (public). **Its judgment page (`app/lib/paperJudgePage.mjs`, `routes-judgesign.mjs`):** for a claimed
  read with no `PAPER_JUDGMENTS` entry, `GET /pipeline/judgment/:axis` renders the page from the claim (`RULES_TEMPLATE` =
  oi_div_reversal_4h's signed rules, test-pinned byte for byte) + its sha256; the owner signs `judgmentSignMessage` over
  that hash in the same /ops box (`POST …/sign`: page as served, Safe owner / OPS, < 30 trades, once, NexusLock
  `judgeSigs`, LAB_STORE `pipeline:judgsigs:v1`). The judge reads only the code entry: the watcher writes page,
  `signedResultsLine` and `judgmentEntry` into the repo. **Into git (step 5 of the daily watcher, `tools/pipeline/records.mjs`,
  rules `app/lib/pipelineRecordsWrite.mjs`):** copies claims + signed pages into the machine-written
  `app/lib/pipelineRecords.mjs` (`PAPER_WALLET_RECORDS`, `JUDGMENT_RECORDS`; never edit by hand, a test diffs it against
  the writer), `docs/research/paper-judgment-<read>.md` and `public/sitemap.xml`. It recovers every signature and
  re-renders every page itself; a mismatch is an issue, never a write; a page in git is never rewritten (the signed
  line is appended once). `readPipeline.mjs` (`CODED_READS`) and `paperJudge.mjs` (`CODED_JUDGMENTS`) merge the records;
  hand-written entries win. `pipelineRecords.test.mjs` re-checks every recorded signature. ~0.4 s brain CPU per tick for
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
  **btc_lead_lag** (borst 2026-11-27, option (a)): preset `BTC_LEAD_LAG_PAPER_CONFIG` (`app/lib/btcLeadLagPaper.mjs`) = its
  house run's config exactly (REGISTERED_READ, test-pinned to `housePaperConfig`), hidden link
  `/lab?tab=agent&deploy=btc-lead-lag-paper`, a `PAPER_SETUPS` entry; wallet `0x1F74…eEB` to be claimed on /ops. **The
  judgment follows the read's own wallet** (`judgmentsFor(claims)`, paperJudge.mjs): a read with a code or claimed wallet
  drops its house run's entry, so its claim drafts its own page; the house run keeps trading as data, unjudged and not
  shown as the run. The hourly judge reads the claims first and records nothing if they can't be read.
- **Paper tape check** (borst 2026-11-13, `docs/research/paper-tape.md`): every paper fill (entry + exit) is checked
  against Orderly's public 1-minute bar for its minute or the one before (`app/lib/paperTape.mjs`: ON_TAPE / NEAR ≤
  `TAPE_TOL_BPS` 10 / OFF / NO_TRADES / NO_DATA / AVERAGED for a DCA blended entry, `entry_avg` on paper rows / PENDING).
  Checker = lab-api `paperTape.mjs`, hourly at :41 on the minute cron: READS agent state, writes only `ptape:{wallet}` in
  LAB_STORE (the bar + its public source per fill, final). Served at `GET /agent/:a/tape`, on `/proof/paper/:axis`
  (Tape column + line, `paperRun(axis, state, tape)`) and Arena rows (`tape`, summed per operator). Paper exits stay
  market exits at the mark (no wick fills); this only proves the price was real. **Trigger check:** an SL/TP row with
  its level (`sl_percent` / `tp_percent`, exec stamps both, record only, pinned) also gets TRADED or MARK_ONLY (the exit
  fired on the mark, no trade reached the level). A fill > 3 days old Orderly refused on 3 runs = NO_DATA + reason.
  **Audit links + verify script** (borst 2026-11-26, the moat list): each tape mark on `/proof/paper/:axis` links the exact
  public Orderly request its check read (`entrySource` / `exitSource` on `paperRun` rows, + `slPct` / `tpPct`).
  `public/verify/paper-run.mjs` (served at `/verify/paper-run.mjs`, no deps, public reads only, fetches bars ONLY from
  `api-evm.orderly.org/tv/history`) re-judges every fill on Orderly's own bars (else on the bar the check kept, named),
  re-derives R, and checks a house wallet = its sha256 id. Its rule copies are pinned equal to paperTape / paperRun /
  housePaper by `verifyPaperRun.test.mjs`: change a rule there = change the script too.
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
  2026-11-13 timing on the public series (19 coins, local node, per pass): level_reclaim_tight 328 → 45 ms (`h4AtrAtHour`,
  a dense hour array + per-hour cache), oi_div_reversal / _4h 221 / 215 → ~75 / ~50 ms (cheap tests before the 30-day
  window; the brain's live gate shares it), all reads ~975 → ~400 ms; 581 live events identical. Kept references in
  explorerReads.test.mjs + oiDivReversal.test.mjs. Next slowest: funding_basis_split ~100, oi_coil_break ~75.
- **Built on a schedule, not in a request (2026-11-13, `scoreboardCache.mjs`):** the minute cron rebuilds the min-20 board at
  `SCOREBOARD_REBUILD_MINUTE` (:53) via `buildAxisScorecard(env, min)` (index.js; the route's old body moved unchanged) and
  stores it for 2h + a 24h last-good copy. A request serves the stored copy, builds only when none exists, and serves the
  last good one marked `stale` if that build fails (503 `scoreboard_unavailable` only with nothing stored). Check
  `[scoreboard] rebuilt in N ms` in the lab-api logs.
  **Never in a visitor's request (2026-11-21, borst: "$0, no wrangler/billing change"):** live timing found the cold build
  ~30 s and the Wire 1102-ing behind it. `serveScoreboard(…, { waitUntil })`: a copy older than
  `SCOREBOARD_REFRESH_AFTER_MS` (70 min, the cron missed) is served and rebuilt after the response; the served copy gone =
  the last good one at once, `stale` + "refreshing: built N min ago", rebuilt behind it (marker `…:rebuilding`, 120 s).
  Builds inline only with nothing stored. **The build itself −69% CPU (8.3 → 2.6 s on the public series), output
  byte-identical:** per-build caches in axisbt.mjs ("One build, many passes": each coin's price/candle/funding maps, the
  BTC context, each read's events per coin, `atrPctH4At` per candle map + hour, the basis runs), and
  `basisExtremeSeries` (basisFade.mjs: the same nearest-rank threshold from a sliding sorted window, the decision rule
  shared with `basisExtremeSide`, pinned to the per-row loop in basisFade.test.mjs). `axisbt.memo.test.mjs` pins the
  whole scorecard equal with the caches on / off / warm (`_setBuildCaches`, tests only). No lookback or rule was cut: a
  faster body must fire identical events. Never shorten history to save CPU (that moves grades).
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
  PAPER. **Nothing retires** (borst 2026-11-20, pipeline-if-then.md "Reads no longer retire"): the 100-event check
  (`failEvents`) is a `failing` label on the served row, set each build, never final; a failing read can't pass LEAD
  and never wears CLEARED. Archive = by hand only (`ARCHIVED_READS`, empty). Registrations are frozen by fingerprint
  (`app/lib/readFingerprints.mjs`, events on seeded tapes, `workers/nexus-lab-api/readFingerprint.mjs`; test-pinned),
  not by a signature; signing stays for the badge bar. **Badge bar v2** (`docs/research/badge-bar-v2.md`, SIGNED by borst in session
  2026-11-20 at 90%, pinned above Results by `app/lib/badgeBar.test.mjs`; BUILT 2026-11-20): a recorded paper
  PASS earns CLEARED only if its 30 trades beat ≥ 90% of 300 matched random entries (same coin, side, window, graded
  exit, fees; stored once at judgment); live-plan signing needs CLEARED under it. Rules `app/lib/badgeBar.mjs` (`BADGE_BAR`
  numbers pinned to the page by `badgeBarRules.test.mjs`, `randomVerdict`, `beatsRandom`, `badgeLine`); replays
  `workers/nexus-lab-api/badgeReplays.mjs` (`randomEntryCheck`: mulberry32 20261120, entry hour uniform over record start →
  30th exit, the backtest's own `exitLevelsAt`/`openPosition`/`stepExit` on `candle:hist`, 2.5 bps each side, no funding on
  either side; judged side = `exactPriceNetBps` = move − fees; ≤ 10 redraws, < 250 usable = UNREAD; ~130 ms). The hourly
  judge stores it as `randomCheck` inside `pjudge:{axis}` with a PASS only, once. `isCleared` (signalCard.mjs) requires
  it; `planSignRefusal` refuses `not_cleared`; the digest lists no live steps; the paper page + board row print
  `badgeLine` ("Didn't beat random entries on the same coins and side (N% of 300)"). Only out-of-sample events (after `registeredAt`) count; back-graded history never does. A changed rule
  = a new name + a new dated registration. Stage triggers = `docs/research/pipeline-if-then.md`, applied one PR per
  trigger from the SERVED stage. Registered reads: rsi_reset_deep, level_reclaim, oi_div_reversal, session_momentum,
  confluence_follow (from 2026-10-17); oi_div_reversal_4h and oi_coil_break (from 2026-10-28, their own prereg pages); batch 3
  (borst's go 2026-11-06, own prereg pages): `session_fade` (session_momentum's event traded the other way, a NEW read) and
  `level_reclaim_tight` (level_reclaim only when its H4 ATR ranks ≤ its own 30-day median) from 2026-11-08, `spot_absorb`
  (perp-led 4h move, spot the other way, OI flat → follow spot) from 2026-11-20; batch 4 (borst 2026-11-07):
  `btc_lead_lag` (BTC 1h move ≥ its own 30-day p90, an alt that moved < 0.75 of it follows BTC) from 2026-11-08, the
  first read on another coin's tape: the holdout line gets the main card's BTC set as CONTEXT only (`ctxSets` in
  axisbt `buildEvents`, never graded) and `funding_basis_split` (funding ≥ its 30-day p80 while the basis sits ≤ its
  30-day median → SHORT, mirror → LONG; 9 main coins, ARB/WLD have no basis) from 2026-11-08; lens read A
  (`docs/research/lens-reads-prereg.md`, signed by borst in session 2026-11-14): `smart_consensus_2x` (sm:hist row, lead
  ≥ 2, > the other, ≥ `CONSENSUS_RATIO` 2× it → follow; 24h) from 2026-11-15, the drawer's smart lens at its exact rule
  (the drawer prints its own oos count, `fadeGrade.mjs exactLine`); B forecast_divergence waits for 14 days of
  `forecast:hist:{COIN}` (`forecastHist.mjs`, hourly from 2026-11-14, recording only, the deepest 6 price-target markets
  a coin; read-only `GET /intel/forecast-history/:coin`; axisbt/explorerReads must not read it, test-pinned). Registered
  bodies live in `explorerReads.mjs`; unregistered drafts in `explorerDraftsB.mjs` (batch 2, `explorer-drafts-b.md`; tests
  fail if a draft is graded or axisbt imports it) and `explorerDrafts4.mjs` (batch 4, `explorer-drafts-4.md`: settled, A + D
  registered, B funding_settle_snap + C level_reclaim_weekly DROPPED; generators get axisbt's `ctx.btcCandles`;
  `powerCheck.mjs --batch=4`) and batch 5 = the two Bankr scanners, `scanner-reads-prereg.md`, **SIGNED by borst 2026-11-16 ("sign both"),
  registered from 2026-11-17T00:00Z**, bodies in `explorerReads.mjs` (`explorerDrafts5.mjs` now empty): `shelf_breakdown_short` (24h shelf untouched 12h, 1h close under it, 1h vol ≥ 1.5× 20-bar avg,
  07–21 UTC Mon–Fri, 4h trend DOWN, short-only; ~6 main-card events a month) and `bb_rsi_momentum` (1h close outside
  BB 20/2, RSI-14 > 60 / < 40, with the 4h trend vs EMA-20, no 3h-range burst > 2× the prior 24h; ~4 a day);
  `powerCheck.mjs --batch=5`; +57 ms a scoreboard pass on 19 coins, so watch `[scoreboard] rebuilt in N ms`; the breakout
  read never fires on the shared lookahead tape, so it has its own no-lookahead test; their calls post from the dedicated
  engine wallet `0xbce4…f432`, in `ENGINE_CALLER_ADDRESSES` since 2026-11-16; its key is held outside this repo).
  **Rule check** (borst 2026-11-16, `docs/research/scanner-rule-check.md`, rules `app/lib/ruleCheck.mjs`, route
  `GET /engines/rule-check/:wallet` routes-rulecheck.mjs, 10-min cache): for a wallet in `RULE_CHECKS` (test-pinned to
  engine wallets + registered reads), the scoreboard's own generators on its coins' `candle:hist` vs its public calls:
  POSTED (same coin + side, bar open → close + 2h, one call per setup) / SKIPPED / PENDING / OFF-RULE; unread tape =
  named, never a skip. Measurement only; /proof prints the line on the engine row. Never loosen the match to close a gap.
  **One-sided reads** (`one-sided-reads-prereg.md`, SIGNED by borst 2026-11-16, from 2026-11-17T00:00Z): `session_fade_short`
  and `oi_div_reversal_4h_long` = the parent's exact event on one side (found by reading outcomes, so counted forward only;
  overlap pairs with their parents). The registry runs each parent once per input series and shares it (`sharedRun`,
  explorerReads.mjs; session_momentum + session_fade too); each shared body names its rule in `.source`.
  `GET /agent/basis-history/:coin` = read-only basis:hist. A new registration also adds its read to `pipeline-stages.json`.
- **Trend gate (SIGNED by borst 2026-11-16, counts from 2026-11-17T00:00Z, limit 2027-05-17, `docs/research/trend-gate-prereg.md`
  pinned above Results; label + `TREND_GATE_STUDY` in `workers/nexus-lab-api/trendGate.mjs`; count
  `tools/explorers/trendGateCount.mjs`):** borst's "BTC under its 4h EMA-20 blocks longs", graded first like the stress
  study: the 13 reads registered at signing (4 named exclusions), each event labelled WITH / AGAINST BTC's 4h trend,
  time-shift null, Holm, 30/30; only AGAINST_WORSE licenses one reviewed block PR. **Judge built 2026-11-17**
  (`trendGrading.mjs`, pure, modelled on `stressGrading.mjs`: own seed `TREND_GATE_SEED` 20261116 golden-pinned; a shift moves
  BTC's whole trend series round the study circle, side + R fixed; judging time = 30/30 cutoff + 168h or the limit; interim
  Holm p ≤ α/13 in, > α out, else PENDING_HOLM; OOS = after the study start AND the read's own `registeredAt`; holdout d/p
  display only). borst's ruling 2026-11-17 (under the page's Results): at the limit, ≥ 20 on BOTH sides = judged as it
  stands (as stress R2). Run read-only: `node tools/explorers/trendGateJudge.mjs <dir> [at]`. **Served live as
  `trendGate` on `/intel/axis-backtest`** (2026-11-17, `trendStudy.mjs`, cache key v30): the stress study and this one
  share ONE build of their reads' events (`studyEventsFor`, the union of both lists; holdout with BTC as context only,
  checked identical for the 7 stress reads), timed at ~+100 ms a rebuild on the public series (judge ~3 ms). Only the
  judge, its wiring and index.js import the label (test-pinned); brain/exec import none. The daily watcher watches it
  like the stress study (2026-11-17, `TREND_TRIGGERS`, snapshot `trend`). Count at drafting: level_reclaim 115 of 121 events AGAINST in 60 days.
- **Stablecoin supply (`stable:hist`, `workers/nexus-lab-api/stableHist.mjs`, borst 2026-11-16):** DefiLlama's USD-pegged
  total, one row a day from 2021, read at most every 6h on the hourly cron; a broken or shorter reply is never stored.
  RECORDING ONLY (test-pinned: only index.js reads it); read-only `GET /intel/stablecoin-history`. Cloud sessions can't
  reach stablecoins.llama.fi; check the first live read through that route.
- **Each side on its own** (borst 2026-11-16, pipeline-if-then.md, `PIPELINE_RULES.sideMinEvents` 20 / `sidePct` 50): a
  two-sided read reaches EDGE only if each side with ≥ 20 oos main-card events also beats ≥ 50% of its own random replays;
  `next` names the trailing side. Added after the engine review found level_reclaim / oi_div_reversal_4h reached PAPER on
  their longs while their shorts trailed random shorts (13% / 24%). No served stage moved.
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
  `pipeline-watch/<date>`. It also watches `stressStudy` and `trendGate` (one helper, `diffStudy`): a read's verdict turning FINAL is the change
  (`STRESS_TRIGGERS` / `TREND_TRIGGERS`; record a dated line under that page's Results; WORSE's pause PR and
  AGAINST_WORSE's block PR stay borst's), a recorded final verdict is terminal.
  **The watcher merges its own `Pipeline watch:` PR** (borst's go, 2026-11-02) only when checks are green, it is mergeable, the change is display/record only, no parity DRIFT and nothing arms live money; any other session leaves watcher PRs alone. A scheduled task stores its own copy of the
  prompt: after editing the doc, update the task (`update_trigger`).
  **Backwards moves** (borst 2026-11-15, pipeline-if-then.md, rules `app/lib/promotionLock.mjs`): a served stage below the
  recorded one = the watcher records a promotion lock in the snapshot (`locks`) + the generated `app/lib/promotionLocks.mjs`
  (never edit by hand; a test diffs it). Paper keeps running; plan signing + the digest's after-PASS steps refuse while
  locked. Clears after 2 clean DAILY watcher reads at the lost stage or higher, ≥ 7 days apart, + ≥ 15 new oos events since
  the demotion; a failing read resets, a second demotion restarts. Each lock change is its own record-only watcher PR.
  level_reclaim + oi_div_reversal_4h locked 2026-11-15 (PAPER → REGISTERED, halves disagree).
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
  confluence_follow×funding_basis_split, smart_follow×smart_consensus_2x, oi_div_reversal×oi_div_reversal_4h (one rule, two windows). A filtered read and its
  parent are one bet, never stacked as two.
- `/intel/evidence?axis=&hold=` replays a preset across every mature market (pooled ≠ independent; say so).
- basis:hist had holes from our own OKX burst until the paced `snapshotFlow` fix: read older windows with that in mind.
- **Smart Money's STRETCHED FUNDING scan** (`ConvictionScanner.tsx`, rules `app/lib/conviction.mjs`, 2026-11-15): ordered by
  how stretched funding is (never by how many inputs agree), each input's lean in words (`leanWord`), the market's own
  past fades as a fact, the plain fade's grade on top; a tap opens the drawer. No conviction word (`convictionLevel` deleted).
- **Intel page + tape strip (2026-11-15, rules `app/lib/intelTape.mjs`, `app/lib/marketTape.mjs`, tested):** /intel (also the
  Lab's Market Intel tab) shows each input with its source: Fear & Greed, BTC dominance, total mcap 24h, funding breadth;
  markets past a STATED line (funding > +0.08% / < −0.03% per 8h, OI > 1.5× / 0.9× 24h volume on > $100k) ordered by how
  far past; positions with computed uPnL (never `unsettled_pnl`) + funding paid/received. No regime score, no "CONF %", no
  liquidation estimates, no LONG FLUSH labels on an account ratio, no advice. **Visual-first** (borst 2026-11-21, same
  rules as /proof; rules in intelTape.mjs, pieces `app/pages/intel/IntelVisuals.tsx`): a strip (Fear/Greed dot · funding
  breadth one mark per market · "past a line" count, uncapped; "Public inputs. Nothing graded here."; sticky on desktop
  only) → markets past a line as cards (number, the line as a tick on a 0 → 3×-line track, × the line; tap = the drawer)
  → the majors (funding NEVER without its percentile vs its own history, ticks 15th / 85th, a STRETCHED badge; the OKX
  account bar kept) → your positions → the table (funding coloured only past its line, OI ÷ vol as a dot on 0 → 3× with
  both lines as ticks, the flag as a badge) → "More" (how to read, dominance + mcap, also active, movers, lines, sources).
  Colour = state only (`SIGNAL.watch` past a line / extreme, ink otherwise); green/red only on your own P&L. Marks are
  dots and ticks, never a filling bar (test-pinned). The Thesis/Agent tape strip (`MarketTape`)
  = up 24h · BTC · longs pay, no RISK-ON score or preset advice. /intel and /arena skip the connect-wallet wall
  (`PUBLIC_ROUTES`, App.tsx).
- **The Read / Briefing / FADE:** show inputs, never a tally or crown of ungraded reads; the Board's FADE is "a
  mechanical rule, not graded yet" with the nearest graded relative's live grade (`app/lib/fadeGrade.mjs`).
  **The Board (`DecisionBoard.tsx`, Lab pass 2026-11-28, rules `app/lib/boardWords.mjs`, tested):** the other reads
  (callers / smart money / catalysts / forecasts) are listed in words (`otherReadsLine`), never counted: no "N of 4
  agree", no Confluence sort or highlight, no count in the default order (FADE → WATCH → rest, by funding stretch), no
  "reads confirm this" line in a drafted call, no RISK-ON / RISK-OFF tag; your record on the play's side is a count from
  5 trades (`sideRecordLine`); sides (your call / position marks) in ink.
  **The Briefing (`briefing.ts` + `NexusBriefing.tsx`, Lab pass 2026-11-28; pinned by `copyClaims.test.mjs`):** facts, not
  advice. No RISK-ON / RISK-OFF score (`computeTape`, a 50/40/10 blend, replaced by `computeBreadth`: "N of M markets up
  · BTC ±x%"); the old "fusion" ("Your setup", "where your edge lives", "Not your side · sit it out", the momentum
  "room to run") is ONE line: the stretched fade (server FADE over the floor) + "not graded yet" + the fade family's
  grade + the callers' lean + your record on that side from 5 trades; personal reads keep their numbers and drop the
  coaching ("press the edge", "that's tilt", "trade when you're sharp"); no "graded on-chain" for live agents; the
  record line says realized P&L as Orderly reports it (not "graded"); the flagged-setups coaching loop + coaching.mjs are
  deleted; the group label reads "Facts, not advice".
  **Deep boards (Lab pass 2026-11-28, pinned by `app/lib/deepBoards.test.mjs` + `boardWords.test.mjs`):** Positioning
  shows funding + wallets agreeing as "SAME WAY" (ids unchanged), never confluence / conviction / better odds; the funding
  board's ungraded FADE drops the scoreboard's ◆; Catalysts = "World events and the markets they touch", the event →
  market mapping a fixed rule, not graded, not "a trade you can take", grid fits a phone; Q Signals' conviction tier,
  "NEW" and model gap in ink (Quotient's labels, not money). Call side pickers (market table, Thesis Engine, Quick Trade,
  Catalysts, Q Signals, Positioning) are ink: a side is not money. Never call
  a read "proven" or "graded" unless the scoreboard grades that exact rule.
- **/proof layout:** verdict (the headline is a claim COMPUTED from the served stage, `proofHeadline` in proofCopy.mjs, since
  2026-11-05: "Nothing has proven itself yet" until a read is CLEARED (since 2026-11-17; before: served TRADEABLE/PAPER with
  positive exit net), then the read, trades and date; unread/stale board = no claim, never "proven"; `PROOF_BAR_LINE` whole) → status strip → lead cards → every read vs random
  (chart) → paper wallets → the board → folds (words, the market, the week) → calls + callers → agents/arena/desks/carry →
  ledger. **Reads half, visual-first** (borst 2026-11-21, rules `app/lib/proofLayout.mjs`): the strip (Cleared · Leads ·
  Still testing, sticky on desktop only) and the lead cards take the board's own groups (`useBoardGroups`, SignalBoard.tsx;
  nothing else calls `boardGroups`). A card never prints mean R without the random entry's beside it (pooled + per side,
  dot vs ring). Bars are tracks (dot = now, tick = bar) drawn from the served `pipeline.reads[].gates` (the `next` bars as
  data, `axisbt:v31`), never filling progress bars. Paper = a count of 30 only where a run exists, else "No paper run yet".
  **Plain words** (borst 2026-11-21, "way too complicated for a normie"; rules in proofLayout.mjs): a lead card = one
  word chip + "Beat random trades N% of the time." (`randomWord` / `beatSentence`, the backtest's own baselineVerdict
  cutoffs 95 / 80 / 5, < 5 trades = too few; chips bone / ink / amber, never green-red) → four tiles (new trades · beat
  random · its average · random average, the last two always side by side) → "To move up" = a checklist, one plain
  sentence per served gate with its number now (`gateLine`; holdout = "fresh coins") → paper count → sides on a tap.
  "Every read vs random trades" (`SideChart`) = one card per read, each side a word chip + trades + %, best first
  (`vsRandomCards`), 6 then "Show all"; no ruler, no tracks (test-pinned).
  One read table: the overview's left; each read's new-data sides open under its board row; Still testing is on a tap.
  **The board** (borst 2026-11-17, pipeline-if-then.md § "Board layout and the CLEARED badge"; `boardGroups` +
  `isCleared` in signalCard.mjs): "Every read, best first" = **Cleared** (served TRADEABLE/PAPER + no promotion lock +
  a RECORDED 30-trade paper PASS, read from `/signals/paper-judge/:axis`; empty = "Nothing has cleared yet.") → **Leads**
  (LEAD/EDGE/TRADEABLE/PAPER, not cleared) → **Still testing** (REGISTERED) → folds "Looked good on old data", "Worse
  than random" → **Archived** last (a failing read sits last in its own group; the board prints `NO_RETIRE_LINE` and
  `BADGE_RECHECK_LINE`). Inside the first three: furthest stage, then `numbers.beatsRandomPct` (NEW data, main
  coins; shown on the row as "beat N% of random"), then events; never in-sample. The badge word is CLEARED, never
  "proven"; only a CLEARED read may be marketed or promoted. A user's tweak is a new read, CLEARED only via its own signed
  registration. **The headline claims only a CLEARED read** (2026-11-17): `proofHeadline(sc, now, { judgments, locks })`
  runs `isCleared`; /proof's header + board read the verdicts via `usePaperJudgments` (sharedJson), the pulse reads
  LAB_STORE `pjudge:{axis}` + `PROMOTION_LOCKS` (`buildPulse(..., { locks })` for tests). Every place that shows the
  pulse's `signals` (landing, share card, boot snapshot, header) already gates on `headline.cleared`.
  Plain-words copy in `app/lib/proofCopy.mjs`; method in `HowWeGrade.tsx`. The tide (what a random long / short earned) sits
  in the folded "The market these reads ran in" (`MarketStats`) since 2026-11-21; `tideLine` stays in signalCard.mjs, and each
  side in a tapped card shows its random entry's R (`sideBar.randomR`).
  Registered/Lead rows themselves stay as pipeline-if-then.md "What we say" fixes them.
- **Weekly engine review** (borst 2026-11-16, `tools/review/engineReview.mjs`, tested): reads the public API only and writes
  one page (the tide, each registered read's sides vs a random entry on that side, paper wallets, engine callers); every
  sentence follows a stated rule (`sideWords`), plus an optional plain-text "This week" note. The scheduled task "Weekly
  engine review" (Mondays 10:37 Denver) runs it, writes the note and republishes borst's private review page in place.
- **Weekly scorecard on /proof** (borst 2026-11-16, signed section in pipeline-if-then.md; rules `app/lib/weeklyScorecard.mjs`,
  job + route `workers/nexus-lab-api/weeklyScorecard.mjs`, panel `WeeklyScorecard.tsx` under the board): hourly at :29 the
  worker builds the last complete week (Mon 00:00 UTC →) once from what it stores, under NexusLock `proofWeekly`, into
  LAB_STORE `proof:weekly:{week}` + `proof:weekly:index` (sha256 each); never rewritten. `GET /proof/weekly` (index +
  latest), `GET /proof/weekly/:week` = the stored bytes (`X-Content-SHA256`). New-data per-side vs random per registered
  read, stage moves, paper as COUNTS only, calls people/engines apart with MAE/MFE medians (calls only); no regime split
  until the trend-gate judge. No scheduled task or key writes it.
- **Engine overview on /proof** (borst 2026-11-17, signed section in pipeline-if-then.md "Engine overview"; rules
  `app/lib/engineOverview.mjs`, panel `EngineOverview.tsx` above the board): live from the scoreboard /proof already loads
  + the public paper routes. The market (random long/short R, BTC 30-day return, regime day counts), a side-by-side chart
  per side (each read's new-data mean R vs a random entry, % of replays beaten; main coins or the holdout, tap a row for
  its line), the read-by-read table (cards on a phone; one sentence per read by `sideWords`), paper wallets as cards
  (n of 30, each trade's outcome, tape line; no R sums, no dollars). The weekly review imports the same `sideWords`.
- **Sealed reads** (borst 2026-11-20, `docs/research/sealed-reads.md`, SIGNED in session, pinned above Results by
  `app/lib/sealedReads.test.mjs`): the in-house signal. Its rule lives in the PRIVATE repo `StephenBorst/nexus-house-signal`
  (never copy rule text, code or numbers into this public repo, a PR, an issue or a public page before its reveal); only its
  fingerprint is public (`sealFingerprint`, `app/lib/sealedReads.mjs`: sha256 over rule / code / params, each preceded by
  `name\nbyteLength\n`), committed here + posted by borst on X; counts from the next 00:00 UTC after both. On-chain
  anchoring stays OFF (borst "no", 2026-11-20). Each fire = a public call from the house wallet within 5 min, graded like
  any call on the frozen contract (1.2× H4 ATR stop, 1.5R, 168h); live only in the app. Same bar as every read
  (`PIPELINE_RULES`), then its first 30 calls after TRADEABLE judged by the paper-judgment rules; CLEARED → the headline.
  Until then a "House signal · testing" panel tops /proof. Revealed at CLEARED or borst's date; a hash mismatch voids it.
  **On record** (`SEALED_READS`): `house-1` ("House signal", fingerprint `b71e0dfd…0c6e`, posting wallet `0x76A2…B17B`,
  borst holds its key; committed 2026-11-20, PR #397). **X post WAIVED for house-1** (borst 2026-11-21, ruling under the
  page's Results; `xPostWaivedAt`): the GitHub merge is the outside date. **Poster live 2026-11-22T19:23:28Z** (borst's
  second ruling, same Results; `posterLiveAt`, the private worker's first deploy): no sealed read counts before its poster
  runs, so the start = next 00:00 UTC after the latest of commit / outside date / poster → **house-1 counts from
  2026-11-23T00:00:00Z** (`sealedCountsFrom`; no `posterLiveAt` = not started). A later sealed read still needs its X
  post unless borst rules again. The poster = private worker `nexus-house-signal` (cron minutes 1–4, `MODE` dry | live in
  its wrangler.toml, deployed by hand from its Actions tab). **Dry runs are logged** (`sealed:dry:{name}`, last 50,
  signature-checked, never a fire or a call; `dryRuns` on `GET /sealed/:name`).
  **Fires → calls** (`POST /sealed/fire`, `routes-sealed.mjs`, rules `app/lib/sealedFire.mjs`): the private worker sends
  `{name, coin, side, fireAt}` signed by the read's OWN wallet (`sealedFireMessage`); lab-api builds the call in public
  (entry = Orderly mark, stop/target from `gradedExitLevels` on Orderly's last 81 hourly bars, `timeStopH` 168) and seals it
  into that wallet's Lab record via prepareSeal → commit. Refused: not started (unless `dryRun`), off-the-hour time,
  duplicate, same coin + side inside 24h; > 5 min late = a MISSED row, no call. NexusLock `sealedFire`. Log LAB_STORE
  `sealed:log:{name}`, public at `GET /sealed/:name` (posted / missed / every fire).
- **House caller is OFF** (`HOUSE_SIGNALS_ENABLED` deleted; gates the Catalyst caller too). Check "off" by reading
  `enabled` on `/signals/house` and `/signals/catalyst-house`, never by a quiet run. `POST /signals/house` with
  `HOUSE_SIGNALS_ADMIN` still posts by hand regardless. Keep `HOUSE_CALLER_ADDRESS` set (the dedupe reads it). On again
  only for a read that clears.
  **CLEARED-read house caller** (borst 2026-11-27, `workers/nexus-lab-api/readHouseCaller.mjs`, rules `app/lib/readHouseCall.mjs`):
  btc_lead_lag from its OWN wallet `HOUSE_READ_CALLER_ADDRESS` (0x65eC…C0C8, wrangler.toml; key held by borst, never used
  here: calls are sealed server-side). OFF until the read is CLEARED: every run (minutes 8/23/38/58) re-reads the paid
  feed's gate (`soldReadGate`); refused = nothing read or posted. Graded contract (1.2× H4 ATR, 1.5R, 168h), one call per
  event, 24h per coin + side, ids `houseread-…` (callDedupe proof). Left out of pulse + weekly counts. Status `GET
  /signals/read-house` (never signals). house-1 (`0x76A2…B17B`) and HOUSE_CALLER_ADDRESS untouched.

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
- **What the lenses showed at the post (2026-11-14, `workers/nexus-lab-api/publishLens.mjs`):** like `publishMark`, a
  call's FIRST publish pins `publishLens` on its registry entry (a `SERVER_FIELDS` member): the smart-money 2× rule
  (`sm:consensus`) and the funding stretch (`intel:mispriced:v1`, else its last-good copy), via `marketSnapshot`; KV
  reads only inside `prepareSeal`, never blocks a publish; a snapshot older than 2 min is refused. Stats' **YOUR CALLS
  VS THE LENSES** (`LensRecordCard`, rules `app/lib/lensRecord.mjs`) splits graded calls with / against each lens;
  averages only at `LENS_MIN` 5 a side. The trader's own record, not a grade of the lens.
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
- **Declared plans v2** (borst 2026-11-16, `callMath.mjs` `PLANS_V2_FROM_MS`, forward-only, no `GRADE_V` bump; tests
  `workers/nexus-lab-api/gradePlansV2.test.mjs`): `exitPlan:"SPLIT_50_BE"` = half at TP1, then the runner's stop moves to
  the entry and trails `TRAIL_R` 1R behind the best 1-minute close since TP1 (closes before the bar; never loosens; trail
  checked before TP2; fills at the trail), closing at the trail or an optional TP2: WIN 0.5·R1 + 0.5·runner R ≥ 0,
  `exitReason` TRAIL / BE (logic.mjs `beRunner`); the open runner stamps `trailStop`. `fillWithinH: N` (1–168) = an
  entry not traded by post + N h is EXPIRED, and a BREAKOUT entry (publishMark between stop and entry) whose stop trades
  first is EXPIRED `STOP_FIRST` (`entryFill`); a limit is never voided that way. EXPIRED = `fillState`/`status` "EXPIRED"
  + `expiredAt`/`expiredReason`, NOT a grade (no `gradedOutcome`, counted in no record), `isSettled` (grading.mjs) drops
  it from the minute index, the owner gets one `call_expired` note. Minute trigger: a due window (`meta.fw`) and an open
  runner (`meta.be` + `meta.h`, any new bar). On-chain tags `#SPLIT_50_BE` / `#FILL_<N>H`, matched EXACTLY (a substring
  match would read `#SPLIT_50_BE` as `#SPLIT_50`). BE refuses a time stop. Thesis Engine: EXIT PLAN + ORDER EXPIRES
  pickers in Fine-tune (`quickCall.mjs` `EXIT_MODES`, `FILL_WINDOWS` 4/12/24); copies keep both (`copiedFillWindow`).
- **+0.5R reached** (2026-11-16, `callMath halfRLevel`, `HALF_R_FROM_MS` 06:00Z that day, forward-only): an OPEN call whose
  bar after the fill trades entry ± 0.5 × its own risk gets `halfRAt` (server field, kept once set) and ONE `call_halfr`
  note ("ETH LONG is +0.5R (105) · still open: graded at TP1 … or the stop …"), push topic `calls`. Never for TP1 ≤ +0.5R,
  never after TP1. Display + alert only: no stop or grade moves. The minute index carries `hr` until it's reached.
- **MAE / MFE in R** (borst 2026-11-16, rules `app/lib/excursion.mjs`, tested): how far a trade went against / for it
  while open, in its own R. Calls: the grader stamps `maeR` / `mfeR` (GRADE_FIELDS + SERVER_FIELDS, `callExcursion` in
  grading.mjs) from the bars after the fill bar to the exit bar, the exit bar only up to the call's own levels (stop 1R,
  the target it closed at); minute precision on minute-graded calls; forward-only (settled calls aren't re-graded). The
  call page prints a PATH line. Paper: `paperRun(…, { candles })` gives each closed trade `maeR` / `mfeR` from candle:hist
  after its entry hour (`paperExcursion`, risk = `sl_percent`); the paper run page's "Against / for" column, per trade,
  never summed. Display only: no rule tightens on it; a tighter rule found here is a new registered read.
- **Stale reads** (2026-11-21, `app/lib/staleReads.test.mjs`): the call page, the trader profile and the sim status poll
  guard every write after a fetch (`live` / `stop`), so tapping from one call / trader / run to the next before the
  first read lands never shows the first one's data on the second's page.
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
- **On-chain → Lab watchdog** (borst 2026-11-16, `workers/nexus-lab-api/regWatch.mjs`, lab-api */5 cron): reads new
  ThesisRegistry logs on the public Arbitrum RPC; a registration still missing from its wallet's Lab record 5 min after it's
  first seen is indexed through `indexRegistration` (the /theses/index path, same proof + seal) and the owner is Telegrammed
  (`sendOwner`); refused / too old / unconfirmed after 12 runs = one alert; blind for 6 runs = one alert. Failed sends are
  kept and retried. State LAB_STORE `onchain:regwatch:v1`. A call left out past `INDEX_MAX_AGE_MS` (6h) can never be indexed.
  Logs are read from secret `ARBITRUM_RPC_URL` or `ARB_LOGS_RPC` (either; /wallets/onchain reads both) first, then the public
  endpoints (`PUBLIC_LOGS_RPCS`); a 429 backs off 0.5/1.5/4 s then tries the next endpoint (`makeLogsRpc`, 2026-11-16: the
  public RPC 429'd 6 runs in a row from the shared Worker IP). An endpoint that refuses (token / archive / key, 401/403:
  publicnode without its free Allnodes token refuses getLogs past ~10 blocks) or caps getLogs ≤ 2,000 blocks is skipped for
  the next (`isProviderRefusal`, `PROVIDER_MIN_SPAN`). A range cap is read BEFORE the refusal words (2026-11-17: drpc's
  "ranges over 10000 blocks are not supported on free plan" read as a refusal, so the cap could be lost behind another
  endpoint's error and the scanner never halved); only 401/403 skips first. Since 2026-11-17 (evening, blind again after the
  token URL went in): a range cap no longer stops the others, every endpoint is tried at that size before the scanner halves
  (`e.range`); any other odd reply moves on to the next endpoint; and a final failure names EVERY endpoint's reply (`e.tried`,
  the token's path/query scrubbed), not just the last one (drpc always took the blame). The alert keeps 480 chars of it. When neither variable reaches the worker (unset, a dashboard TEXT variable a deploy wiped, or not an https:// URL),
  the failure starts with that line (`ownRpcNote`, never the value; quotes around a pasted URL are cut) and
  `/wallets/onchain` carries `ownRpc: "in use" | "not in use"` (2026-11-17: the token URL was set yet never used). nexus-ledger-anchor also reads `ARBITRUM_RPC_URL` (anchor txs + gas
  balance: latest state only, no archive). 10k blocks a call, halving on a range refusal; a run that
  made progress isn't counted blind. `/wallets/onchain` reads through the same `makeLogsRpc` (one 300 ms wait, it runs in a
  request). The daily digest prints the watchdog's line (`watchdogLine`: reading / blind + last read, calls indexed late in 7 days).
- **Reads:** `GET /theses/leaderboard` (≥5 graded, net-positive R; an empty board is correct when nobody qualifies:
  check `/theses/process/:wallet` before debugging), `/theses/status/:wallet`, `/verify/:wallet/:id` (the grader
  re-run), `/theses/ledger` (+ chain; on-chain anchoring off). Fill/TP1 alerts go out from the pass that stamps them (hourly, or the minute grader).
- **Trader profile** (`/feed/trader/:wallet`, rules `app/lib/profileRecord.mjs`, 2026-11-15): calls = the wallet's own
  published rows from /feed (`profileCalls`: no agent rows, which carry "Nexus Agent", no resolution rows); the WIN RATE /
  AVG R tiles read the grader's record (`/theses/process`, one shared request) like the share card and rank
  (`recordTiles`); no "BEST R:R"; the agent card = LIVE trades booked at the fill, not a graded record.
  `/agents/standing/:addr` takes a 0x address only (it feeds a Supabase `ilike`; "%" summed every wallet).
- **Risk in R** (borst 2026-11-16, rules `app/lib/recordRisk.mjs`, tested): from the grader's record (`computeCallerStats`
  `a.resolved`, ordered by CLOSE time `closeAt`): profit factor (null = no loss yet, never infinite), max drawdown of the
  running R total, worst losing run, expectancy + 95% range (mean ± 1.96·sd/√n). Shown only from `RISK_MIN_CALLS` 20
  graded calls (else "N so far, M to go"); a range that includes zero says "not yet distinguishable from break-even". No
  Sharpe (calls aren't evenly spaced returns). Served as `risk` on `/theses/process/:w` and `/theses/leaderboard` rows;
  `RiskRecordCard.tsx` on trader profiles + Lab Analytics (`WalletRiskCard`), `riskBrief` on /proof caller rows.
- **Ranks:** only graded callers, in the grader's order, then emerging unranked. No self-scored REP anywhere; Rep Score
  code is deleted. Merit ranks (`rankCaller`): Signal / Sharp / Apex. Identity card = `app/lib/identityCard.mjs` on
  `loadIdentity`; no badge unless the grader gave one.
- **Copy Trades tab** (`CopiesView.tsx`, borst 2026-11-26, rules `app/lib/copyMatch.mjs`, tested): a copy is PRIVATE and
  the grader grades only public calls, so a copy never gets its own grade (the tab used to say "3 open" forever). Each
  copy reads its ORIGINAL from /feed (`findOriginal`: the `copiedFromId` both copy modals save since 2026-11-26, else the
  caller's public call with the same coin / side / entry / stop posted before the copy) and shows the grader's outcome in
  words (`originalState`), what you changed from the caller's plan (`planDrift` / `driftLine`: "the original's grade is
  the caller's plan, not yours"), how late you copied and whether its entry had already traded (`copyTiming`), and per
  caller "Their originals: …" (`originalsLine`) + the grader's risk lines from `/theses/process/:w` (`riskLines`).
- **Trading Log tab** (`TradeLog.tsx`, borst 2026-11-26, rules `app/lib/tradeLog.mjs`, tested): the account's closed
  Orderly positions (`/v1/position_history?limit=500`, realized P&L as Orderly reports it) by local day. One win rule
  everywhere (P&L > 0; $0 = flat, in neither filter); the calendar card = the MONTH on screen (`monthStats`; it used to
  print all-time P&L beside the month's days); TODAY works; prices via `fmtPrice` (4 sig figs under $1, never "$0.00");
  search = coin, "2026-11-05" / "nov 5" / "11/5", or a month; the day view = net, best / worst trade, net per coin, hold
  time; `coverageLine` names Orderly's 500 cap. Direction in ink, no decorative dots, no filling bar.
- **Analytics tab** (`AnalyticsView.tsx`, borst 2026-11-26, rules `app/lib/analyticsRules.mjs`, tested): rows sorted
  oldest → newest once (`chronological`; the curve + bars plotted Orderly's own order under an "oldest → newest"
  label); every dollar signed (`perfRows`: avg loss / worst trade used to print "$13.70"); NO Sharpe / Sortino (uneven
  dollar trades; YOUR RECORD carries expectancy / PF / payoff / drawdown); best hours = hours with ≥ `SLICE_MIN_TRADES`
  trades by net $ (`peakHours`; one lucky trade used to top it), the strip in ink by count; weekdays vs weekends with
  "—" for none (`weekSplit`); win rates in ink; ONE strengths / leaks list (WHERE THE MONEY GOES; the edge card's own
  3-trade list is gone); the 500 cap named (`coverageLine`). The deep fold's PERFORMANCE ANALYSIS card is gone (dupes).
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
- **Holders gate:** `POST /feed/holders {address, ts, sig}` (since 2026-11-27; GET = 405, the signature used to ride in
  the URL) = signed challenge (`holdersRoomMessage`, one copy in `app/lib/holdersRoom.mjs`, shared.mjs re-exports it) +
  on-chain `balanceOf ≥ OPERATOR_MIN`; `OPERATOR_MIN` must match the frontend OPERATOR tier (50M). No Base RPC answer =
  503 `balance_unread`, never "not a holder". `lab:*` paged to the end (`kvList.mjs listAllKeys`), the built feed kept
  60 s (`feed:holders:v1`). The room (`HoldersRoom.tsx`, rules holdersRoom.mjs, tested) signs with the CONNECTED
  wallet's provider (`useLabWallet`), an unread balance says so (never "LOCKED"), the lock names your balance + what's
  left, and each row shows levels, the note and "The author marks it: …. Not graded." (holders calls are private, so
  the grader never grades them); direction + R:R in ink.
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
- `GET /agents/ledger` + chain (hash-chained in lab-api). **On-chain anchoring is OFF** (`ONCHAIN_ANCHOR_LIVE = "false"` in
  nexus-ledger-anchor + lab-api wrangler.toml; borst 2026-11-26 "keep it off, $0"): `NexusLedgerAnchor`
  `0x57a698df84a44F3dA3dac3E08CA455a55A4eff84` (dedicated signer, `ANCHOR_PRIVATE_KEY`) is deployed but posts nothing;
  never say "anchored on Arbitrum" in copy. The call-ledger hash has a fixed field list: changing it breaks the chain.

## Engagement surfaces
- `/agents/live` (uPnL from public marks; humans opt in via signed `POST /live/publish`, ~6-min TTL), Desks (score =
  members' graded calls via `computeCallerStats`), `LiveAlerts`, watch-only banner. Sparse at cold start by design.
- **Lab pulse** (`GET /calls/pulse`, `routes-pulse.mjs`, rule `app/lib/callPulse.mjs`, 5-min KV cache, CORS `*`):
  open calls (entry traded) + graded in 7 days + the last grade + the /proof headline read from the scoreboard's
  own cache (`axisbtCacheKey`). **People and our engine callers counted APART, never blended** (borst 2026-11-05):
  top-level = people, `engines` = the wallets in worker var `ENGINE_CALLER_ADDRESSES` ("Ember", "Ember M", the Bankr scanners' `0xbce4…f432`); both house callers (`HOUSE_CALLER_ADDRESS`, `HOUSE_CATALYST_ADDRESS`) left out; no copies. Rows carry the
  caller's display name (`caller`) + `engine`; `engineRecords` = each engine's all-time graded record (graded, wins, net R; since 2026-11-16 EVERY engine wallet with
  a Lab record gets a row, + `posted` and `lastPostedAt`, pulse v6)
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
  (`LabPulseChip.tsx`, → /proof), the Wire's call rows and the landing hero's record panel. Lab home has NO Calls panel
  (removed borst 2026-11-21: home = Wire → table → risk → Watching → briefing → board). A quiet week shows the last grade's age, never a fake number.
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
  **Caller pipeline:** /proof's "𝕏 Share this week's record" posts `recordShareText` (`app/lib/recordShare.mjs`: pulse counts,
  people and engines apart, the cleared read's paper count; unreadable pulse = no link). The post links
  `og.nexustradinglabs.com/share/record?v=<day-hash>` (`recordShareLink`), which unfurls into the 1200×630 card
  `/og/record.png` (`routes-recordshare.mjs`, `recordCard`; counts only, no green/red; an unreadable pulse = an honest
  "counts unavailable" card that claims nothing about the signals) and forwards people to /proof.
- **Market drawer (borst 2026-11-14):** every lens on one coin in one panel. `openMarket("ETH")`
  (`app/lib/marketDrawerEvent.mjs`) from anywhere; `CoinLink` turns a coin name into that tap (Board, Smart Money,
  Forecasts); `MarketDrawer.tsx` is mounted once in App. One request: `GET /intel/market/:coin` (`routes-market.mjs`)
  composes /intel/mispriced, /signals, /smart/consensus, /theses/consensus, /intel/forecasts/:coin,
  /intel/catalysts-board, /calls/pulse and /intel/axis-backtest through the worker's OWN handler in-process (the default
  export is the named `worker` object), 60 s cache, a failing board = that lens unread. Rules `app/lib/marketRead.mjs`:
  inputs only, no tally; each lens prints its nearest graded relative's live grade or "not graded"
  (`fadeGrade.mjs lensGradeLine`). **Market alerts** (`app/lib/marketAlerts.mjs`, runner lab-api `marketWatch.mjs` on
  the */5 cron): "Alert me on ETH" in the drawer; push switch `markets` (OFF by default) + ≤10 coins on the device
  record; fires only on a CHANGE (funding stretched, 2× consensus formed/flipped, forecast ±15 pts, or an UNUSUAL MOVE),
  first look = baseline; tap opens `/lab?tab=intel&market=ETH`. **Unusual move** (borst 2026-11-23, rules
  `app/lib/unusualMove.mjs`, tested): the coin's 4-hour move past its OWN 10th / 90th percentile of 4-hour moves over 90
  days (Orderly hourly bars, overlapping windows, ≥ 500 samples, lines kept 6h per coin in LAB_STORE `move:lines:v1:{COIN}`;
  the move now from the last hourly bars each run, paced). Measured, never the ProjectionBand's bell-curve 25–75% box
  (crossed half the time by construction). Once per side per coin per 4h (`moveDue`, stored as `um` in
  `push:marketseen:v1`); unread bars = no alert. Message says how rare in words + "A move, not a signal." **Speed:** `sharedJson` (`app/lib/sharedJson.mjs`) shares one
  request per URL for 30 s; the FADE line reads `GET /intel/fade-grade` (not the 200 KB scoreboard). Lens reads to
  grade exactly: `docs/research/lens-reads-prereg.md` (A `smart_consensus_2x` signed 2026-11-14, counts from 2026-11-15; B unsigned).
  **Drawer → call** (`app/lib/marketCallDraft.mjs`): "Post a call" asks Long / Short IN the drawer (it never picks one),
  hands off via `nexus_thesis_draft` with `sideChosen` (the WATCH gate keeps the trader's pick) + `build` (the Thesis
  Engine builds at the 1.2× ATR stop on arrival, `pendingDraft`), levels of the last coin cleared, no machine note.
  **Watching** (`app/lib/watchlist.mjs`, store `watchStore.ts` key `nx_watchlist_v1`, panel `WatchlistPanel.tsx` above
  the briefing on Lab home): ☆ Watch in the drawer (this device, no wallet/push, ≤10); one request `GET /intel/markets?coins=`
  (routes-market.mjs `handleMarkets`: mispriced + smart + forecasts read once, `marketSnapshot` per coin, 60 s cache);
  each row = price, 24h, the move since the last look + the alerts' changes (`marketTransitions`); first look = baseline;
  tapping a row opens the drawer and marks it seen.
- **Forecast Divergence = the crowd vs the coin's own history (borst 2026-11-23, rules `app/lib/forecastOdds.mjs`,
  tested):** each price-target market on `/intel/forecasts` (cache key `intel:forecasts:v2`) carries `history` = how often
  the coin itself made that move in the time left, from each start day of its last year (Orderly DAILY bars,
  `forecastBars.mjs`, one read per coin, cached 6h; "reach / hit / dip to" = a touch, "above / below" = a close; overlapping
  windows, ≥ 60, a base rate, not a fair value) + `crowdGapPts` = YES − that rate. `forecastLean` is set ONLY past
  `GAP_PTS` 10 (the direction the crowd is more sure of than history); `divergence` = that lean against funding's, near
  money. The OLD FOLD is gone (YES < 50% on an up strike read as "leans DOWN", so "12% BTC climbs 14% this week" was
  called bearish). No bars / no end date = no lean, never the fold. One rule for every reader: the tab, the drawer's
  forecast lens (`forecastRead`), the table's forecast column, DecisionBoard, the share card. The tab
  (`ForecastDivergence.tsx`): `OddsTrack` (crowd dot vs history ring on 0–100%), `forecastChip` (amber only for crowd vs
  funding), the plain read, Long / Short via `handOffCall` source `forecast-divergence` (it used to pick the crowd's side
  and write the note), ProjectionBand `showLean={false}`; leans in ink, never green/red. **Lens read B
  (`forecast_divergence`, lens-reads-prereg.md, unsigned) was drafted on the old fold:** register it on THIS rule under
  its own new page, not that text.
- **Funding across venues (2026-11-15, rules `app/lib/crossFunding.mjs`, route `GET /intel/funding-venues[/:coin]`
  `routes-venues.mjs`, 5-min cache `intel:venues:v1`):** the same coin's funding on Orderly (from /intel/mispriced,
  in-process), Hyperliquid (one `metaAndAssetCtxs` POST, hourly rate) and OKX (`funding-rate` per coin, paced, recorded
  universe only), each annualized from its own period; gap = Orderly − the others' average. A dead venue = named in
  `unread`, its column null, never 0. Lab home lens "Venues" (`FundingVenues.tsx`) + the drawer's "Funding elsewhere"
  lens (MARKET_SOURCES `venues`). An input, "Not graded" (`UNGRADED_LENSES`); copy never says arbitrage/free/edge.
- **News wire (borst 2026-11-20, "our news section is buried"; rules `app/lib/newsWire.mjs`, route `GET /intel/news[?coin=]`
  `routes-news.mjs`):** lab-api reads 7 feeds itself (CoinDesk, Cointelegraph, Decrypt, The Block, CNBC, MarketWatch,
  the Fed's press releases; Blockworks, Yahoo + DL News dropped 2026-11-20 after failing live; no third-party relay sees the reader) at most every 5 min, keeps a rolling 48h wire
  in LAB_STORE `intel:news:v1` (a feed that fails keeps its stories until they age out and is named in `unread`, its
  source row carries `err`, e.g. "http 403"), one story once (id or title), ≤15 a feed. Each story is tagged with the coins it names
  (`newsCoins`: tickers in capitals as their own word, names any case; index + commodity perps SPX500 / NAS100 / XAU / CL by
  name only ("digital gold" never counts); ambiguous tickers like LINK/NEAR/OP/DOT/HYPE only
  with "$" or by name). Re-stamped clusters (4+ at one second) and future times = undated (sink below). Only http(s)
  links are served. `NewsWire.tsx` = the "All headlines" board (opened from the Wire)
  and Market Intel's NEWS tab; a coin tag opens the drawer. Headlines, never a direction or a tally. Cloud sessions
  can't reach the feeds: check `unread` on the live route after a change.
- **The Wire (borst 2026-11-20, terminal step 2; rules `app/lib/wire.mjs`, route `GET /intel/wire` `routes-wire.mjs`, 60 s
  cache `intel:wire:v1`):** FIRST on Lab home (`TheWire.tsx`): what changed in the last day, from every board, on one
  clock. In-process reads: the news wire, the bell (`/intel/bell`), EVERY registered read's paper run (house runs
  included, `readRows`), tracked wallets' moves ≥ $10k (`/smart/events`), graded calls (`/calls/pulse`, people and engines
  named apart) + "Coming up" from `/intel/calendar` (next 12h). Standing conditions (funding past its line, the trend row)
  are dated when FIRST seen (`intel:wire:seen:v1`), so they don't sit on top forever. Each row keeps its own source and
  grade line (headline / call / wallet lines say what they are not); filter chips; no tally, no direction. A board
  that fails is named in `unread`.
  **Served stale-while-revalidate** (2026-11-21, `workers/nexus-lab-api/swrCache.mjs` `swrServe`, also the bell and the
  table): a copy < 60 s is served as is; an older one at once, refreshed after the response (`ctx.waitUntil`, one at a
  time via `…:refreshing`); kept 1h; a request builds only with nothing stored; the table never stores an empty build.
  **Drawn at once on the device** (`app/lib/lastCopy.mjs`, `nx_wire_last_v1` / `nx_table_last_v1`): the last board read,
  ≤ 6h old, drawn on mount with its own `builtAt` age, replaced by the live read; a failed refresh says "Couldn’t
  refresh: this is the copy from N ago".
  **Your calls on the Wire** (borst 2026-11-21, `myCallRows` / `withMine`): with a wallet connected, TheWire.tsx reads
  its own `GET /theses/status/:wallet` in the browser (the shared route never carries a wallet, test-pinned) and merges
  "Your call" rows (kind MINE): a resting entry that traded later (a fill at the post isn't news, as `fillEvents`),
  TP1 on a split, the grade (WIN/LOSS in R, TIME/TRAIL/BE named), each at the grader's own stamp, last 24h. The public
  row for your own graded call is dropped; a "Mine" chip shows only with a wallet; unread = "your calls" in `unread`.
  Also +0.5R reached (`halfRAt`) and orders that expired unfilled ("not a win, not a loss"): the status reply carries
  `halfRAt` on each row and an `expired` list (callStatus.mjs / routes-callstatus.mjs, 2026-11-21). **New since your last
  look** (`wireSeenSplit`, key `nx_wire_seen_v1`): the time this device last opened the Wire, read once on mount and moved
  to now after the Wire loads; "N new since your last look" + a SEEN BEFORE rule; first visit = no split.
  **Ask Nexus reads the Wire** (`get_wire`, `wireForCopilot` in copilotLab.mjs): the same rows via `withMine`, filters
  + a coin, each row's source and grade line, the next 12h, `unread`; it READS the Wire's baseline, never sets it (test-pinned).
- **⌘K command line (2026-11-20, rules `app/lib/terminalCommand.mjs`, `CommandPalette.tsx`):** a coin ("eth", "$ETH",
  "spx500") → its drawer (every lens + "News on ETH", `NewsWire compact`) or Trade; a 0x address → its X-Ray; "news" /
  "wire". A coin the news wire knows leads; any other ticker-shaped word comes after the menu's own matches.
- **Market table (borst 2026-11-20, terminal step 4; rules `app/lib/marketTable.mjs`, route `GET /intel/table`
  `routes-table.mjs`, 60 s cache `intel:table:v1`, UI `MarketTable.tsx` "Every market"):** Lab home order = the Wire → the
  table → YOUR OPEN RISK. One row per Orderly perp with ≥ $30k OI (`TABLE_MIN_OI_USD`, ≤ 40, thinner ones counted), from
  ONE all-markets read (`fetchAllFutures`) + in-process venues / smart consensus / forecasts / news / every read's paper
  run (`readPaperRuns`, shared with the Wire). Columns: funding 8h, OI ÷ 24h vol, venue gap, smart (the 2× rule),
  forecasts leaning against funding, news 24h, reads holding a paper trade, OI. Default order = OI; any header sorts
  (funding and gap by size, nulls last). A cell past the Intel tape's stated line is marked (`SIGNAL.watch`); no
  combined score (test-pinned). A failed source = its column "unread", never 0. A row opens the coin's drawer.
  **Your coins first** (borst 2026-11-20, `yourCoinsFirst`): coins on the device watchlist (`nx_watchlist_v1`, the drawer's
  ☆ or the ☆ on a row, ≤ `WATCH_MAX`) stay on top under "YOUR COINS" whatever the sort, sorted among themselves by the same
  column; the rest sort underneath. A watched market under the OI floor still pins from `others` (marked "thin"); one
  Orderly doesn't list is named, never invented. No new data. The footer names the sources + the build's age.
  **Table → call** (2026-11-21): "Call" on each row asks Long / Short right under it (the table never picks a side), then
  `handOffCall` (`app/lib/callHandoff.ts`, the ONE hand-off the drawer uses too) writes the `marketCallDraft` (source
  `market-table`) and opens the Thesis Engine, which builds levels from live price; the trader posts.
  **Activity dots** (2026-11-21, `yourMarks` / `openCallCoins`): on WATCHED rows only, ● = the connected wallet's open
  public call on that coin (`GET /theses/status/:wallet`, the Spot chips' source), ○ = its open Orderly position (SDK
  `usePositionStream`, in the browser). Facts about you, never the market; no wallet / unread = no dot.
  **Since your look** (2026-11-21, `sinceLook` / `sinceLookCell`): a watched row prints "−2.07% since your look 45m ago",
  the table's price vs the Watching panel's baseline (`seen[COIN].price` / `.at`, this device). READ only: the panel's tap
  moves the baseline, the table never does (test-pinned: no markSeen / writeWatch in MarketTable.tsx). No baseline = no line.
- **Callers on the coin (borst 2026-11-20, rules `app/lib/coinCrowd.mjs`, `app/components/CoinCrowd.tsx`):** every coin
  panel (drawer + dock) shows "Callers on X · N positioned · M open calls · K takes this week": `GET /theses/symbol/:coin`
  (the Spot strip's route: open positions + active public calls, each caller's graded record via `callerRecordLine`, rows
  → `/feed/trader/:w`) and `GET /takes/hot` filtered to takes whose `sym` names the coin (UNGRADED, labelled). A plain
  count, never a crowd side (test-pinned: no lean / long-short counts); an unread source says "unread", never 0.
- **Desktop terminal (borst 2026-11-20, "Wire, table, and coin panel side by side so one coin stays on screen"):** on a
  Lab home ≥ 1280 px wide (`wide = !useIsMobile(1280)`), the Wire (sticky, left 300 px) · the market table + its deep board
  (centre) · `MarketDock.tsx` (sticky, right 380 px). The dock IS the drawer's body (`MarketPanel`, exported from
  `MarketDrawer.tsx`, `modal` = the overlay; docked = no close button); it opens on the first watched coin, else BTC, and
  while it is mounted `setMarketDock` (app/lib/marketDrawerEvent.mjs, tested) routes every `openMarket()` tap into it
  instead of the overlay. Narrower screens = the same pieces stacked; coins open the drawer. The panel prints the read's
  age ("Read 40s ago", `builtAt`).
- **No lens strip (borst 2026-11-20, "fold the old lens strip into the table and the coin drawer"):** Lab home's chip
  strip is gone. `app/lib/intelLenses.mjs` is now the BOARD registry (ids kept so `/lab?lens=<id>` still opens one): each
  board has a `home` (`wire` = All headlines, The week ahead, World events; `table` = Funding / Venues / Positioning /
  Forecasts, each also behind its column's "Full board →", + Q Signals and the Market tape) and opens under the table
  (`DeepBoard.tsx`, one at a time, Close). Per coin, every one is already a lens in the drawer. Test-pinned: no
  `<IntelLenses`, every board rendered, every opener at its home.
- **Risk desk (2026-11-15, rules `app/lib/riskDesk.mjs`, read `app/hooks/useRiskDesk.ts`):** the connected account's
  open positions from the SDK (position stream, collateral, est. funding, each market's `funding_period`), in the
  browser only (test-pinned: no fetch). Per position: liquidation % away (≤5 = warn, ≤10 = watch), what the resting
  full stop loses (a stop past liquidation never fires = warn, and counts as uncapped), funding $/day. The book: exposure
  ×, net, at your stops % of account, same-side bunching. Lab home "YOUR OPEN RISK" (`RiskDeskPanel.tsx`, pure
  `RiskDeskView`) + the Trade line under the market read (`PositionRiskLine.tsx`). Facts, never advice or a grade.
- **Events calendar (2026-11-15, rules `app/lib/eventsCalendar.mjs`, route `GET /intel/calendar` `routes-events.mjs`; NOT
  `/intel/events`, the older Polymarket corner):**
  US macro releases (ForexFactory's public weekly JSON, this + next week, USD High/Medium; read at most hourly
  `intel:events:macro:v1`; it answers 429 to busy Cloudflare egress, so a refusal backs off an hour
  (`intel:events:macro:fail:v1`) and a 7-day last-good copy serves with `macroStale` + `macroAt`; `macroError` names the cause) + the Catalysts board's dated Polymarket markets
  (≤45 days, "market closes then", odds, coins). A failed source = `unread`, never an empty week. Lab home lens
  "Calendar" (`EventsCalendar.tsx`), 24h times in the viewer's zone. Scheduled facts, no direction. Nothing typed by hand.
- **Trade page read (2026-11-14, `MarketStripBar.tsx` under the LAB strip in `pages/perp/Layout.tsx`, rules
  `app/lib/marketStrip.mjs`):** the coin on screen in one line (funding, smart money, tape) from the drawer's answer
  (`/intel/market/:coin` now carries `facts`, numbers for the same inputs; cache key `intel:market:v2:`); ☆ watches it,
  "Read ETH →" opens the drawer where the grades are. Inputs only, never a side or a grade on the strip.
- **Quick Call (Thesis Engine, 2026-11-14, `app/lib/quickCall.mjs`):** a call posts on its levels alone (`callReady` =
  coin + committed side + `callInvalidReason` clean, the reason shown in plain words); account size only sizes a LIVE
  order (`liveOrderReady`); an unsized call saves size 0. Order: coin → side → levels (2×2 on a phone) → stop/target
  knobs → the Read as one foldable line (`LiveRead foldable`, `nx_read_open`; folded on a phone, still reads for the
  WATCH gate) → optional size → Post. The Sim folds to one line.
  **Starting points + facts before Post** (borst 2026-11-21, rules `app/lib/callStart.mjs`, UI `CallStarts.tsx`): with no
  coin, chips from your watchlist, markets past the Intel tape's funding lines (by how far past) and coins with an open
  public call (people / engines counted apart); a chip fills the SYMBOL only, never a side (test-pinned). Above Post,
  "Before you post · facts, not advice": stop vs the live H4 ATR (< 1× = inside one ordinary 4h bar, > 4× = wide),
  filled at the post or resting (the grader's `ENTRY_AT_MARK_PCT` vs the mark the build read), the stop as % of margin
  at the sized leverage (≥ 80% flagged), and the trader's own graded record on the coin.
  **No side until the trader picks one** (borst 2026-11-21, `app/lib/thesisSide.test.mjs`): `dirArmed` starts false; a
  side is committed only by a tap (Quick Call or Fine-tune, both via `pickSide`) or a `sideChosen` draft. A draft that
  only suggests a side (board fade, copilot, pasted thesis) shows it outlined (`suggestedDir`); the WATCH gate only
  un-arms; a new coin clears the pick. The Read waits for a side.
  **Hardening (2026-11-21):** a Quick Call build is dropped if the coin changed while the mark was in flight (it used to
  write the old coin's price onto the new call); a live order whose entry went in but whose stop/target was refused
  now says the entry IS resting with no stop.
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
- **Price alerts you set** (borst 2026-11-23: "all three, a switch each" + "Share button"; rules `app/lib/priceAlerts.mjs`,
  tested): a level on a coin, set in the coin panel (`PriceAlertsBox.tsx`, drawer + dock), ≤ `PRICE_ALERTS_MAX` 20 armed a
  wallet, 0.1–50% from the mark the SERVER reads (`alertBars.mjs readMark`); `dir` = above/below from that mark. Routes
  `POST /alerts/price/:wallet[/add|/remove|/channels]` (`routes-pricealerts.mjs`): Lab-signed, the LIST is private too
  (levels say where positions are); list key `palert:{w}` written only there under NexusLock `palert:{w}`; index
  `palert:index` under `palert:index` (full = drops wallets with nothing armed). Runner `priceWatch.mjs` on the */5 cron:
  Orderly's 1-MINUTE bars since its cursor (−2 min, ≤ 6h back) per coin once (mapLimit), so a wick counts; the minute
  the alert was set never counts; fires once (`crossedIn`), stamps `palert:fired:{w}` (runner-only key) BEFORE notifying;
  a coin whose bars didn't load keeps the cursor (re-read next run). Delivery = notification type `price_alert`: the
  panel's list always (the fired row with its minute + price), the phone behind push topic `prices` (ON by default:
  setting an alert is the opt-in) AND the alert's own `channels.phone` (`appendNotification` opts `push:false`), Telegram
  behind `channels.telegram`. **Share** = a button on a fired row (X intent + copy link), never automatic:
  `GET /share/alert?c=&l=&d=&t=` + `/og/alert(.png)` (`routes-alertshare.mjs`) re-read Orderly's 1-minute bars at `t`
  and draw "traded above $X" ONLY if a bar there did (`verifyCross`; an edited link = "didn't trade … then", NOT
  VERIFIED); 15-minute closes 18h before → 6h after, the level as a dashed line, the minute as a ring; bone, no
  green/red; a verified check is kept in KV (`palert:share:*`). Facts only: no direction, no advice. The fired alert
  also lands in the bell's **Yours** tab (below).
- **Wallet move alerts** (2026-11-14, `workers/nexus-lab-api/walletWatch.mjs`, */5 cron): a starred Smart Money wallet
  (`sm:wl:{caller}`, index `sm:wl:index` kept by the watchlist POST) opening/closing an Orderly position (`sm:ord:events`,
  the board's hourly diff) → a `wallet_move` note to each watcher with the wallet's X-Ray tier (`recordWords`); bell
  always, phone under push topic `wallets` (OFF by default), ≤5 a run each; cursor `sm:follow:cursor:v1`, first run =
  baseline. Hyperliquid wallets: board only.
- **Messages read chat only** (2026-11-15, rules `app/lib/xmtpMessages.mjs`, tested): the hook lists application
  messages (`kind` Application), threads by last activity, previews = the NEWEST message (`lastMessage`, descending);
  the page renders text / a reply's text / the sender's fallback and skips the rest (no "[unsupported content]"). A
  `?dm=` link goes through `dmTarget` + `canMessage` (bad address / your own / not on XMTP = a line or the invite,
  never silent); `re=` via `draftFromLink`. The nav badge = one `syncAll` + each thread's newest inbound message.
- The nav bell is `SignalsNavButton.tsx`. Before adding UI to a component, grep that something mounts it.
  **Yours tab (borst 2026-11-23, rules `app/lib/inbox.mjs`, tested):** the wallet's own `notif:{w}` list (price alerts,
  calls graded / filled / TP1 / +0.5R / expired, agent trades, follows, copies, market + wallet alerts), which NO screen
  read before (`NotificationBell.tsx` was never mounted). Read with `POST /notifications/:w` + the Lab signature, ONLY by
  itself while that signature is already held (`cachedLabAuth`; the bell never prompts), else "Show my alerts" signs
  once; polled 2 min. Badge = unseen signals + unread yours; the bell opens on Yours when something of yours is unread;
  opening the tab marks rows read (`PUT …/read`). Labels = push.mjs TITLES word for word (test-pinned); a tap stays
  in the app (`inboxHref`: the row's own "/" path or its call under the AUTHOR's wallet); a fired price alert carries
  Share on 𝕏 / Copy link (`inboxShare`, the verified card).
  **The bell, graded (v2, borst 2026-11-14, rules `app/lib/signals.mjs`, route `GET /intel/bell` routes-bell.mjs, 60 s
  cache):** every row carries `graded`: READ rows (a registered read with a paper wallet opened a paper trade, or closed
  one in the last 24h; served stage, n of 30, out-of-sample events / mean R / beats-random %) lead; funding rows carry the
  plain fade's live grade as the nearest relative; MOMENTUM = facts + "Not graded"; TIER = from the wallet's X-Ray record.
  No advice copy ("room to run", "lower-risk entry"), no tally, no money-green. **The hourly Telegram push sends ONLY a
  READ row** (`pushPick` / `pushText`, signal-delivery.mjs; reason `no_registered_read_acted` otherwise), never an
  ungraded fade or momentum row.

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
  account = the wallet's ATA `5vG1TD…FK38` (set 2026-11-14 for SOL buys; ON once it exists on-chain, see
  fee-status `on.solBuys`; collect by transfer, closing it turns the SOL-buy fee off). **LIVE since 2026-10-29** (`JUP_FEE_LIVE="true"`, borst, after a passing dry run).
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
- **Best price (EVM USDC buys):** `GET /spot/best?chain=&tokenOut=&amount=` (`routes-spotbest.mjs`, rule
  `app/lib/spotBest.mjs`) quotes spanDEX (preview, our fee on) and a Flash market quote (our key + fee, no funder) and
  compares each router's own "you receive". Flash prices its gas in; for spanDEX the worker takes off an estimate
  (live `eth_gasPrice` × `SWAP_GAS_UNITS` 200k + the OP-stack L1 fee upper bound on Base/Optimism, in ETH at Orderly's
  ETH mark, converted at the quote's own rate), so both are "after gas". Approval gas isn't counted (both need one).
  Any unreadable part (or Polygon, POL unpriced) = no estimate and the line says "Flash incl. gas". Under 5 bps =
  "about the same". Cached 20 s, origin-gated. **Routing (2026-11-14):** the line also picks the router the main BUY
  opens (`routeFor`, same file, tested): Flash only when both quoted THIS ticket (result keyed to chain+token+amount)
  and Flash nets ≥ SAME_BPS more after gas (or spanDEX gas eats its output); a tie or anything missing stays spanDEX.
  Flash opens its own ticket on a market order (`FlashSpotButton openNonce`), which quotes again; "or buy via spanDEX"
  stays one tap. The pick signs nothing. Both routers carry our 10 bps, so it never weighs our revenue.
- **Phone layout of the money screens** (2026-11-14, pinned by `app/lib/mobileMoney.test.mjs`): swap errors render through
  `SwapNotice.tsx` (rules `app/lib/swapNotice.mjs`): a guard refusal reads "Stopped before your wallet signed. Nothing
  moved." + the precise reason + the venue link as a button; no route → the venue link; reverted / cancelled / input
  keep their own line. Tickers in money buttons go through `tickerLabel` (> 10 chars = 9 + "…"). Confirm dialogs
  (EVM + Solana swap, Cross-chain review) scroll: backdrop `overflowY:auto`, dialog `margin:auto`, never a centred
  clip. The ◆ orb steps aside while a text field has focus (`useTypingFocus`, `app/lib/typingTarget.mjs`). Phone pass
  harness: Playwright at 360/412 px against `vite`, DexScreener fixtures, og relayed with the app's origin.
- **Key proxies** (`keyProxy.mjs`): `/flash/*`, `/swap/jup/*`, `/xc/quote` accept only our origins + per-IP budgets.
- **Discovery** rules in `app/lib/spotDiscovery.mjs` (recent views, address search, real-market floors incl. padded/thin
  pools, safe logo hosts, read brief, callers line). No long/short split on callers until the board has a net-positive caller.
  Recent views follow other tabs (2026-11-22): the Spot page re-reads `nx_spot_viewed_v1` on another tab's `storage` write
  (`viewedChanged`) and when it comes back into view; a coin opened from the Lab in another tab used to need a reload.
- Local live checks: Node's fetch ignores HTTPS_PROXY here; use `NODE_USE_ENV_PROXY=1`.

## x402 patterns
- **Q Signals (client pays, `app/pages/lab/qpay.ts`):** Quotient 403s datacenter IPs, so the browser calls it directly;
  never build a worker relay. x402 v2 wire: challenge in the `payment-required` header, EIP-3009 typed data, retry with
  `PAYMENT-SIGNATURE` (not `X-PAYMENT`), UTF-8-safe base64. Guards pinned to Base USDC + Quotient's payTo, cap $0.05.
  PRO-gated, explicit load, 15-min cache. Shaper `qshape.ts` mirrors lab-api `quotientSignals`.
  Every failed pull says whether money moved (`app/lib/qpayNote.mjs`): before the signature or a 402 = nothing paid;
  signed then lost = may still settle.
- **MiroShark sims (server pays, `payGuards.mjs`; the card names the credit's fate, `app/lib/simOutcome.mjs`):** our hot wallet signs ONLY Base USDC "exact" to MiroShark's pinned
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
  **A partial 30D is not a 30-day record** (2026-11-21): when the HL tape reaches back < 30 days (`hl30CoveredDays`,
  passed by the page, the compare and `xraySummary`), a positive 30D isn't evidence (a 17k-trade bot cleared the gate on
  5 days); a negative one still vetoes.
- **The page (borst 2026-11-21):** the box takes a 0x address or an ENS name (`app/lib/xrayInput.mjs parseWalletInput`;
  resolved on mainnet in the browser, `app/pages/analyze/ens.ts`, viem loaded on demand, public RPCs); the page always
  grades the RESOLVED address and prints "name → 0x…"; links carry `?address=` (+ `name=`); `?name=` alone resolves
  first (⌘K "vitalik.eth" → X-Ray). Empty page (`XrayExtras.tsx XrayHome`): recent X-rays on this device
  (`nx_xray_recent_v1`, ≤ 8), starred wallets, the Smart Money board via `sortWallets`, what an X-Ray reads. Compare
  (`?vs=`, `XrayCompare`, rules `app/lib/xrayCompare.mjs`): the same windows, watched record, lifetime (context only),
  open count and copy gate side by side; no winner, unread never 0. Each run has an id: a slower earlier read never
  writes over a later wallet; back/forward follow the URL; a malformed `?address=` says so.
- **Big records** (`app/lib/chartThin.mjs`): PnlChart thins to ≤ 800 points (each stretch's low + high kept), PnlBars
  sums consecutive trades into ≤ 400 bars labelled by trade range; min/max via `extent`, never a spread. 17k bars froze
  the tab. Grades and totals still use every trade.
- Hyperliquid: read every perp dex (`perpDexs`), and HL serves only the latest 10k fills, so we collect forward
  (`GET /xray/hltape`, `hlTape.mjs`; gaps disclosed via `completeFrom`). Share card + copilot use the same grade.
- **Smart Money, visual-first** (borst 2026-11-21, rules `app/lib/smartLayout.mjs`, tested): a strip (wallets by venue,
  one mark per wallet coloured by STAGE in ink, `STRIP_LINE`) → THE WALLETS sorted by stage, then graded days watched
  (`sortWallets`), never by the score alone → shovel line → consensus → feed → "More" (STRETCHED FUNDING scan, TIER
  CHANGES). The Consistency Score (`xrayTrack`) is never shown alone: a dot on a 0–100 rail with the 40 / 65 bars as
  ticks + the facts it's made of (`recordFacts`) + `SCORE_LINE` ("not a graded edge"). Building records fold behind a
  tap only while some wallet is scored (`walletLists`; none scored = the building list is the board + `NONE_SCORED_LINE`).
  **The ⚡ copy goes through `edgeGate`** like /analyze (it bypassed it before 2026-11-21): the dialog shows Clears /
  Locked + "Open its X-Ray →", the button is disabled and the click gated. The overlays render into `document.body`
  (`createPortal`): the Lab tab's `.nx-fade-in` wrapper keeps a transform, which pinned fixed overlays to the tab.
- **Tracked Record sweep** (`sweepTrackedXray`, 12h cron; fixed 2026-11-21, `xraySnapshot.test.mjs`): one wallet at a
  time, starts ≥ 1 s apart (the 6-wide batches fired 48 indexer reads at once; live records had 3 snapshots in 44 days);
  a PARTIAL read (any broker unread) is never stored (it understated realized and booked the gap as P&L), retried once
  after 2 s; the log line counts `partial`.
- **Hyperliquid watched record** (borst 2026-11-21, rules `app/lib/hlRecord.mjs`, tests `hlRecord.test.mjs` +
  `xraySnapshot.test.mjs`): the same sweep syncs each board HL wallet's fill tape (+ any watched wallet we hold a tape
  for; ≤ 30, ≥ 6 s apart) and stores `xray:hlhist:{addr}`: realized = closed P&L net of fees on the tape since the
  record's FIRST row (its `anchor`; fills before it never count, forward only). Never stored: no tape, a tape not synced
  in the last 5 min, or one complete only from after the anchor (`refused`). Graded by the same `xrayTrack`.
  `/smart/xray/tracked` and `/smart/xray/history` use the Orderly record once it has 2 rows, else the HL one (`venue`);
  tier events keep one tier per record (`xray:tier:hl:{addr}`).

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
- **Crash screen** (`app/components/ErrorBoundary.tsx`, the routes' `errorElement`, pinned by `app/lib/errorScreen.test.mjs`):
  "This page hit an error." + "A screen error moves no money", Reload / Go home / Copy error details, the stack folded,
  every line wrapping; the stale-chunk self-heal ("Updating Nexus…") is unchanged.
- **Lab Quick Trade** sets THIS MARKET's leverage (`useSymbolLeverage(symbol).update({leverage, symbol, margin_mode})`,
  current from `useLeverageBySymbol`; Orderly leverage is per market + margin mode, as exec sends it) before its market
  order; a failed change stops the order and says so (`quickTradeGuard.test.mjs`; it used to "keep going at current
  lev", and until 2026-11-27 it set the ACCOUNT-wide max, so a 2× ticket could fill at the market's own setting). Rules
  `app/lib/quickTradeRules.mjs` (tested): no home-made liquidation price (the isolated-margin guess on a cross account
  is gone); > $100 or ≥ 10× asks twice and the confirm step shows Orderly's `estLiqPrice` for that exact order
  (`liqLine`); Max = free × lev × 0.95; the result reads `submit()`'s `success` (`placedResult`, "sent", never
  "filled"); Long filled / Short outlined, both ink.

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
- **Merge your own green PR** on `StephenBorst/nexus` and `StephenBorst/nexus-landing` (borst 2026-11-14) once CI is
  green on the head and it's mergeable. Hold and tell borst on: red/pending CI, a conflict, an unanswered review, a
  failing Claude Approvals check, a PR that isn't yours or is on another repo (BankrBot/skills), a `Pipeline watch:` PR
  you did not open as the watcher, or anything that arms live money. After a merge, check the deploy run started (the
  landing ships on push to main via its own deploy.yml).
- **Bankr skill:** published at `BankrBot/skills` → `nexus-trading-labs/`; our fork `StephenBorst/skills`. Change it in
  BankrBot first (PR from the fork), then copy the folder back here byte for byte; never copy this folder over theirs
  without diffing. "Signer rejected it" = Bankr's wallet, not our code (test with a trivial sign).
- borst's local env is Windows PowerShell (use `;`, no `&&`).
- Before building on a component, grep that something imports it.
- **Tap targets** (borst 2026-11-21, `app/lib/tapTargets.test.mjs`): a trader's avatar AND name open their profile
  (`/feed/trader/:w`) on feed cards, Ranks rows (without toggling the row) and the call page (`ProfileLink` in
  feed/index.tsx: a real `<a>`, stopPropagation). A phone's horizontally scrolling chip row keeps `CHIP_SCROLL_GAP` (10)
  between chips and scrollbar (theme.ts; the Wire + news rows).

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
- **Hero-look share cards** (borst 2026-11-23): the thesis card (`og/thesis/:wallet/:id.png`) and the Arena agent card
  (`/og/arena/:wallet.png`) match the brand hero (`public/embed-mini.png`): the Nexus mark (`ogMark.mjs`, 60×72 PNG from
  `public/logo-mark.png`) + "NEXUS TRADING LABS", the silk streak as SVG gradients (bone/bright at an opacity only, no
  grain), a serif headline (Libre Baskerville, the app's own `public/fonts/` file imported into lab-api as a Data module via
  wrangler.toml `[[rules]] **/*.ttf`; `renderHeroPng` passes it beside JetBrains Mono; only the regular instance renders),
  numbers in mono. Green/red only on the graded WIN/LOSS and the Arena net P&L. Notes = ≤ 2 lines broken between words,
  "…" when cut (`quoteLines`); levels under $1 print 4 significant figures (`cardPrice`). Same URLs, titles and
  descriptions; X keeps an already-shared card's old picture. Board, read, record and X-Ray cards stay mono
  (`ogCards.test.mjs` pins both).
  `ogCards.test.mjs` enforces card colours.

## Settled — don't re-raise
- Cold start / feed liveness is behind us. In-app EVM buy/sell is live and tested. The mini app is parked. Orderly Predict
  is skipped (2026-11-06).
- Focus = the engine and its signals. The engine has no proven edge yet: that's the #1 risk, and the failure mode is
  copy shipping ahead of the grade.
- The Oct-15 engine freeze is over. Engine work happens when borst asks for it.
- Positioning: the trading terminal that grades itself in public. The DEX is the commodity; the Lab, the grading and
  the social graph are the moat.
