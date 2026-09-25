# Nexus Trading Labs — Project Memory

## What this is
An **Orderly Network white-label perp DEX** (`dex-creator-template`) heavily customized into
**Nexus Trading Labs**. The base DEX (markets, swap, vaults, portfolio, leaderboard, points,
rewards) comes from the Orderly SDK — that's the commodity layer. The **product / differentiation**
is everything built on top:

- **The Lab** (`app/pages/lab/index.tsx`) — the flagship. Tabs (7): Market Intel, Nexus Thesis Engine,
  Agent, Copy Trades, Trade Log, Holders Room, Analytics. Header brand: `// THE LAB`.
- **Nexus Thesis Engine** — position sizing, R:R, funding cost, live P&L, on-chain thesis registry.
- **Agent** — autonomous funding-edge trading bot. Modes: PAPER (simulated, default), ASSISTED
  (signals only), AUTONOMOUS (real orders). Guardrails: daily-loss cap, max trades/day, kill switch,
  order-only keys (cannot withdraw).
- **Social** — Feed, Trader profiles, Copy Trades, XMTP wallet-to-wallet DMs (`app/pages/messages`).
- **Messages** — global top-right envelope icon w/ live unread badge (`app/components/MessagesNavButton.tsx`),
  real-time via XMTP `streamAllMessages`. Deep-linked from Feed/Trader as `/messages?dm=0x…`.

## ✅ Revenue + AI + Treasury (LIVE — 2026-06-06; full detail in memory `revenue-ai-treasury-2026-06-06`)
- **Money map:** broker fees → `borst.eth` (Orderly-registered, don't churn) · subs/AI revenue → EOA
  `0x06cD9c281E6ab09906B46a10e059F2770EfdE49A` (`SUBSCRIPTION_RECEIVER`) · **treasury Safe**
  `0x4Fe2c01bbeFaFFa35706C994646a3F8493B1C733` (1/1, Arbitrum+Base, signer `0x53Ce…9D33`). Sweep the
  receivers → the Safe on a cadence. Safe is set as `NEXUS_TREASURY_ADDRESS` → public treasury banner live.
- **⚠️ x402 data revenue (LIVE 2026-06-15) → 3rd sweep source.** Three Bankr x402 cloud endpoints sell Nexus
  data priced in **$NEXUS** on Base (`x402.bankr.bot/<deployerWallet>/<name>`): `nexus-signals` (50k $NEXUS/req,
  the agent's funding+OI edge via `/signals`), `nexus-callers` (10k, `/theses/leaderboard`), `nexus-agents-live`
  (10k, `/agents/live`). Bankr hosts + wraps payment; we just supply handler+config (`bankr-x402/`). **Payout =
  the DEPLOYER wallet** (currently the Bankr wallet `0xd9f7…b449`), **95% after Bankr's 5% fee**, accrues as the
  $NEXUS ERC-20 (no withdraw step). To route to treasury: **sweep `0xd9f7…b449` → the Safe on the same cadence**
  (do NOT redeploy from the Safe — a multisig can't be the Bankr deployer; or ask Bankr support to migrate
  `payTo`). Narrative: treasury accumulates $NEXUS from EARNED, recurring revenue (stronger than "buy the lows");
  agents needing $NEXUS to pay = token demand from usage (internal analysis ONLY — never public copy; see buyback policy §4). x402 challenge verified live (402 + correct amounts).
- **PRO payment rail LIVE** (`PAYMENTS_LIVE=true`): `POST /sub/verify {txHash,chain}` verifies ONE tx receipt
  → grants 30d PRO to the tx's `from` (spoof-proof, replay-guarded). USDC/Arbitrum $20 · $NEXUS/Base $15
  (DexScreener-priced, 12% tolerance, fails closed). `walletIsPro` reads `sub:{addr}`. Logic+tests in lab-api `logic.mjs`.
- **Hosted AI inference LIVE** (PRO benefit): `POST /ai/chat` = authed (wallet-signed) PRO-gated proxy to Anthropic
  with our key + prompt caching + **per-MODEL daily cap**. PRO user PICKS the tier (UI ⚙): **Haiku 4.5
  100/day · Sonnet 4.6 40/day (default) · Opus 4.8 20/day** — stronger model = lower cap (spend scales with
  cost). `resolveHostedModel`/`hostedCaps` in lab-api `logic.mjs` whitelist the requested id (unknown/injected
  → default Sonnet tier) + return its cap; usage counter is keyed PER MODEL (`ai:usage:{addr}:{model}:{date}`).
  Tiers mirrored client-side in `config/assistant.ts` (`HOSTED_TIERS`). Env-tunable caps `HOSTED_CAP_HAIKU/
  SONNET/OPUS` + default tier `HOSTED_AI_DEFAULT_MODEL` (legacy `HOSTED_AI_MODEL` honored as default source);
  needs `ANTHROPIC_API_KEY` secret (set). Free users keep BYOK.
- **⚠️ Hosted-AI SPEND PATH = Bankr LLM Gateway (LIVE 2026-06-14), not direct Anthropic.** `/ai/chat` upstream is
  pluggable via `resolveAiUpstream`/`bankrGatewayModel` in `logic.mjs`: with worker var `AI_GATEWAY=bankr` (set in
  wrangler.toml `[vars]`) + secret `BANKR_LLM_KEY` (set), it proxies to `https://llm.bankr.bot/v1/messages`
  (Anthropic-compatible, header `x-api-key`) instead of Anthropic — funded by Bankr's **$100k inference grant**
  ($1112 credited; "$100k Inference Program"). Gateway uses dot-notation ids (`claude-opus-4.8`/`-sonnet-4.6`/
  `-haiku-4.5`, verified via `GET /v1/models`, caching supported) vs our hyphen ids — `bankrGatewayModel` maps
  each tier (env-overridable `BANKR_MODEL_HAIKU/SONNET/OPUS`). Per-model daily caps + cache_control breakpoints
  still apply. Falls back to direct Anthropic if `BANKR_LLM_KEY` is absent. Manage credits/usage at bankr.bot/llm
  (Bankr wallet `0xd9f7…b449`). Revert = remove the `AI_GATEWAY` var. Verified live: credit balance ticked down on
  a real PRO call.
- **`/analyze`** public Hyperliquid wallet x-ray (HL public API → Lab AnalyticsView; in nav). **Strategy presets**
  (`config/strategyPresets.ts`) load in PAPER/ASSISTED/AUTONOMOUS (no longer force PAPER). **Agent regime filter**
  `respectRegime` (opt-in; brain `computeRegime` gates trend-fighting entries). Bankr skill updated for both.

## Stack
- React + Vite + react-router-dom, TypeScript. Orderly SDK (`@orderly.network/*`), `@xmtp/browser-sdk` v7, wagmi.
- Nav config + global chrome: `app/utils/config.tsx` (top-nav order is hardcoded by href in `NAV_HREF_ORDER`).
- Lab storage (theses/notes): `app/hooks/useLabStorage.ts` (Cloudflare KV via nexus-lab-api).
- XMTP: `app/hooks/useXMTP.ts` (env: `production`). Unread tracking: `app/utils/xmtpUnread.ts`.

## ⚠️ DEPLOYMENT — read before touching CI/CD
- **⚠️ REPO TOPOLOGY (single source of truth = `StephenBorst/nexus-4421`).** Fork chain:
  `OrderlyNetworkDexCreator/dex-creator-template` (upstream template) → `OrderlyNetworkDexCreator/nexus-4421`
  (Orderly DEX Creator's managed fork → deploys to **GitHub Pages**, NOT prod; we don't control it — it's in
  Orderly's org) → **`StephenBorst/nexus-4421`** (OUR repo → Cloudflare → `trade.nexustradinglabs.com`, all
  custom product work). **The `dex.orderly.network/en/dex/config` UI writes to the Orderly FORK, not prod** —
  so changes made there (broker name, theme, menus, PnL posters, etc.) DO NOT reach the live site. **Rule: make
  ALL config + code changes in `StephenBorst` (edit `public/config.js` directly); do NOT use the Orderly config
  UI** (or if you must, mirror the change into `public/config.js`). The two have diverged far past meaningful
  merge — don't try to sync repos; just keep prod authoritative. (2026-06-15 reconcile: pulled 4 drifted config
  values fork→prod — APP/SEO description, theme `#000000`, menus incl. Campaigns.)
- **Live app** = Cloudflare **Pages** project **`nexus-trading-lab`** → domains `trade.nexustradinglabs.com`
  + `nexus-trading-lab.pages.dev`. **It has NO Git connection** — deployed ONLY by the custom GitHub
  Action `.github/workflows/deploy.yml` (wrangler direct-upload). Do NOT expect Git auto-builds here.
- `deploy.yml` (on push to main) builds the app, `wrangler pages deploy build/client`, AND deploys the
  **nexus-lab-api** worker. Install step retries 3x to survive registry flakes.
- **Redundant builds:** the "pages build and deployment" runs in the repo's GitHub Actions are **GitHub
  Pages** (GitHub's own built-in workflow), NOT Cloudflare. There is NO Cloudflare zombie project —
  `nexus-trading-lab` has no Git connection and is the only app Pages project. Fix = repo **Settings →
  Pages → Source: None** to stop them. Zero impact on Cloudflare/prod/code. (Cloudflare account has 7
  apps total: nexus-lab-api, nexus-trading-lab, nexus-agent-exec, nexus-agent-brain, nexus-landing,
  nexus-lab-alerts, orderly-proxy — all legit, none Git-connected to nexus-4421.)
- A "Build & Deploy" Action run failing fast (~21s) is almost always a transient `yarn install` flake,
  not a real break — the next push's superset deploy covers it.

## Cloudflare Workers (deploy with `npx wrangler deploy` in each dir; needs CF auth)
- **nexus-lab-api** (`workers/nexus-lab-api`) → `og.nexustradinglabs.com`. This is the `AGENT_API`
  (`https://og.nexustradinglabs.com`) the frontend calls. Serves `/agent/:address` (config/state/trades/
  pending), lab KV storage. Returns the full `state` object wholesale (so extra state fields ride along).
- **nexus-agent-exec** (`workers/nexus-agent-exec`) → cron every 1 min. Executes/monitors agent positions.
  PAPER mode simulates fills (no key, no real order) and records to `state.paper_trades` (separate from
  the live Supabase `agent_trades` table). KV namespace `NEXUS_AGENT` = c3c0582ec71c4d049d0795872f39f033.
- **nexus-agent-brain** → cron, generates funding/OI signals into `agent:signal:<addr>`.
- **nexus-lab-alerts** → alerts worker.
- **nexus-landing** → `landing.nexustradinglabs.com`, separate repo `StephenBorst/nexus-landing`.
  ⚠️ NOT a Pages project (the only Pages project is `nexus-trading-lab`) — it's a **Workers
  static-assets deploy**: `wrangler.jsonc` (`name: nexus-landing`, `assets.directory: "."`),
  deploy with **`npx wrangler deploy`** from the repo root (NOT `wrangler pages deploy`). No CI —
  pushing to GitHub does not deploy; run wrangler manually. CF auth via `CLOUDFLARE_API_TOKEN` env.

## Agent paper mode details
- Frontend default mode = PAPER (new users start risk-free). PAPER needs no trading key.
- Track records are kept strictly separate: LIVE (Supabase) vs PAPER (`state.paper_trades`, capped 50).
- **⚠️ The 50-cap is a WINDOW, not the record (fixed 2026-09-20).** exec pops past 50, so the card's
  TRADES stuck at 50 and "since" slid forward as rows fell off. Lifetime is now accrued ONCE at close
  into **`state.paper_agg`** (`{trades,wins,losses,grossWin,grossLoss,net,firstTradeAt,lastTradeAt}`) —
  it CANNOT be rebuilt from a truncated window, so the accrual must happen at write time. Pure math in
  **`app/lib/paperStats.mjs`** (`accruePaperAgg`/`paperSummary`/`paperBlotter`/`tradeNotional`/`holdHours`,
  tested) imported by BOTH exec (accrual) and the Lab (render) so they can't disagree. lab-api ships it
  free (GET returns `state` wholesale). AgentTrackRecord shows LIFETIME tiles + a "last N · rolling" line
  naming the window. `paper/reset` clears `paper_agg` too. Live money path untouched.
- **🧾 PAPER BLOTTER** (`PaperBlotter` in `AgentPanels.tsx`): per-trade symbol/side/notional/pnl/exit/hold +
  one-line breakdowns of how losses vs wins END, and avg win/loss at the CURRENT notional only (old fat
  notionals excluded — mixing sizes makes avg$ meaningless). `notional = entry_price × qty` and hold =
  `closed_at − opened_at`, both DERIVED, so the blotter works on rows recorded before it shipped.
  ⚠️ **Real exit vocabulary** (don't invent buckets): `SL · TIMEOUT · TRAIL · BE · TP · TP_PARTIAL ·
  KILLED · WEBHOOK_CLOSE`. **There is no "signal flip" exit** — WEBHOOK_CLOSE is the nearest analogue.
  `tp_level` is stamped on PAPER slice rows only (the live Supabase insert keeps its exact column set).
- API endpoints: `POST /agent/:address/paper/reset` (clear paper ledger), `POST /agent/:address/test-signal`
  (DEV-only force a paper signal; hard-refuses unless mode===PAPER). Force button is gated to
  `import.meta.env.DEV`.

## Agent multi-user build (Session 013 — 2026-05-30/31)
Migrated the single-user bot → full multi-user, non-custodial, autonomous agent. All committed to `main`.
- **Architecture:** `nexus-agent-brain` (5-min cron) iterates `agent:users`, evaluates **funding + OI-divergence
  confluence** per symbol (BOTH rules must agree — ported from the validated single-user `.bak`; the first
  multi-user brain had a stubbed `oi>0` check that fired on funding alone — fixed). Stores `market:prev:{symbol}`
  for price/OI deltas; evaluates each symbol ONCE per tick (no per-user race). `nexus-agent-exec` (1-min cron)
  reads `agent:signal:{address}`, enters/monitors/closes per user. AgentView in `app/pages/lab/index.tsx`.
- **⚠️ KV namespace gotcha (cost us hours):** brain/exec use binding `NEXUS_AGENT` = `c3c0582ec71c4d049d0795872f39f033`.
  The lab-api agent routes MUST use the SAME namespace — lab-api binds it as `NEXUS_AGENT` (also has `LAB_STORE`
  =`12c4fcbc...` for lab data). Agent keys: `agent:users`, `agent:config:{addr}`, `agent:key:{addr}`,
  `agent:state:{addr}`, `agent:signal:{addr}`, `agent:pending:{addr}`.
- **⚠️ AGENT_API URL:** frontend hits lab-api via custom domain **`https://og.nexustradinglabs.com`** (the
  `*.workers.dev` subdomain is NOT routed → 404/CF-1042). Same base as all other app API calls.
- **Orderly signing (ground truth, Handoff 012):** use `@noble/ed25519 signAsync()` + `bs58` (NOT `crypto.subtle`,
  which can't sign Orderly ed25519 seeds). Signature = **base64URL** (`+`→`-`, `/`→`_`, strip `=`). `orderly-key`
  header = the DERIVED public key (`ed25519:` + bs58(getPublicKeyAsync)), NOT a slice of the secret. GET requests
  need `Content-Type: application/x-www-form-urlencoded`; POST = `application/json`. Must POST `/v1/client/leverage`
  before each order (defaults to 1x). Market data: `GET /v1/public/futures/{symbol}` (mark_price, last_funding_rate,
  open_interest); step size from `GET /v1/public/info/{symbol}` (`base_tick`, `base_min`, `min_notional`).
- **⚠️ Order qty MUST snap cleanly to base_tick:** `Math.floor(q/tick)*tick` produces float artifacts
  (e.g. `0.0034000000000000007`) → Orderly **-1104 "does not match step size"** (intermittent, price-dependent).
  Fix: `parseFloat((steps*baseTick).toFixed(decimals))` where `decimals = -log10(baseTick)`. Also guard base_min/min_notional.
- **-1101 "margin insufficient"** = capitalPerTrade margin too close to account balance. Keep a buffer
  (balance ≈ $52 couldn't run $50 margin; dropped to $30/trade).
- **Key security (#1, Phase 1a DONE):** trading keys encrypted at rest with **AES-256-GCM** (Web Crypto, zero-cost)
  under Worker secret `AGENT_ENC_KEY` (set on BOTH lab-api + exec, same value). KV stores `v1:<b64iv>:<b64ct>`;
  exec decrypts only at signing time. Legacy plaintext passes through (re-activate to migrate). Orderly keys
  CANNOT withdraw — blast radius is trading only. Phase 1b (dedicated short-lived scoped keys via `AddOrderlyKey`
  w/ `scope`+`expiration`, default 30d) = DEFERRED/optional; 1a agreed as legit stopping point.
- **⚠️ Agent mutation auth (DONE 2026-06-11 — Bankr PR #451 security review):** EVERY agent control op
  (`PUT /agent`, `PUT /agent/config`, `DELETE /agent`, `POST /agent/:a/kill`, `bankr/activate`+`bankr/mode`
  incl. PAPER, `pending/:id/deploy|dismiss`, `paper/reset`, `test-signal`) requires `walletSig` =
  `sign_message('nexus-trading-key-v1')` in the JSON body. lab-api `ownsAgent`/`requireOwner` ecrecover it
  (`recoverEthAddress`) and 401 unless it resolves to `:address`. ONLY `GET /agent/:a` is public. Was a real
  hole: previously zero auth → anyone knowing a wallet could `kill` (force-close positions) or rewrite config.
  Web AgentView signs once (viem, cached in `sessionStorage` key `nexus_agent_sig_{addr}`) + sends walletSig on
  all 7 mutation calls; the Bankr skill must too. Don't add a new agent mutation without the `requireOwner` gate.
  NEVER accept the sig via query string (replayable/leaks to logs) — body only.
- **Exec scaling (#2 DONE):** per-symbol promise-cached `getMarkPrice` (public price fetched once/tick, not per-user)
  + bounded-concurrency batches (`BATCH_SIZE=10`, `Promise.all`). Remaining ceiling = total subrequests/invocation
  (per-user authed position reconcile is irreducible); time-sharding/Queues is the next lever at hundreds of users.
- **Reconciliation / self-heal:** before monitoring, exec fetches live Orderly position; if exchange is flat
  (manual close) it clears the stale KV record + resumes — no ghost position, no bogus trade. Fail-safe: on a
  reconcile error it manages on cached data rather than wrongly clearing.
- **⚠️ SINGLE-WRITER state ownership (race fix):** `agent:state:{addr}` is written ONLY by exec (risk counters,
  daily reset, position). The brain writes ONLY `agent:signal:{addr}` — it must NEVER write agent:state (it used to,
  to stamp `last_signal`, which raced with exec every 5 min and clobbered trades_today/daily reset → cap undercount).
  lab-api GET merges `agent:signal` into the state response (read-only) so the UI still shows last_signal. **Kill** is
  a DEDICATED key `agent:kill:{addr}` (lab-api sets "1", exec consumes+deletes) so an emergency stop can't be lost to
  a state-write race; legacy `state.kill_requested` still honored. Deactivate stays safe via key deletion regardless
  of the active flag. Verified live: 10 real autonomous trades logged, +$ net, counters intact post-fix.
- **Onboarding (#3 DONE):** Config tab has how-it-works panel, live key-status indicator (detected/encrypted vs
  missing — must place ONE manual trade first to generate the Orderly key), and a security disclaimer on activate.
- **ASSISTED vs AUTONOMOUS:** ASSISTED writes a thesis to `agent:pending` (deduped per cooldown) surfaced in the
  Status tab for manual review — never executes. AUTONOMOUS enters/manages real orders within risk params.
- **Controls:** Flip ASSISTED = pause new entries (still manages open position). DEACTIVATE = stop + delete key
  but LEAVES position open/unmanaged. KILL = close position + delete key + deactivate (full stop, must re-activate).
  Rule: agent must be FLAT before you trade manually on the same account (positions net together; agent tracks KV).
- **Verified live:** TP/SL/TIMEOUT closes, signing, reconcile self-heal, encrypted-key round-trip, Supabase logging
  + History read (lab-api also needs `SUPABASE_URL`/`SUPABASE_ANON_KEY` secrets — was missing, caused empty History).
- **Deploy:** frontend → push `main` (CI → Cloudflare Pages). ⚠️ CI's deploy.yml now redeploys **nexus-lab-api,
  nexus-agent-exec, AND nexus-agent-brain** from committed source on every push to main — so COMMIT worker changes
  or CI overwrites manual deploys (secrets persist; wrangler deploy only pushes code). The other workers
  (nexus-ledger-anchor, nexus-lab-alerts) are still manual `npx wrangler deploy` per dir. Worker observability
  logs enabled in each wrangler.toml (`[observability.logs] enabled=true`).

## Bankr agent control (chat-deploy the agent — Phase A+B SHIPPED, 2026-06-02)
Bankr/Farcaster users can deploy/control the autonomous agent by chat. Two additive lab-api routes
(spec: `docs/bankr-agent-spec.md`; skill drop-in: `docs/bankr-skill-agent-module.md`):
- **`POST /agent/:address/bankr/activate`** `{mode, config?, walletSig?, confirm?}` — PAPER needs no key;
  ASSISTED/AUTONOMOUS derive the order-only key from `walletSig` (sign_message('nexus-trading-key-v1'),
  same auth as `/trade`) + the registered `accountId` (from `user:{addr}` in LAB_STORE), encrypt at rest,
  store `agent:key`. **AUTONOMOUS requires `confirm:"GO LIVE"`** (else 409). Clears stale `agent:kill` on activate.
- **`POST /agent/:address/bankr/mode`** `{mode, walletSig?, confirm?}` — flip mode; provisions the key on
  the first live flip; AUTONOMOUS gated by confirm.
- **Key derivation (ground truth):** `seed = SHA-256(walletSigBytes)` (32-byte ed25519 seed) → `bs58Encode(seed)`
  = the secret the exec's `bs58.decode`+noble signer expects. Helpers `bs58Encode` + `agentSecretFromWalletSig`
  in lab-api (verified round-trip with the `bs58` pkg). Auth = possession of a valid walletSig (only the wallet
  owner can produce it via Bankr) — NEVER address-only (would let anyone arm someone else's agent).
- Status/fund/kill reuse existing routes (`GET /agent/:addr`, `/deposit/prepare`, `DELETE`, `/kill`). Capital
  guardrail (avoid -1101): suggest `capitalPerTrade ≈ floor(freeCollateral*0.6)`.
- **✅ Bankr deposit flow LIVE-VERIFIED (2026-06-10):** ran a real end-to-end deposit through
  `/proxy/bankr-deposit` on a funded Bankr wallet → both Arbitrum txs confirmed `status:0x1` (approve
  `0xbcea3e25…721f18bc` to USDC; deposit `0x81033f70…d25eed1a2` to Orderly Vault `0x816f72…67e9`). The
  skill deposits ONLY to the **trading balance** (perp collateral, withdraw anytime, no lockup) — it
  CANNOT use **OmniVault** (`0x70fe7d65…`, Orderly's managed-fund product, 48h redemption window).
  ⚠️ Orderly Dev-Rel (Wuzhong) confirmed external brokers can't `allowBroker` into OmniVault "at this
  stage" — so the earlier OmniVault listing ask was a phantom requirement; the standard broker vault
  was always the right path and works out of the box. Don't re-chase OmniVault.

## Agent signal modes + config control surface (`brain/logic.mjs` `deriveSignal`)
- **`signalMode`** (user-picked): `CONFLUENCE` (default, conf 80 — funding extreme AND OI-divergence must agree),
  `FUNDING_ONLY` (65), `OI_ONLY` (65) = FREE; `MOMENTUM` (60, trade WITH a price move > threshold) and
  `MEAN_REVERSION` (60, FADE the move) = **PRO** (`PRO_AGENT_STRATEGIES` in `app/config/subscription.ts`).
- **Thresholds (per user):** `fundingThreshold` (%, def 0.01), `oiChangeThreshold` (%, def 0), `priceChangeThreshold`
  (%, def 0.5 — for momentum/mean-rev). Plus risk/exec: `symbols`, `leverage`, `capitalPerTrade`, `tpPercent`,
  `slPercent`, `maxHoldHours`, `maxTradesPerDay`, `maxDailyLossUsdc`. ALL user-set, read LIVE each cycle (changes
  apply to next signal + to managing an open position). Brain is per-symbol RAW deltas; `deriveSignal(raw,config)`
  applies each user's mode/thresholds.

## 3Commas-informed agent adaptations (SHIPPED 2026-06-30) — spec `docs/3commas-adaptations-spec.md`
Studied 3Commas; took only the mechanics that fit the funding-edge + trustless-grading identity. All on `main`,
pure-logic-first with `node:test`. Positioning: "3Commas automation without the trust problem."
- **Multi-TP scale-out + trailing stops (FREE):** `evaluateExit(pos,pnlPct,holdMs,config)` in exec `logic.mjs`
  supersedes `exitReason` — returns `FULL_CLOSE`/`PARTIAL_TP`/`TRAIL_UPDATE`/null (hard-stop priority SL→TIMEOUT→trail
  over TP). Config `takeProfits:[{pct,sizePct}]` + `trailingStopPct`. `partialClose()` sends reduce-only slices, logs
  per-slice `agent_trades` rows (`parent_id`/`exit_seq` cols — migrated). `normTakeProfits` keeps legacy single-TP
  behavior. Backtest finding: **trailing HURTS in chop, scale-out mildly helps.**
- **Signal webhook / TradingView (PRO):** per-user secret token in URL = auth (order-only scope, rotatable).
  `POST /agent/hook/:token {action:BUY|SELL|CLOSE,symbol,passphrase}` → `parseWebhookAlert` (lab-api logic.mjs) →
  writes `agent:webhook_signal:{addr}` (600s TTL); exec consumes it before the holding check (CLOSE flattens even
  while holding; OPEN bypasses cooldown, no stacking). Owner-authed PRO `/agent/:a/webhook/(enable|rotate|disable)`.
- **DCA / safety orders (PRO):** whole ladder fits inside `capitalPerTrade` (base = capitalPerTrade/Σvs^i), reuses the
  balance guardrail. `config.dcaEnabled`+`config.dca{maxSafetyOrders,safetyOrderStepPct,safetyOrderStepScale,
  safetyOrderVolumeScale}`. exec has a SEPARATE monitor path: P&L off blended `avg_entry`, TP off avg, `addSafetyOrder`
  averages in via `nextSafetyOrder`/`blendAvg`, slPercent stop only fires once the ladder is spent. Daily-loss cap +
  kill switch stay absolute. Server-enforced 402 `pro_dca_locked`.

## Strategy workbench (SHIPPED 2026-06-30/07-01) — full detail in memory `strategy-workbench-and-followups`
The moat-aligned answer to "let users build/validate strategies." Loop: pick STYLE → compose (Config tab) → Test →
Sweep → Save → Publish → Community board → COPY → activate → graded.
- **Backtest engine** `workers/nexus-lab-api/backtest.mjs` — imports the REAL deployed `deriveSignal` (brain) +
  `evaluateExit`/`computePnl` (exec) so results reflect live behavior (wrangler bundles the cross-dir imports; ONE
  engine, `tools/backtest` runner imports it too). `POST /agent/backtest` (single) + `/agent/backtest/sweep` (ranked
  ~27-config grid), both **PRO** (walletSig→ecrecover→walletIsPro). Config-tab BACKTEST card (Test/Sweep buttons).
- **⚠️ Data reality:** Orderly has price OHLC + funding-rate history but **NO OI history** → CONFLUENCE/OI_ONLY are
  NOT backtestable (flagged `untestable` to UI). Only MOMENTUM/MEAN_REVERSION/FUNDING_ONLY + exits are. First 60d
  sweep: EVERYTHING net-negative, least-bad = FUNDING_ONLY extreme threshold → drove selective house defaults
  (`DEFAULT_CONFIG` fundingThreshold 0.02, maxTradesPerDay 4). **Agent net-negative = the #1 real constraint.**
- **OI history logging:** brain records hourly `{t,price,oi,funding}` into `oi:hist:{symbol}` (core BTC/ETH/SOL +
  watchlists, independent of position state — bug fixed where it only ran for flat users). `GET /agent/oi-history/
  :symbol`. **✅ OI→BACKTEST WIRE SHIPPED (don't re-derive).** `backtest.mjs` `makeOiChangeAt` builds a NO-LOOKAHEAD
  fractional OI-delta from oi:hist; `runBacktest` feeds it into `deriveSignal` per bar; `backtestConfig`/`runSweep`/
  `walkForwardValidate` all take `oiHistBySymbol`. `strategies.mjs loadOiHistForBacktest` gates on coverage
  (`OI_BACKTEST_MIN_DAYS=14`, `OI_BACKTEST_MIN_SAMPLES=200`, min across the universe) → `oiMature`; index.js passes
  real OI in ONLY when mature, else CONFLUENCE/OI_ONLY are flagged `untestable` + the backtest routes surface
  `oiTested`/`oiCoverage`/`oiWindowDays` + honest notes, rendered by `AgentBacktestCard.tsx`. So CONFLUENCE lights up
  AUTOMATICALLY the moment the gate clears (brain caps oi:hist at 2200 pts ≈90d hourly). Tests: `backtest.test.mjs`
  proves the no-lookahead lookup + CONFLUENCE fires WITH recorded OI / abstains WITHOUT it (no fabricated divergence).
  To confirm live maturity: run a CONFLUENCE backtest in the Lab — the note reads either "tested over Nd of recorded
  OI" or "still maturing (Nd/14d, Ns/200)". **CONFLUENCE was NOT-yet-testable = STALE; it is wired + self-gating now.**
- **⚠️ OI maturity is PER-SYMBOL (fixed 2026-09-20 — the TEST-vs-VALIDATE split gate).** The gate used to be
  `min(days)/min(samples)` across every requested symbol. `/agent/backtest` asks about the CONFIG's symbols
  (BTC…), `/agent/validate` asks about a hardcoded 6-symbol `VALIDATE_UNIVERSE` incl. **BNB/XRP/LINK — which the
  brain only records when a user WATCHLISTS them** (it logs core BTC/ETH/SOL + watchlists). So one never-recorded
  symbol zeroed the min → same wallet, same session: TEST said "tested over 81d", VALIDATE said "still maturing
  (0/14d)". Now `loadOiHistForBacktest` returns `perSymbol[{symbol,days,samples,mature}]` + `matureSymbols` /
  `staleSymbols` / `oiHistMature` (only mature series reach the engine) / `matureMinDays` / `anyMature`; strict
  `oiMature` (ALL mature) is kept for back-compat. Callers RUN THE MATURE SUBSET and name the excluded markets
  instead of failing the whole run — `revalidateStrategy` had the identical bug (published CONFLUENCE strategies
  were pinned at `pending_oi` forever). **`MIN_VALIDATE_SYMBOLS=2`** — a walk-forward on ONE market would let
  `robustnessVerdict` hand out ROBUST off a single symbol, which is exactly what it exists to fail. Routes return
  `oiCoverage`/`excludedSymbols`/`strategyLabel`/`gatesSkipped`; `AgentBacktestCard` renders per-symbol coverage
  chips. Tests: `strategies.test.mjs` (incl. 2 regression tests pinning the split).
- **⚠️ A backtest CANNOT simulate `respectRegime` or `respectSmartMoney`.** `runBacktest` calls
  `deriveSignal(raw, config)` with NO regime/consensus args, and `deriveSignal` skips those gates when the arg is
  absent — so backtesting a regime-gated config silently tests the UN-gated version. **Session + volatility(ATR) +
  invert + funding-percentile ARE simulated** (runBacktest supplies `raw.hourUtc`/`raw.atrPct`). The shipped
  **"Regime-Gated Invert" preset uses vol+session, NOT `respectRegime`** — so it IS faithfully tested; its only
  unsimulated field is `maxSignalAgeSec` (a live latency guard). Surfaced via `backtestGateSupport()`.
- **Strategy NAMING:** `app/lib/strategyLabel.mjs` (shared by worker notes + the Lab card, so it can't drift) —
  a preset is a COMPOSITION, and labelling an INVERTED config "CONFLUENCE" described the opposite trade. invert+gates
  → "Regime-Gated Invert"; invert alone → "Inverted <mode>"; gates alone → "Gated <mode>". Tested.
- **Strategy library + sharing:** `/agent/:addr/strategies` CRUD (save/delete owner-authed, list public) + `/publish`
  toggle; `GET /agents/strategies/public?style=` ranks public strategies by the **author's GRADED record** (not
  backtest — keeps discovery on-moat), optional style filter. Config-tab STRATEGY LIBRARY + COMMUNITY STRATEGIES cards.
- **Trading STYLE** (`app/config/agentStyles.ts`): Day/Swing presets + `deriveStyle` (by maxHoldHours). Scalping
  (sub-minute) + position (buy-and-hold) intentionally ABSENT — don't fit a 1-min-cron funding-edge agent on hourly
  data. `maxHoldHours` UI cap lifted 48→336h for swing. Active strategy shown on AGENT STATUS + agent feed entries.
- **⏳ Multi-strategy concurrency (deferred):** the RIGHT path is one **Orderly sub-account per strategy** (NOT separate
  wallets = bad UX, NOT multi-position-one-account = perps net per symbol/account). Sequence AFTER a proven edge
  (concurrency multiplies edge). Bonus: sub-accounts → per-STRATEGY graded records → stronger marketplace ranking.

## ⭐ Signal engine — the AXIS SCOREBOARD (CURRENT, supersedes the funding-fade flagship)
The engine evolved past funding+OI confluence. The scoreboard **graded our own old flagship (funding fade) as
NOISE** (~46% hit, negative bps over 2.5k samples) — the edge migrated to **BASIS + a conditioner stack.**
- **The reads (orthogonal signal stack):** spot-perp **basis** (perp premium/discount — grades fade QUALITY;
  `flow.mjs` on OKX), **CVD** (aggressor flow), **liq-flush** (`liquidations.mjs`), **smart money**, **OI**,
  order-book imbalance, **RSI reset** (uptrend continuation), and **vol regime = contango/backwardation**
  (Deribit DVOL term structure, `deribit.mjs`/`flow.mjs` — backwardation favors fades, contango = trend). Each
  self-logs hourly (`basis:hist`/`cvd:hist`/`liq:hist`/`sm:hist`/`oi:hist`/`candle:hist`).
- ⚠️ **BASIS ≠ CONTANGO** (don't fuse them): basis = spot-vs-perp price = the fade *signal*; contango/backwardation
  = the options vol *regime* = a *conditioner* (when fades work), not a strategy.
- **The SIGNAL SCOREBOARD** = `GET /intel/axis-backtest` (worker `axisbt.mjs` `runScorecard`) → rendered by
  `app/pages/proof/index.tsx` (`SignalRow`/`Stat`), shown on **/proof** AND the Feed **SIGNALS** tab. **It grades
  our OWN reads the way we grade traders:** forward returns, no lookahead, pooled across ~12 core markets,
  first-half/second-half **walk-forward stability**. Horizons 4/12/24h.
  - **Tiers:** `PREDICTIVE` (enough samples AND positive AND stable) > `PROMISING` (positive, not stable) >
    `NOISE` (flat/neg) > `ACCRUING` (code `INSUFFICIENT` — not enough history yet). *"A read is not an edge until
    it's PREDICTIVE."* Row metrics: **horizon · hit rate · avg edge (bps, 100=1%) · samples · stable.**
- **⚠️ The stack method (the moat):** take a basis fade ONLY when a second, harder-to-arb read AGREES at the same
  hour (`basisXcvd`/`basisXsmart`/`basisXliq` in `axisbt.mjs`) — no-lookahead, keep only conditioners that lift
  stability. Rare intersections → small n → flagged INSUFFICIENT honestly.
- **Timeline (real):** **Sept 14 2026** = first maturation gate — funding-fade graded NOISE, `basis_extreme` the
  first PREDICTIVE axis (but thin/lumpy). **Oct 15 2026 15:00 UTC** = scheduled **Routine
  `trig_01E1U5mnh4qcNMqFDxQKzJcx` "Re-validate Nexus engine — basis + conditioner stack"** → confirm the basis
  stack holds on a real sample (basis:hist/cvd:hist are younger, so obs are still low: 22–203). ⚠️ The date is a
  ROUTINE, not a hardcoded string in the worker — don't grep code for it and conclude "no date."
- **✅ FIRST SCOREBOARD READ WIRED TO THE AGENT (2026-09-20): `BASIS_FADE`.** The gap was total — the brain had
  ZERO references to basis and `deriveSignal` had no such mode. Now: the rule lives ONCE in
  **`app/lib/basisFade.mjs`** (`basisExtremeSide` / `basisFadeFromHistory`, defaults window 168 · minWarmup 48 ·
  p90) and BOTH `axisbt.basisExtremeEvents` (grading) and the brain (trading) call it, so the traded signal cannot
  drift from the graded read. Brain reads `basis:hist:{BARE}` — lab-api's hourly `snapshotFlow` writes it into the
  SAME `NEXUS_AGENT` namespace, so it's ONE KV get, opt-in via `needBasis` (no cost to other agents). Stale >3h or
  under warmup ⇒ no signal, **never a fallback to funding/OI** (tested). Preset `basis-extreme-fade`
  (EXPERIMENTAL · PAPER, $50/5x, 12h hold, 3 trades/day, $10 daily stop). ⚠️ `POST /agent/backtest` REFUSES
  BASIS_FADE with an honest note — basis history is not in the replay, so it would return a silent "0 trades".
  **→ SUPERSEDED 2026-09-24: BASIS_FADE IS BACKTESTABLE (see "Basis replay" below).**
  ⚠️ **Bug the tests caught: `{ ...DEFAULTS, minWarmup, pct }` spreads `undefined` OVER the defaults when the caller
  omits opts → thr `undefined` → the signal NEVER fires. Coalesce per field.** ⚠️ PREDICTIVE grades the READ, not a
  strategy — exits/sizing/fees are unvalidated and it is NOT walk-forward robust. PAPER, second wallet, own record.
- **✅ BASIS × CVD STACK WIRED (2026-09-24): `BASIS_FADE` + `basisConfirm:"CVD"`.** Conditioner rules live ONCE in
  **`app/lib/basisStack.mjs`** (`hourBucket`/`priceByHour`/`classifyCvdDivergence`/`cvdSideForRow`/`basisCvdConfirm`) —
  axisbt's `cvdDivergenceEvents` and lab-api `flow.mjs` (re-export) use it, and the brain calls `basisCvdConfirm` with the
  basis obs hour (`basisFadeFromHistory` now returns `t`). Brain reads `cvd:hist:{BARE}` + `oi:hist:{PERP}` (same KV) only
  when someone opted in (`needBasisCvd`). Absent/failed CVD ⇒ sits out with the reason, never a pass. **Parity test**
  (`app/lib/basisStack.test.mjs`) proves live gate == scoreboard `basis_x_cvd` hour-by-hour on a synthetic tape. Preset
  `basis-cvd-stack` (PAPER). `AXIS_PRESET` (strategyPresets.ts) maps scoreboard axis → preset trading the EXACT rule
  (basis_extreme, basis_x_cvd only) — the /proof SignalRow shows "Load … in the agent →" (forces PAPER via
  `deployToAgent`); unmapped PREDICTIVE reads say "research read — not an agent mode yet".
- **✅ BASIS × SMART MONEY WIRED (2026-09-24): `basisConfirm:"SMART"`.** `basisSmartConfirm` + shared `smByHour` in
  basisStack.mjs (axisbt's smart_fade/basis_x_smart import it); brain reads `sm:hist:{BARE}` (lab-api's hourly
  smart-money cron, same KV) only when opted in (`needBasisSmart`). Agent config = 3-way CONFIRM selector (OFF / CVD /
  SMART MONEY) on BASIS FADE. **Deliberately NOT a preset and NOT in `AXIS_PRESET` yet** — gated on the Oct-15
  re-validation; if it holds, add a `basis-smart-stack` preset + `basis_x_smart` entry (2 lines).
- **✅ BASIS × LIQ-FLUSH WIRED (2026-09-25): `basisConfirm:"LIQ"`.** `classifyFlush` MOVED (unchanged) from lab-api
  `liquidations.mjs` (now re-exports it) into `app/lib/basisStack.mjs`, plus `liqFlushEventsFromHist` (axisbt's
  `liqFlushEvents` delegates to it) and `basisLiqConfirm` (classifies only the rows in the basis hour, each vs its own
  prior history, last-event-wins — same answer as the grader, cheap per bar). Brain reads `liq:hist:{BARE}` only when
  opted in (`needBasisLiq`); replay `makeBasisAt(...,{needLiq})`; loader `needLiq`; label "Basis × Liq-Flush Stack".
  Agent CONFIRM selector = OFF / CVD / SMART MONEY / LIQ FLUSH. **MANUAL only — no preset, not in `AXIS_PRESET`, not in
  the basis sweep grid** until Oct-15 rules. Parity tests: 3 seeds × with/without same-hour rewrites + coverage guard.
- **✅ BASIS REPLAY — BASIS_FADE is backtestable / sweepable / walk-forwardable (2026-09-24).** `backtest.mjs`
  `makeBasisAt(flow,{needCvd,needSmart})` evaluates the SAME shared rules the brain calls (`basisFadeFromHistory` →
  `basisCvdConfirm`/`basisSmartConfirm`) on each series' PREFIX `t <= barClose` (binary-search, memoized per bar) —
  no lookahead, no second implementation. `runBacktest(..., basisAt)` merges it into `raw` at the bar CLOSE (entry
  fills at `c.c`). `backtestConfig`/`walkForwardValidate` take `flowBySymbol`; `runBasisSweep` = confirm (none/CVD/
  SMART) × 4 exits × holds 4/12/24h, ranked by net with per-row `posSymbols` (breadth — prefer it over best-net).
  `strategies.mjs loadFlowHistForBacktest` reads basis/cvd/oi/sm hist, per-symbol maturity
  (`BASIS_BACKTEST_MIN_DAYS=14`, `…_MIN_SAMPLES=200`, binding = thinnest series the config needs), names excluded
  markets, returns `windowDays` → routes SIZE THE REPLAY to recorded coverage (empty pre-history would read as losing
  folds). Routes: `/agent/backtest`, `/agent/backtest/sweep`, `/agent/validate`, + publish-time `revalidateStrategy`
  (`pending_basis` badge). Labels: "Basis Extreme Fade" / "Basis × CVD Stack" / "Basis × Smart Stack". Tests:
  `backtest.basis.test.mjs` (poisoned-future no-lookahead, equals-the-brain, subset, stale, sweep, loader). Perf: full
  3-mkt×60d×36-variant sweep ≈1s CPU. ⚠️ `maxTradesPerDay` is NOT simulated by runBacktest (true for all modes).
- **📊 FIRST REAL BASIS RESULTS (2026-09-24, run in-browser by Ember, 33d of recorded history, fees on).** Sweep
  (BTC/ETH/SOL, 36 variants): Basis × CVD owns the top; best row +$47.78 · 76.9% win · **13 trades** · 3/3 mkts.
  Plain Basis Extreme also nets positive but needs 61–84 trades (churn + fee drag). Walk-forward (6 mkts × 4 folds)
  on a *gated* basis variant: **NOT ROBUST** — +$3.72, 3/6 markets green, 25% folds positive; SOL carries it,
  XRP/LINK zero positive folds. ⚠️ Read with the sample size: 9–13 trades over 33d is a THIN, in-sample result —
  the best sweep row is the overfit a sweep invites. Don't curate the market list to SOL (that's curve-fitting);
  let the window grow (Oct-15 re-validation ≈ 54d).
- **⚠️ Sweep-apply bug (FIXED 2026-09-24):** applying a sweep row merged onto the editor's experimental filters, so a
  saved config with INVERT still on tested the mirror image (+$12.04 → −$21.33). Sweep rows are graded WITHOUT
  filters → `applySweepConfig` resets `EXPERIMENTAL_FILTERS_OFF` (invert/regime/smart/session/vol/volScaled/
  breakeven; lives in `app/utils/agentPrefill.ts`) before applying the row. **Same rule for EVERY whole-strategy load
  (fixed 2026-09-25 after Ember hit it on a preset):** Quick-start presets, scoreboard "Load", Proof "Deploy", and
  trader COPY all replace the filter set; `deployToAgent(..., { replaceFilters: true })` sets a flag the RECEIVER
  applies (JSON drops `undefined`, so the sender can't clear fields). Partial hand-offs (Intel symbol, thesis) keep
  the user's filters. `strategyLabel` now names filtered/inverted basis runs ("Gated …"/"Inverted …")
  and the Backtest card prints **TESTED AS: <label>** (amber when inverted).
- **⚠️ Proof hero receipts rule:** every receipt on `FeaturedLead` must be true of the EXACT preset its Deploy button
  loads. Ember's first cut printed $ figures from a user-EDITED config next to the preset's button — replaced with
  preset-true receipts. **✅ Clean preset run (2026-09-25, Ember, TESTED AS "Basis × CVD Stack", no edits, 33d, fees
  in):** backtest +$22.62 · 78.6% · 14T (BTC 2T +$2.39 · ETH 8T +$10.32 · SOL 4T +$9.91); walk-forward (6 mkts × 4
  folds) **NOT ROBUST** — +$32.06, 4/6 mkts green, 42% folds (BTC 1/4 · ETH 3/4 · SOL 3/4 · BNB 0 trades · XRP 3/4
  +$11.86 · LINK 0/4 −$2.43). These are on the hero now, dated. The dirty run's "XRP fails" was config contamination.
  ⚠️ Fold consistency counts EMPTY folds as non-positive (BNB = 4 empty folds) — conservative by design; at 14 trades
  the verdict is sample-limited, not a clean fail. Don't loosen the math to make it pass; let history grow.
- **⚠️ HOLD-HORIZON MISMATCH (found 2026-09-25, Ember's catch) + the EXIT-MATCHED GRADE.** Both wired presets exit
  TP 2.5 / SL 2 / **maxHoldHours 12**. Sept-25 per-horizon grades for basis_x_cvd: **4h PREDICTIVE (+23.4bps n29) ·
  12h NOISE (−4.6bps, n32, NOT stable) · 24h PREDICTIVE (+168.3bps, 76%, n25)** — the presets time out in the one
  window the scoreboard grades NOISE (basis_extreme 12h = PROMISING, not stable). And the headline R PREDICTIVE is
  graded on the FROZEN R contract (1.2×ATR stop, 1.5R, 168h), NOT the preset exit. Non-monotonic at n≈30/bucket →
  may be noise, but it's a real live/graded mismatch. **Fix = measurement, not a preset edit:** the scorecard now
  carries a per-axis **`exit`** block for reads a preset trades — the read walked through the PRESET's own exit on
  the logged hourly candles via the backtest's **`stepExit`** (extracted from `runBacktest`, which now calls it — ONE
  exit path → exec `evaluateExit`), adverse-extreme-first, right-censored (no exit by end of data ⇒ left out), NET of
  3bps/side → `{verdict, samples, hitRate, netBps, stable, exits:{TP,SL,TIMEOUT}, avgHoldH}`. Informational — does NOT
  change the read's verdict. Contracts in **`app/lib/axisExits.mjs`** (`AXIS_EXITS`), pinned to strategyPresets.ts by
  `axisExits.test.mjs` (text-parsed; also asserts every `AXIS_PRESET` has a contract). Cache key `axisbt:v2`. /proof
  SignalRow now shows every horizon (not just best) + an "AS THE PRESET TRADES IT" line. **The live Basis × CVD Stack
  paper run stays 12h = the control group — don't edit it;** a 24h variant is a Lab test (Load → 24h → Test+Validate),
  decided at Oct-15. Tests: `workers/nexus-lab-api/axisbt.exit.test.mjs`.
  **First live exit read (Sept 25):** basis_x_cvd via preset exit = PROMISING +3.2bps net, 48%, n33, NOT stable, exits
  TP4/SL6/TIMEOUT23 · basis_extreme via preset exit = **NOISE −8.3bps net, n299**, TP50/SL66/TIMEOUT183. The 12h cap,
  not the TP, decides most trades — the mismatch bites.
  **+ `exit24h` (same day):** a 24h-hold copy of the preset exit (same TP/SL) graded BESIDE the 12h `exit`. Both now
  graded as the agent trades: `tradeableExitTrades` = ONE position per market (skip events while open), a SHARED
  entry window (entries ≥24h before each market's last candle, so neither variant sees trades the other can't), and
  an **`oos`** sub-block = trades entered after `EXIT_OOS_CUTOFF_MS` (2026-09-25 04:00 UTC) — 24h was PICKED from this
  data, so its in-sample grade flatters it; oos is the honest test. Cache `axisbt:v3`. Baseline (07:26 UTC):
  basis_x_cvd 12h PROMISING +11.9bps n28 not stable (TIMEOUT 19/28) vs **24h PREDICTIVE +57.8bps 63% n27 stable**
  (TP11/SL8/TIME8); basis_extreme 12h NOISE −10.0 n148 vs 24h PROMISING +6.4 n127 not stable. Decide at Oct-15 on oos.
  **24h Lab run (borst, Sept 25, only maxHoldHours 12→24):** backtest +$31.35 · 84.6% · 13T (vs 12h +$22.62/14T);
  walk-forward **NOT ROBUST** +$45.46, 4/6 mkts, 42% folds (vs 12h +$32.06) — better capture, same robustness, tiny
  n, in-sample. Routine compares Oct-15 reads against this datapoint (doesn't re-recommend the test).
  **Forward PAPER A/B (from Sept 25):** 12h control `0x9A30…cB28` vs 24h variant `0xa77c…a9a7`, identical config
  except maxHoldHours. Both ledgers RESET Sept 25 (old CONFLUENCE-era ledgers archived in `docs/paper-archive/`) —
  reset, not date-filter, because `paper_agg` is accrued at close and can't be split by date. Oct-15 routine reads
  both via public `GET /agent/:addr` (step 2c) with a guard if `firstTradeAt` predates the reset.
  ⚠️ The 12h wallet also has `fundingPercentileMin:95` (leftover) — INERT on BASIS_FADE (brain applies it to
  FUNDING_ONLY/CONFLUENCE only), so the A/B still differs only in hold.
- **✅ LIVE-vs-GRADED PARITY (2026-09-25):** `app/lib/paperParity.mjs` (`paperParity`/`axisForConfig`/
  `entriesFromPaperTrades`/`unsimulatedFilters`, tested) + public **`GET /agent/:addr/parity?since=&until=`**. Pairs
  each paper entry (scale-out slices collapsed by `parent_id`) with the graded event it traded (same coin + side,
  entry 0–3h after the basis obs) and lists every graded event the agent was FREE to take but didn't. A miss is
  "explained" only if the agent had NO free moment in the event's ~1h action window (walk of [open, close+15m
  cooldown) intervals — one position at a time across ALL markets), or a daily cap (trailing 24h, "likely"), or
  another market won the brain's single per-wallet signal. Leftovers = DRIFT; regime/smart/session/vol filters →
  UNVERIFIABLE (not simulated by the grader). `fundingPercentileMin` + `maxSignalAgeSec` deliberately NOT counted
  (inert on BASIS_FADE / latency-only). `paper/reset` now stamps `state.paper_reset_at` → default window start.
- **Basis Extreme Fade PAUSED (2026-09-25):** `AXIS_PAUSED` in strategyPresets.ts hides its /proof Load + shows why;
  AXIS_PRESET/AXIS_EXITS untouched so it's still graded. Revert = delete the line. Paper Blotter is now a Collapsible.
- **⚠️ Same-hour semantics (bug caught 2026-09-24):** the grader builds hour→side Maps by iterating the stored array
  and `.set()`-ing only rows WITH a side → **the LAST row in a rounded hour that has a side wins**; a later neutral row
  doesn't erase it. The first CVD gate used `.find` (FIRST row) — it diverged whenever a cron wrote twice in one
  rounded hour. `sideAtHour` in basisStack.mjs mirrors the grader exactly. Parity tests now run 3 seeds × with/without
  same-hour rewrites for BOTH gates + a coverage guard so parity can't pass vacuously.
- **✅ Cloud env now reaches `og.nexustradinglabs.com`** (borst allowlisted it 2026-09-25; verified HTTP 200 from a
  cloud container) — sessions/routines can read the scorecard directly. The Oct-15 routine was created via http_api so
  agents can't edit it; its prompt lives in `docs/routines/revalidate-basis-2026-10-15.md` (Sept-25 scorecard
  checkpoint + clean-preset baseline inside). **Sept-25 scorecard:** basis_extreme PREDICTIVE (R +0.13, n315, stable) ·
  basis_x_cvd PREDICTIVE (R +0.31, n35, stable) · basis_x_liqflush PREDICTIVE (R +0.11, n93, stable) · basis_x_smart
  **slipped to PROMISING** (R +0.14, n141, NOT stable) — confirms keeping SMART off the presets. Backtest/validate
  routes need a PRO walletSig → routines can't run them (never put a wallet key in a routine).
- **⚠️ Scoreboard reads are NOT agent signalModes yet.** The agent trades CONFLUENCE/FUNDING/OI/MOMENTUM/
  MEAN_REVERSION only; basis/CVD/RSI reads are the research/proof layer. Findings feed house defaults + manual
  Thesis Engine use. ~~Wiring a PREDICTIVE read → a one-click agent strategy = roadmap~~ **→ DONE for basis (see above); CVD/RSI still research-only.**
- **Landing Proof section** (`nexus-landing` `#proof`) speaks to this in-cadence: "many reads, graded in public,
  most still noise, always sharpening" — NOT "one signal." Keep it that way.

## Bankr SKILL + marketing assets (where things live)
- **Bankr skill** = `github.com/BankrBot/skills` → `nexus-trading-labs/SKILL.md` + `references/*.md` (markdown skill,
  YAML frontmatter `name: nexus` + trigger `description`). Published/maintained by Nexus. Update = edit SKILL.md/refs,
  PR to BankrBot/skills. Our fork = **`StephenBorst/skills`**, branch **`add-autonomous-agent`** (agent control +
  full config surface) — ✅ MERGED into `BankrBot/skills` (the agent-control module is live in the published
  Bankr skill). Local staging clone: `C:\Users\steph\bankr-skills-stage`.
- **Repo source-of-truth copies:** `docs/SKILL.md` (full updated skill), `docs/bankr-skill-agent-module.md` (=
  `references/agent.md`), `docs/bankr-agent-spec.md` (build spec), `docs/skill-agent-additions.md` (apply guide).
- **Marketing:** `marketing/lab-article.md` (flagship X long-form article + 3 hook tweets + pull-quotes),
  `marketing/build-in-public-series.md` (7 daily founder posts grounded in shipped work). Voice = landing/brand
  register (cypherpunk-terminal, "verify don't trust"). $NEXUS framed cosmetic-only (Howey).
- **⚠️ Bankr "signer rejected it" = Bankr-side wallet signing failure, NOT our skill/code.** Even a plain native
  `sign hello` fails → it's the Bankr agent wallet (needs funding/init) or a Bankr outage, OR the API key lacks
  Wallet+Agent API / has an allowed-recipients restriction. Our endpoints never get hit if the sig fails. Don't
  reinstall the skill for this. Isolation test: ask Bankr to sign a trivial message; if that fails too → 100% Bankr.
- **Agent→public-feed bridge (exec):** `PUBLISH_AGENT_FEED=true` writes the bot's REAL autonomous entries/closes to
  `agent:feed:{addr}` (lab-api /feed merges them) so the agent has a live heartbeat (cold-start fix). PAPER trades
  excluded (`PUBLISH_PAPER_TO_FEED=false`) to keep the feed = "real calls only."
- **Landing fix (this session):** removed a hardcoded fabricated `TVL $18.3M` (no live source) → hero now 3 live
  stats (Volume/OI/Markets); standardized "93+"→"90+" markets. Deployed + pushed to `StephenBorst/nexus-landing`.

## Leaderboard integrity (cypherpunk hardening — tiers 1-3)
The public agents leaderboard ranks on a risk-adjusted score from live `agent_trades`
(Supabase). Trust hardening, all on `main`:
- **Tier 1 — write-path (✅ DONE + VERIFIED 2026-06-09):** exec logs with `SUPABASE_SERVICE_KEY`
  (secret SET on nexus-agent-exec; falls back to anon only if unset). RLS is ENABLED on `agent_trades`
  with a single `SELECT`-only policy for `anon`/`authenticated` — a pre-existing `allow all` (FOR ALL TO
  public) policy was the real hole and has been DROPPED. Verified with the public anon key: SELECT→200,
  INSERT→401 (`42501` RLS violation), DELETE→0 rows (count unchanged 68→68). `service_role` bypasses RLS,
  so exec writes are unaffected. ⚠️ Since anon writes are now blocked, `service_role` is the ONLY writer —
  if agent trades stop appearing in History/leaderboard, the `SUPABASE_SERVICE_KEY` secret is wrong; re-set
  it (canary: `supabase log failed` in exec logs). ⚠️ Lesson: in Supabase, `CREATE POLICY` does NOT enable
  RLS, and policies are OR'd — a leftover `allow all` silently negates restrictive ones. Verify, don't assume.
- **Tier 2 — exchange-auditable (✅ DONE + VERIFIED 2026-09-25):** every closed trade records Orderly
  `entry_order_id` + `close_order_id` so records are independently verifiable against the exchange. All six
  optional columns exist on `agent_trades` (`entry_order_id`, `close_order_id`, `source_leader` checked by borst
  in the dashboard; `parent_id`, `exit_seq`, `strategy` confirmed via the live `GET /agent/:addr` row shape).
  Live rows carry real order IDs since 2026-07-09; older rows are pre-migration nulls (can't be backfilled).
  `source_leader` (copy-loop grading) → `GET /agents/copy-record/:leader` + `/creator/earnings/:leader` are
  LIVE, no longer dormant. `logAgentTrade` (exec) keeps a core-row retry ONLY as resilience: if the full row is
  ever rejected, the trade still lands (P&L on the ledger) but WITHOUT order IDs → logged as `console.error`
  "auditable insert REJECTED". Seeing that line = investigate, not normal.
- **Tier 3 — verifiable ledger (DONE, live):** `GET /agents/ledger` → canonical records + SHA-256
  `ledgerHash` anyone can recompute (verified: Python recompute == server hash). Each read checkpoints
  an append-only prev-linked hash chain (`GET /agents/ledger/chain`). Frontend TOP AGENTS shows the hash
  + "verify ↗".
- **Tier 3+ — on-chain anchor (code DONE; needs deploy+fund):** `contracts/NexusLedgerAnchor.sol`
  (Arbitrum, append-only `anchor(bytes32 root, uint256 count)`, owner-only, emits `Anchored`). New worker
  `workers/nexus-ledger-anchor` (hourly cron, viem) reads /agents/ledger, dedupes vs on-chain `latestRoot`,
  and commits the root when changed; writes proof to KV `agent:ledger:onchain`. lab-api `/agents/ledger`
  merges that as `onChain {root,txHash,verified,explorer}`; frontend shows "⛓ ANCHORED ON-CHAIN ↗" when
  verified. ⚠️ HANDOFF: (1) deploy the contract on Arbitrum from a DEDICATED hot wallet (Remix), (2) fund
  that wallet w/ ~$2 ETH on Arbitrum, (3) set `LEDGER_ANCHOR_CONTRACT` var + `ANCHOR_PRIVATE_KEY` secret on
  nexus-ledger-anchor, (4) `npm i` + `npx wrangler deploy` the worker. Until then it no-ops safely.
- **✅ DEPLOYED + LIVE (Session 2026-06-02):** contract `0x57a698df84a44F3dA3dac3E08CA455a55A4eff84`
  (Arbitrum), signer = a dedicated fresh hot wallet (~$3 gas, key in `ANCHOR_PRIVATE_KEY` secret). Both
  the AGENT ledger (`0x1fa8…`) and human CALL ledger are anchored + `verified:true`.

## Human call leaderboard (trustless — same standard as agents)
- A human thesis = a **call**. Outcomes are graded OBJECTIVELY from PUBLIC price (Orderly `GET /tv/history`,
  1h OHLC, first-touch TP1-vs-SL; same-candle = LOSS conservative) — NOT self-reported. So `actualPnl`/status
  the user types is ignored for ranking.
- `GET /theses/leaderboard`: ranks public-thesis authors by hit-rate + avg-R over ≥5 resolved calls
  (net-positive-R gate, sample-confidence shrink). `GET /theses/ledger`: canonical SHA-256 of the public
  call set (proof-of-call fields + createdAt), recomputable, prev-linked chain (`/theses/ledger/chain`),
  `onChain` proof merge. anchor worker `anchorOne()` anchors agents + theses each run (separate roots/events,
  KV-deduped). Frontend: **VERIFIED CALLERS** board atop Feed RANKS (`app/pages/feed/index.tsx`).
- ⚠️ Honest ceiling: the Orderly *trading API* (`/v1/position_history`, `/v1/positions`) is private-auth (own account
  only) — that's why we grade the CALL vs public price for the caller leaderboard. **BUT that is NOT the only Orderly
  data source** (corrected 2026-07-17): the **public dashboard indexer** `orderly-dashboard-query-service.orderly.network`
  exposes per-account rankings + positions + realized/unrealized PnL across the whole broker network with NO auth
  (`/ranking/realized_pnl`, `/ranking/positions`, `/trades`, `/get_account_volume_statistic`; limit max 200). Smart
  Money uses it as the PRIMARY source (see below). Don't repeat "Orderly per-address is fully private" — the trading
  API is; the settlement indexer isn't.

## Engagement layer — competitor-informed, on the trustless core (2026-06-15) ⭐
Studied FOMO (fomo.family) + Legend (app.legend.trade) — both win on live-positions feeds + clans/arena +
frictionless onboarding, but rank on SELF-REPORTED PnL. Built their engagement surfaces on our verifiable
grading (the moat they can't copy). 5 shipped this session (#3 Arena/Seasons deferred):
- **#1 LIVE NOW feed** — `GET /agents/live` aggregates currently-OPEN positions (agents from
  `agent:state.current_position` non-paper + opted-in humans), uPnL **recomputed from PUBLIC mark price**
  (never client-claimed). Frontend `app/pages/feed/LiveNow.tsx` (top of feed view, 25s poll, fail-soft).
  **Human opt-in (Phase 2):** `POST /live/publish {walletAddress, walletSig, positions, displayName?, pfpUrl?}`
  — can't read others' positions server-side (private key), so the CLIENT publishes a snapshot stored with a
  ~6-min TTL (`live:human:{addr}`, self-expiring = nothing retained). ecrecover-authed. Mini app has a 📡
  Broadcast toggle (publishes on each status refresh w/ Farcaster name/pfp; off = clears).
- **#2 Desks** (clans) — `app/pages/feed/Desks.tsx` in Feed RANKS. `/desks` create/join/leave (walletSig
  ecrecover, ONE desk per wallet via `desk:mem:{addr}`, `desk:rec:{id}`; auto-disband empty + owner transfer),
  `GET /desks` ranked board, `GET /desks/:id` detail. **Desk score = AGGREGATE of members' graded calls** via
  the shared `computeCallerStats(env)` (extracted from /theses/leaderboard so the two never drift).
- **#4 Real-time alerts** — `app/components/LiveAlerts.tsx` (GLOBAL, mounted in `App.tsx`). Polls /agents/live,
  diffs new opens (skips backlog on first load), bottom-left toasts + opt-in OS `Notification`. No push infra.
- **#5 Watch-only** — `app/pages/feed/WatchOnlyBanner.tsx` (disconnected visitors only). Frames the already-
  public surfaces as explore-before-connect. Dismissible.
- **#6 Merit ranks (identity ladder)** — `rankCaller(stats)` in lab-api `logic.mjs` (+tests). Earned from
  graded record, NOT bought (distinct from $NEXUS holder tiers): ▪ Signal (5+ calls, net+R) → ◆ Sharp (15+,
  ≥50%, ≥0.5R) → ✦ Apex (30+, ≥55%, ≥1R). Attached to /theses/leaderboard entries (`meritRank`) + green badge
  on VERIFIED CALLERS board.
- ⚠️ All of the above only POPULATE with real usage (open positions / 5+ graded calls / formed desks) — sparse
  at cold-start BY DESIGN (fail-soft renders nothing), not broken. KV keys live in LAB_STORE.

## $NEXUS token & holder perks (pure-meme + flywheel UI)
$NEXUS = pure community meme token on **Base** (`0x3D958634ab725B627919EF8F2Ed59227309fDba3`, 100B supply,
18 decimals). **Zero built-in utility / revenue share** — perks are cosmetic/access only; the framing is
baked into the code comments. Keep it that way (Howey). The real lawyer-gate is the first buyback (see the Sept-25 SEC FAQ note + `docs/treasury-buyback-policy.md`).
- **Tier hook** (`app/hooks/useNexusTier.ts`): reads $NEXUS balance on Base via viem with a CORS-friendly
  RPC `fallback()` (llamarpc/publicnode/drpc — the default `mainnet.base.org` 403s/CORS-blocks the browser,
  which silently hid badges). Module-cached, fail-soft. **Tiers (low→high): ▪ OPERATOR 50M / ◇ ARCHITECT 100M
  / ◆ ORACLE 250M** (`TIER_THRESHOLDS`). Non-hook `fetchNexusTier` + `fetchBurnStats` for list/widget use.
- **Badge** (`app/components/NexusTierBadge.tsx`): terminal-green chip, renders null for non-holders. On
  Trader profiles + Feed (trader rows + thesis cards).
- **Holders Room** (Lab tab, `app/components/HoldersRoom.tsx`): gated by connected wallet's tier. Thesis
  visibility is a **3-state cycle PRIVATE → PUBLIC → ◆ HOLDERS** (`holdersOnly` flag in ThesisTrade); holders-only
  theses are EXCLUDED from public `/feed` and shown only here. Server-gated endpoint **`GET /feed/holders?
  address=&ts=&sig=`** in lab-api: verifies an EIP-191 signed+timestamped challenge via **secp256k1 ecrecover
  (`@noble/curves`)** (recovered addr must match, ts fresh ≤10min) THEN on-chain balanceOf ≥ `OPERATOR_MIN`.
  ⚠️ **`OPERATOR_MIN` in lab-api MUST match the frontend OPERATOR threshold** (currently 50M) or badges/gate drift.
  Frontend caches the signature per-session (8min) to avoid re-prompting.
- **Public flywheel strip** (Feed header + Lab header + landing): `NexusMarket` (live price/MC/vol/liq from
  GeckoTerminal, **client-side fetch** — GeckoTerminal/CoinGecko 403 datacenter IPs; carries the GT link-back) +
  `NexusTreasury` (USDC balance of the Safe on Arbitrum; renders NOTHING until `NEXUS_TREASURY_ADDRESS` is set —
  one-line activation when the Safe exists) + `NexusBurnCounter` (on-chain $NEXUS at dead address as % of supply;
  honest at 0 until first burn). All fail-soft.
- **Landing** (`nexus-landing` repo, static `index.html`, `wrangler deploy` — no CI): has its own $NEXUS market
  strip (inline GeckoTerminal fetch). ⚠️ `.assetsignore` excludes `.git` (the assets dir is repo root — was
  publicly serving `.git/`). Announcement-tweet arc drafted: GeckoTerminal verified → Treasury Safe live → flywheel.

## Buy $NEXUS / swap (investigated in depth — don't re-derive)
- **v1 SHIPPED:** `BuyNexusButton` deeplinks to Uniswap on Base (`app.uniswap.org/swap?chain=base&inputCurrency=ETH&
  outputCurrency=<NEXUS>`), lives in `NexusMarket` so it shows on Feed + Lab + landing. This is the ONLY reliable
  $NEXUS buy path today (Uniswap natively handles the pool's hook + dynamic fee).
- **The pool (Uniswap v4 on Base):** poolId `0xdc5be7…2009`. PoolKey = currency0 **$NEXUS** / currency1 **WETH**
  (`0x4200…0006`), **dynamic fee** (`0x800000`), tickSpacing 200, **custom hook `0xbb7784a4d481184283ed89619a3e3ed143e1adc0`**
  (launchpad/Clanker-style). PoolManager `0x498581ff…2652b2b`, V4Quoter `0x0d5e0F97…532048D`. Only ~$63K liq.
- **Hook vetting (DONE, swap-friendly):** flags = beforeInitialize/add-liq/remove-liq + **beforeSwap/afterSwap**,
  **NO returnsDelta** (doesn't skim swaps). `V4Quoter.quoteExactInputSingle` returns clean numbers through it with
  empty `hookData` (verified: 0.01 WETH → ~25.2M NEXUS). So an **embedded in-app swap is GO-able + low-risk** (~1wk):
  Universal Router `V4_SWAP` w/ the full PoolKey, `zeroForOne:false` for WETH→NEXUS, `WRAP_ETH` for native ETH in.
- **⚠️ NO aggregator routes $NEXUS yet:** LiFi AND Fabric (`route.withfabric.xyz/v1/quote`, header `X-App-Id`) both
  return **"No route found"** for WETH→NEXUS while routing majors (WETH→USDC) fine. It's the **v4-hook indexing gap**,
  NOT pool-specific — they'll auto-route NEXUS once they index v4 hooks OR the pool deepens. So embedded $NEXUS swap =
  hand-build (vetted) OR wait. Real lever = **liquidity depth** (treasury buyback / LP seeding).
- **Spandex/Fabric:** ⚠️ **NO LONGER IN THE REPO (verified 2026-09-04, repo-wide grep).** The old
  `app/components/SpanDEX/*` + `useSpanDEX.ts` scaffold (cloned `github.com/withfabricxyz/spandex`, placeholder
  `api.fabric.com/quote`, never wired) is GONE — the only "fabric" hits left are the word "fabricated" in comments.
  Reviving Fabric is a FRESH build, not a restore. Fabric endpoint = `route.withfabric.xyz/v1/quote` (header
  `X-App-Id`); Fabric AND LiFi both return "No route found" for WETH→$NEXUS (Uniswap v4-hook indexing gap, not the
  pool) while routing majors fine — so an aggregator still can't buy $NEXUS; Uniswap deep-link (or the vetted
  hand-built v4 Universal Router call) remains the honest $NEXUS path.
- **⚠️ In-app spot = router + sign, NOT a Nexus book.** Orderly SDK ships ZERO spot (perp packages only; grep the
  hooks/types dist — no `spot` API). WooFi (`woofi-swap-widget-kit`, a standalone WooFi pkg, not `@orderly.network/*`)
  is the ONLY in-app fill, and only for majors it quotes. `/token` swap layer (SHIPPED, quote-only, no signing):
  Solana non-perp → real keyless **Jupiter** quote (`quote-api.jup.ag/v6/quote`, `swapQuote` in `app/pages/token/
  data.ts`) → "Swap via Jupiter" preview (deep-links to complete). EVM → named Uniswap deep-link (no keyless
  WooFi/0x quote to trust). Perp-listed names keep Long/Short on Nexus, never probed. No quote + no venue →
  disabled "No route", never a fake Buy. NEXT: in-app signing (approvals exact-amount, slippage cap, confirm step)
  as a SEPARATE reviewed pass — the highest-risk code in the app.
- **✅ Fabric EVM quote LIVE-VERIFIED (2026-09-04), contract PINNED.** Worker `GET /swap/quote` (nexus-lab-api)
  injects secret `FABRIC_APP_ID` (set) as header `X-App-Id` and calls `route.withfabric.xyz/v1/quote`. **Request =
  0x-style query:** `chainId`, `sellToken`, `buyToken`, `sellAmount` (our client sends neutral `chain`/`tokenIn`/
  `tokenOut`/`amount`; the worker maps to Fabric's names — client never learns the dialect). **Response (verified
  200):** quote out amount = `amountOut`; price impact = **`priceImpactBps` (BASIS POINTS**, 50 = 0.5% — worker
  normalizes `/100` to a percent so client `priceImpactPct` matches Jupiter). **Execution route (for signing):**
  `approval.{token,amount,spender}` (the ERC-20 approve — spend EXACT `approval.amount`, never infinite),
  `transaction.{to,data,value}` (the swap tx to sign), `minimumAmountOut` (the slippage floor). Worker returns the
  RAW body so these stay available. ⚠️ **Fabric has a curated TOKEN LIST — an unlisted token 404s** (e.g. PEPE
  404'd; WETH/USDC on Base work). That's fine: worker → ok:false → client falls back to the honest Uniswap
  deep-link. So "Swap via Fabric" shows for Fabric-listed EVM tokens; unlisted → Uniswap. SIGNING pass builds on
  the execution fields above (exact-amount approve → tx via the mini-app `eth_sendTransaction` pattern → confirm
  modal showing amount/minReceived/venue → /security-review before merge). Solana signing still deferred (no wallet wiring).
- **⚙️ In-app EVM/Fabric BUY signing — BUILT (branch `claude/guest-lab-half-shipped-1dkw0n`), pending a small live test
  before merge.** `app/pages/token/swapExec.ts` = the ONE signing site: `planBuy()` fetches an EXECUTABLE Fabric quote
  (worker `/swap/quote` now forwards an optional `taker` + surfaces normalized `approval{token,amount,spender}`/`tx{to,data}`/
  `minOut` alongside `raw`), VALIDATES hard, then `executeBuy()` signs via `useWalletConnector().wallet.provider`
  (`eth_sendTransaction`). Guards (all pre-signature): approve token MUST === our hardcoded USDC (never Fabric's claimed
  token — we encode approve against OUR usdc addr), approve amount MUST === exact sellAmount (never infinite), tx.value
  MUST === 0 (else ETH-drain — and we force `0x0` on send anyway), wallet MUST be on the token's chain (ensureChain
  re-reads + aborts), swap receipt status 0x0 → surfaced as a revert (no fake "sent ✓"). ERC-20 calldata is hand-encoded
  (`0x095ea7b3` approve / `0xdd62ed3e` allowance) — **verified byte-for-byte against viem** (caught a double-`0x` bug in
  review). GATED + ADDITIVE: the button only appears for Fabric-quoted EVM tokens, side=BUY, wallet connected; the honest
  Uniswap deep-link never leaves (demoted to a secondary line). BUY-only (USDC→token); Solana + SELL stay deep-link.
  Confirm modal shows pay/receive-est/min-received/slippage/impact; nothing signs until "Confirm swap". ⚠️ First live
  test: confirm Fabric's `taker` param name (we send `taker`; if unhonored the takerless tx still binds recipient to
  msg.sender) and run a small real buy on a Fabric-listed token (e.g. WETH/BNKR on Base) before trusting.

## ✅ Flash (Definitive) spot router — HARDENED 2026-09-25 (read before touching FlashSpotButton)
- Flash = the THIRD EVM spot router on /token (beside Fabric + the Uniswap deep-link), `app/pages/token/FlashSpotButton.tsx`,
  worker proxy `POST /flash/quote|order` (adds secret `FLASH_API_KEY`). Market BUY/SELL; SL/TP bracket attaches only when
  the quote echoes one back.
- **⚠️ Flash's quote returns an UNLIMITED approve** (`approve(0x5d00…8f78, 2^256-1)`, verified live) + an EIP-712
  `FlashOrder` {swapper, vault, recipient, fromToken, toToken, fromAmount (base units), salt, deadline}, domain
  `DefinitiveFlashAllowance` v1, verifyingContract = the SAME `0x5d00000873b6bf41539e6f5365b0ff7d3c368f78` (pinned as
  `FLASH_ALLOWANCE`). Before the fix both went to the wallet unchecked (setup-tx ETH value forwarded as-is).
- **Guards (`app/lib/flashGuards.mjs`, tested incl. a live Base quote), all BEFORE any wallet prompt:** `ensureChain`
  first → `checkFlashOrder` (FlashOrder, this chain, pinned contract, **swapper AND recipient = wallet**, the trade's
  tokens, `fromAmount ≤ typed size + 1 base unit`, deadline within 1h) → each setup tx must pass `checkFlashSetupTx`
  (zero-ETH `approve` of fromToken to the pinned spender) and we send **OUR exact-amount `encodeApprove(FLASH_ALLOWANCE,
  fromAmount)`** instead of Flash's unlimited one (0-amount resets pass through) → any `permitTypedData` is REFUSED →
  bracket must pass `checkFlashBracket` (wallet-bound FlashOrder selling the bought token; no amount/deadline bound —
  it rests). Approval receipts must be status 0x1; pending/reverted stops the flow. Decimals via `eth_call decimals()`.
- **Key proxies gated** (`workers/nexus-lab-api/keyProxy.mjs`, tested): `/flash/*` + `/swap/jup/*` accept only our
  origins (ALLOWED_ORIGINS + `*.nexus-trading-lab.pages.dev`, https) and a per-IP isolate-local budget (flash 30/min,
  jup 120/min) → 403 `origin_not_allowed` / 429. Verified live. Only browser code calls them.

## ✅ Portfolio replay — the backtest of what the AGENT does (2026-09-25)
- `backtestConfig` used to replay each market on its own; the agent holds ONE position across the watchlist, gets the
  brain's single best signal per tick (ties → first in `config.symbols`), and is gated by daily caps. Now
  `runPortfolioBacktest(markets, config)` walks all markets on one merged hourly timeline with the SHARED `entryAt`
  (extracted from runBacktest, which now calls it) + `stepExit` + the exec's own `dailyCapBlocked`/`shouldResetDaily`.
  Returns aggregate + perSymbol + `blocked {busy, otherMarket, dailyCap, cooldown}`. `backtestConfig` returns
  `portfolio`; Backtest card shows "AS THE AGENT TRADES IT" under the per-market tiles ("EACH MARKET ON ITS OWN").
  Tests (`backtest.portfolio.test.mjs`): one market + no caps == runBacktest trade-for-trade. `maxTradesPerDay` IS
  simulated in the portfolio replay. **Sweeps (`runSweep`/`runBasisSweep`) are RANKED by the portfolio net** (+ the
  user's daily caps via `agentCaps`; per-market sum kept as `indepNetUsd`/`indepTrades`, shown on hover) — ranking by
  the per-market sum rewarded overlap (long holds on several markets at once). **Walk-forward verdict stays PER-MARKET**
  (breadth × time — "does the edge exist on each market on its own" — unchanged + comparable with Sept-25 baselines) and
  now also returns `portfolio` {watchlist = the config's own symbols ∩ validate universe, netUsd, trades, folds,
  foldsPositive} via `portfolioFolds`.
  **📊 Portfolio baselines (Ember, Sept 25, 33d):** Basis × CVD 12h +$14.18 · 80% · 10T · PF 3.14 (old per-market
  +$22.62/14T: 9 signals while in a position, 1 lost to another market) · 24h +$14.36 · 77.8% · 9T · PF 3.39 (old
  +$31.35/13T). **12h vs 24h = a WASH in backtest** — the 24h "edge" was phantom overlap; the hold decision rests on the
  paper A/B + `oos` exit grades. /proof hero receipts updated to the portfolio numbers.
  **Portfolio-ranked basis sweep (Ember, Sept 25):** Basis × CVD = 5 of the top 8, green 2–3/3 mkts, across TP settings;
  top row Basis Extreme +$21.85 but 1/3 mkts (ignored); Smart best = 9th. ⚠️ All CVD rows share the SAME ~10 entries
  (only exits vary) → proves exit-robustness, NOT entry edge.
- **✅ RANDOM-ENTRY BASELINE (2026-09-25):** `randomEntryBaseline(markets, config, realTrades, {runs:300, seed:7})` in
  backtest.mjs — replays the real portfolio trades' markets + count + per-market long/short mix through the SAME exit
  path (`openPosition`/`stepExit`, vol-scaled levels honored, fees) at RANDOM entry bars (room left for the time exit;
  right-censored dropped), seeded mulberry32 → `{pctBeaten, realNetUsd, randomMedianUsd, randomP5Usd, randomP95Usd,
  verdict}`: BEATS_RANDOM ≥95 · LEANS_ABOVE ≥80 · NOT_DISTINGUISHABLE; <5 trades → TOO_FEW_TRADES. Attached as
  `portfolio.baseline` by `backtestConfig`; Backtest card prints "vs random entries: beat X% of 300 replays". Tests
  (`backtest.baseline.test.mjs`): foresight ≥95, worst timing ≤5, random entries mid-pack, reproducible, per-market.
  `tradesToSeparate(pct, n)` (≈ n·(z95/z)², Acklam `probit`) → `tradesNeeded`/`moreTradesNeeded` on every baseline
  (rough guide; null at/below random). **First readings (Sept 25, 3 mkts, 33d):** 12h control 86.7% (random median
  $0.33, ~22 trades needed) · 24h 79.3% (median $1.13, ~37) — neither decisive; longer hold = more drift in random.
- **✅ EVIDENCE ACROSS ALL RECORDED MARKETS (2026-09-25):** public **`GET /intel/evidence?axis=basis_x_cvd&hold=12|24`**
  (cached 1h `evidence:v1:{axis}:{hold}`) — `evidenceAcrossMarkets` replays the preset's EXACT config (built from
  `AXIS_EXITS`, which now also carries signalMode/basisConfirm/leverage/capitalPerTrade, all pinned to strategyPresets.ts
  by `axisExits.test.mjs`) on every one of the 12 scorecard coins with mature basis+CVD history, EACH ON ITS OWN (the
  entry question, not agent P&L), pools the trades, runs `randomEntryBaseline` on the pool. /proof basis_x_cvd row shows
  "ACROSS N RECORDED MARKETS …" (EvidenceLine). ⚠️ Markets move together → pooled ≠ independent (stated in UI + API).
  The Oct-15 routine reads it (step 2e) — no wallet signature needed. Candles come from recorded `candle:hist` (KV, ~95d) — a burst
  of 36 Orderly tv/history calls tripped a Cloudflare challenge (HTML → JSON parse fail); Orderly is only a per-market
  fallback, failures are excluded + named. **First reading (Sept 25, 9 mature mkts, 33d):** 12h +$8.13 · 30T · 53% ·
  PF 1.15 · vs random 75.7% (median −$13.37) · ~138 more trades · 24h +$52.27 · 29T · 62% · PF 1.80 · 6/7 green ·
  vs random **89.3% LEANS_ABOVE** (median +$0.46) · ~22 more trades. HYPE the consistent loser (8T, 25%) — don't curate.
  The hold ranking FLIPS vs the 3-market read → noise still dominates the hold question.
  **Per-market `diag` (2026-09-25, `marketDiag`, cache `evidence:v2`):** exits by reason, longs/shorts, avg hold,
  median hourly range, `stopInRanges` (SL % ÷ typical hourly range). **HYPE check result: the data is CLEAN** (no
  zeros/stale repeats, jumps like XRP) — HYPE loses on EXITS: 6/8 SL at 24h, its 2% stop sits only ~2.0 typical
  hourly ranges away (tightest in the set; LINK 2.07 also red) vs ETH 3.3× / BTC 4.4×. Exit sizing, not bad data →
  keep it in; `volScaledStops` is the existing lever (a Lab test, not a preset edit).
  **⚠️ BIGGER FINDING — BASIS_FADE IS LONG-ONLY IN PRACTICE.** Every trade in both holds (30/30) is LONG, and every
  recorded basis row checked (72h × BTC/ETH/SOL/XRP/HYPE) is NEGATIVE: the OKX USDT perp sits at a persistent
  ~−0.05% discount to spot. `basisExtremeSide` thresholds |basis| vs its own trailing p90 and takes the SIGN from
  zero — so an "extreme" is always the deepest discount → always LONG. The "premium → SHORT" half of the rule never
  fires. So the graded basis reads = "buy when the discount is widest" (timing among longs beats random longs
  89.3% — the baseline preserves the long mix, so that part stands), NOT a two-sided fade. Untested in a sustained
  downtrend. Candidate fix = measure the extreme vs the trailing MEAN (demeaned basis) so both sides can fire —
  a RULE change, so it must be graded as a NEW axis beside the current one (parity), never swapped in silently.
- Page titles: `app/components/PageMeta.tsx` mounted per custom route in main.tsx (Lab/Analyze/Arena/Proof/Feed/
  Intel/Messages); catch-all `path:'*'` → `app/pages/notfound` (branded 404, noindex, inside the app shell).

## Wallet X-Ray — windows, copy gate, live positions (2026-09-25)
`/analyze` (`app/pages/analyze/index.tsx` + `XrayPanels.tsx`); ALL rules in **`app/lib/xrayGrade.mjs`** (tested).
- **Time windows 24H/7D/30D/ALL**, each graded by the SAME code on fills filtered by close time (AnalyticsView gets
  the windowed trades). **Minimums 5/10/20/20 closed trades** — below that the window reads **ACCRUING** (no PF/win%,
  no AnalyticsView). Default 30D; falls back to ALL only if 30D is accruing and ALL isn't. Truncated HL tapes flag
  every window the held slice doesn't reach back to. **Edge decay row** = PF ALL → 30D → 7D.
- **Orderly can't be windowed per trade** (indexer = per-market totals) → windows read off the WATCHED record:
  `/smart/xray/history` now also returns `series` (daily `{t,realized}`, additive); a window only reads if a snapshot
  exists at/before its start, else "watched Nd, not enough to cover".
- **Copy gate (`edgeGate`) — EVERY ⚡ COPY on the page goes through it** (hero CTA, positions panel, Orderly per-market
  rows; they were ungated before). Pass = graded 30D HL window net>0 AND PF>1, OR watched record ≥20 graded days net>0.
  Veto = ANY graded evidence negative. Locked state lists the reasons. ◆ draft-thesis stays open (planning, not copying).
  Gate reads 30D regardless of the tab shown. No 0–100 score — the grade is its parts.
- **Open positions:** HL `clearinghouseState` (leverage, entry, uPnL, venue-reported `liquidationPx`; mark =
  positionValue/|szi|). Orderly rows = indexer side/entry/uPnL + public futures mark; **leverage + liq = "—", never
  estimated** (not public). HL copy only if `hlCoinToOrderly(coin)` is a listed `PERP_*_USDC` (futures list = listed set).
- **⚠️ HL positions span EVERY perp dex (fixed 2026-09-25, Ember/Flood).** Equities (NVDA/AMD/MSFT/INTC…) live on
  builder-deployed HIP-3 dexes (`xyz:`, `flx:`…); `clearinghouseState` WITHOUT `dex` returns ONLY the main dex → the
  panel showed BTC and missed the stocks. `fetchHLPositions` lists `perpDexs` and reads each (`{dex}`), tags the row
  "Hyperliquid · xyz", shows ISO, and NAMES any dex it couldn't read ("list may be incomplete").
- **⚠️ HL serves only a wallet's 10,000 MOST RECENT fills — no public endpoint pages further back.** Full history
  = HL's S3 node-fills archive (all wallets, global crawl) — not per-wallet on-demand. `app/lib/hlTape.mjs`
  (`mergeFills`/`tapeStatus`, tested): every slice is MERGED + tid-deduped, never swapped (the old code threw away
  the 10k it paged for the newest ~2k whenever a busy wallet traded mid-read). Partial ⇔ we hold the 10k cap; labels
  say "N most recent fills (all Hyperliquid serves) · complete from <date>", and the analytics line flags partial
  ONLY on windows that reach past it (the old label printed CLOSED-TRADE count as "fills" → Ember's "~300 fills").
- **✅ FORWARD FILL COLLECTION (2026-09-25).** lab-api **`GET /xray/hltape?address=`** (`routes-hltape.mjs`, tested):
  first view SEEDS KV `xray:hltape:{addr}` (LAB_STORE) with everything HL serves; later views + the 12h cron
  (`sweepHlTapes`, ≤30 WATCHED wallets from `sm:wl:*`) sync forward from the newest stored fill (startTime inclusive)
  + `userFills`, merged via `syncTape` in `hlTape.mjs`. The tape GROWS PAST HL's 10k (cap `TAPE_STORE_CAP=50k`, compact
  rows). **Gap rule:** the forward page must return our newest stored fill; no overlap ⇒ >10k fills happened between
  syncs ⇒ `completeFrom` moves forward (disclosed, never papered over). A failed first page never writes/never claims a
  gap. Throttles: ≤1 HL sync/wallet/min (cached reads free), 20 syncs/min/IP (over → stored tape served `stale`, or 429).
  Page reads via `fetchHLTape` (falls back to direct HL if the worker is down); labels "N fills collected · complete
  from X · tape collected since Y". `completeFrom:null` = complete from the wallet's first fill.

- **✅ SHARE (2026-09-25).** `↗ SHARE` on the verdict card shares **`og.nexustradinglabs.com/share/xray/:address`**
  (NOT the SPA URL — its meta is JS-injected, crawlers never run it); mobile = `navigator.share`, else clipboard.
  Worker `routes-xrayshare.mjs`: `/share/xray/:a` = real OG/Twitter meta + forwards to `/analyze?address=`;
  `/og/xray/:a.png?v=` = 1200×630 card (resvg, same mono font). **ONE grade, every surface:** card content =
  `app/lib/xrayCard.mjs` (`xrayCard`) graded with `xrayGrade.mjs` on the STORED tape via `fillsToClosedTrades` —
  the SAME function the page now imports. Card rules: always **30D in parts** (net/trades/win%/PF) + lifetime
  context; **ACCRUING** below 20 trades (no PF/win%); Orderly-only → **watched record**; dated ("Sep 25 · 14:00
  UTC"); partial tape disclosed; NO copy/trade prompt. Image URL versioned by `cardVersion` (newest fill + counts)
  so a re-share after new fills gets a fresh image (X caches by URL); versioned PNGs edge-cached 24h. Unseeded
  wallet → seeds via `syncHlTape` under a 10/min/IP budget, else honest "no record" card.

- **✅ COPILOT = SAME GRADE (2026-09-25).** The AI copilot's `xray_wallet` tool no longer computes its own lifetime
  win rate from a raw HL read. It reads the STORED tape (`fetchHLTape`) and returns `xraySummary` (xrayGrade.mjs —
  the page's exact composition: per-window grades with ACCRUING, headline window, decay row, partial windows, copy
  gate) + `copy_gate {pass, evidence, locked_reasons}` + `share_link`. Its note tells the model: lead with the
  headline window, never quote win rate/PF on an ACCRUING window, never suggest copying when the gate is locked.

## Nexus PRO — subscriptions / revenue (freemium model)
The business-model layer. **PRO is a SOFTWARE subscription** (ordinary commerce, real USDC revenue) — NOT a
token-value scheme. $NEXUS only adds **consumptive use** (pay-in-$NEXUS discount) + **access** (hold-to-unlock).
⚠️ NO revenue-share / yield / dividends to holders — that's the security-maker line; do NOT add.
- **Built + LIVE (frontend):** `config/subscription.ts` (single source of truth — prices, benefits, `PAYMENTS_LIVE`
  flag, `PRO_AGENT_STRATEGIES`), `useSubscription` hook (resolves PRO via holder-unlock today OR paid record later;
  fail-soft → FREE), `NexusPro` card (active-state for PRO / upsell for free; shown in Lab under the market strip).
- **Tune (locked, all in subscription.ts):** `$20/mo` USDC · `25%` off paying in $NEXUS (→ `$15`) · hold **ARCHITECT (100M)**
  → PRO free (dollar cost of unlock rises with token price — cheap now to drive buying, real commitment later).
- **First gate LIVE + SERVER-ENFORCED:** advanced agent strategies (**MOMENTUM + MEAN_REVERSION**) are PRO; 3 core
  modes (CONFLUENCE/FUNDING/OI) stay free. UI gates it (`isProStrategy` + `useSubscription` in AgentView) AND lab-api
  now ENFORCES it server-side: every config-write site (`PUT /agent/:addr`, `PUT /agent/:addr/config`, `POST
  /agent/:addr/bankr/activate`) rejects a PRO `signalMode` from a non-PRO wallet with **402 `pro_strategy_locked`**.
  PRO resolved by `walletIsPro(address, env)`: paid `sub:{addr}` (future) OR holder-unlock = $NEXUS `balanceOf` ≥
  ARCHITECT (100M) on Base via `eth_call` (reuses the `/feed/holders` RPC pattern; fails CLOSED if RPC unreachable).
  Gate only fires for PRO strategies — free modes skip the RPC. So the paywall is real on web AND Bankr chat now.
- **⚠️ PAYMENT RAIL — SCOPED, shovel-ready, BLOCKED on the treasury Safe (the receiver address):**
  - Insight: NO indexer/processor needed. A sub payment = an ERC-20 transfer to the treasury. Worker verifies via ONE
    `eth_getTransactionReceipt` (read the `Transfer` log). **Grant PRO to the tx's `from` address** → spoofing
    impossible, no signature dance.
  - Worker `POST /sub/verify {txHash,chain}`: verify success + correct token (USDC/$NEXUS) + `to`===treasury +
    amount≥price + **txHash not already redeemed** (replay guard) → write `sub:{from}`={expiresAt:now+30d, extend if
    active} + mark hash used. `GET /sub/:address`→{expiresAt,active} (already read by useSubscription; flip PAYMENTS_LIVE).
  - Phases: **3a** USDC/Arbitrum (core, ~80%) → **3c** server-side enforcement (brain checks sub before PRO strategy;
    makes gates real) → **3b** pay-in-$NEXUS/Base (live USD→$NEXUS quote w/ tolerance band; drives token demand).
  - Effort ~3–4 days, ~$0 infra (public RPC + existing KV). No recurring billing (crypto = manual 30-day renewal).
  - Legal: USDC-for-software = plain commerce (not Howey); pay-in-$NEXUS = consumptive use. Low-stakes vs the buyback;
    one-line mention to the lawyer during the treasury chat.
- **⚠️ The Safe unblocks THREE things at once:** buyback flywheel + public treasury banner (`NEXUS_TREASURY_ADDRESS`)
  + PRO revenue (`SUBSCRIPTION_RECEIVER`). Standing up the Safe (app.safe.global, ~10 min) is the highest-leverage move.

## Q Signals — Quotient x402 v2 lens (LIVE + ON-CHAIN VERIFIED 2026-09-19) ⭐ the client-pays x402 pattern
Prediction-market **fair-value** intel in Lab → Market Intel (`app/pages/lab/QSignals.tsx`, a Collapsible lens).
Quotient prices a model fair value for liquid prediction markets (Polymarket/Kalshi/Limitless) + flags convergence vs
the live venue — a prompt to stake a GRADED thesis, never an oracle, never advice. **Verified live: real Base USDC
settlement tx `0xcbd2a8228985db73b26883207c520b23cb86ea28ae7c80879308ef2d97b34b36`.**
- **Two gates:** (1) ACCESS = Nexus **PRO** (`useSubscription` → hold ARCHITECT 100M $NEXUS or sub); non-PRO see a locked
  card (client-side gate only — the micro-payment is the real barrier). (2) DATA COST = **the USER'S wallet pays per pull
  via x402** (~$0.01 USDC on Base, real on-chain settlement). Nexus spends NO credits, no markup. ("They pay, not us.")
- **⚠️⚠️ THE MONEY PATH IS CLIENT-DIRECT — the worker CANNOT reach Quotient.** Quotient's gateway
  (`quotient-api-gateway.onrender.com`) **403s Cloudflare-Worker / datacenter IPs** (same block the codebase dodges for
  rss2json). So a server relay is impossible; the BROWSER (residential IP) calls Quotient directly. Do NOT rebuild a
  worker relay. (The old `GET /intel/quotient/challenge` + `POST /intel/quotient` worker routes + `QUOTIENT_API_KEY` are
  DEAD/vestigial — the worker 403s. `logic.mjs quotientSignals` stays only as the tested source of truth.)
- **⚠️ Quotient runs x402 VERSION 2, a NON-STANDARD flavor the npm `x402`/`x402-fetch` lib does NOT speak** (the lib
  sends `X-PAYMENT` + `network:"base"` and REJECTS CAIP — it will NOT work here). The real wire (hand-rolled in
  `app/pages/lab/qpay.ts`, `loadQuotientDirect`):
  1. GET (keyless) → **402**; the challenge is in the base64 **`payment-required` RESPONSE HEADER** (CORS-exposed), NOT
     the body. Decode → `{ x402Version:2, resource, accepts:[…], extensions }`.
  2. `accepts[0]` = `{scheme:"exact", network:"eip155:8453" (CAIP-2, NOT "base"), amount:"10000" (field is `amount`, not
     `maxAmountRequired`), asset:"0x8335…2913" (bare), payTo:"0xC3d0…97cB" (bare), maxTimeoutSeconds:300,
     extra:{name:"USD Coin",version:"2"}}`.
  3. Sign EIP-3009 `TransferWithAuthorization` via `eth_signTypedData_v4` (OFF-CHAIN, gasless, no tx, no chain switch).
     Domain HARDCODED: name "USD Coin" / version "2" / chainId 8453 / verifyingContract = BASE_USDC. message.to =
     QUOTIENT_PAYTO, value = amount.
  4. Retry with the payment in the **`PAYMENT-SIGNATURE` request header (NOT `X-PAYMENT` — X-PAYMENT is silently ignored
     → the facilitator re-issues "Payment required")**. Payload = base64 of the NESTED v2 shape:
     `{x402Version:2, resource:<echo>, accepted:<chosen accept VERBATIM — network stays eip155:8453>, payload:{signature,
     authorization:{from,to,value,validAfter,validBefore,nonce}}, extensions:<echo or {}>}`. **UTF-8-safe base64**
     (`resource.description` has em-dashes → plain `btoa` throws; use `TextEncoder`).
  5. 200 → `{signals:[…]}` → shape client-side. The paid 200 also carries a base64 **`payment-response` RESPONSE
     HEADER** = the facilitator's on-chain settlement proof `{success, transaction (Base tx hash), network, payer}`;
     `loadQuotientDirect` decodes it → `settlement:{tx,network}` and the lens shows a calm **"settled 0x…↗" Basescan
     link** next to the cards (null on an already-served 200 that never charged). Cached in `nx_qsignals_cache`.
- **Guards (risk posture, all pre-signature):** match network ∈ base/eip155:8453/8453, asset CONTAINS BASE_USDC, scheme
  "exact", payTo CONTAINS QUOTIENT_PAYTO; CAP amount ≤ `X402_MAX_UNITS=50000` ($0.05). Sign against canonical
  BASE_USDC/QUOTIENT_PAYTO/chainId-8453 (a hostile 402 can authorize at most a nickel to our pinned payTo).
- **Client shaper `app/pages/lab/qshape.ts`** = faithful port of the TESTED `workers/nexus-lab-api/logic.mjs`
  `quotientSignals` + `quotientPerpMap` (worker can't relay → shape in the browser; logic.mjs stays source of truth,
  246 tests). **NO auto-poll**: explicit "Load signals · $0.01" + 15-min localStorage cache (`nx_qsignals_cache`).
  Empty-after-paid shows a calm "none cleared the bar" (board-presence, not signals.length, decides "loaded").
  `min_conviction` valid range **1..3** (Quotient schema max = 3, NOT 5); client requests 1 (most signals).
- **"Perp signals from Q" (`quotientPerpMap`, tested):** the crypto price-target slice of Q's feed ("Will BTC reach
  $150k…") maps to a LONG/SHORT stance on `PERP_<coin>_USDC`; election/event markets stay read-only. Lens shows a perp
  badge + **⚡ Trade** (→ /perp/SYM) + **◆ Stake thesis** (prefills the Thesis Engine draft) + a PERPS/ALL filter. Also:
  copilot tool `q_signals` (reads the cached pull, no new charge) + a Feed discovery card (links to the lens).
- **Source of truth:** `qSignals` ∈ `PRO_FEATURES` (`app/config/subscription.ts`) → NexusPro card + landing `#pro`;
  Quotient in the landing partners row. **⚠️ Quotient gateway + `og.nexustradinglabs.com` are egress-blocked from
  cloud/worker/datacenter IPs → the pay flow can ONLY be exercised in a real browser (residential) wallet.**
  Launch post: `marketing/q-signals-launch.md`.

## Tokenomics direction — Bankr-informed pivot (2026-06-08) ⭐ CURRENT
The Safe is **LIVE** (`0x4Fe2…C733`, 1/1 Arbitrum+Base) and the PRO USDC payment rail is **wired**
(`/sub/verify` + `NexusPro` subscribe flow). After pitching $HYPE-style mechanics to the Bankr team, **Danny B
(Bankr) reshaped the token strategy — adopt this, it's both more holder-aligned AND legally cooler:**
- **❌ DROP automated buyback + burn.** Automated buybacks reward short-term traders, not holders; burning at this
  stage signals "we don't believe it goes higher." Also: an automated/marketed fee→buyback→burn machine is the
  CLOSEST thing to a Howey investment-contract — exactly the lawyer-gate we wanted to avoid.
- **✅ DISCRETIONARY "buy the lows" accumulation into the treasury.** The multisig opportunistically buys $NEXUS when
  cheap and **HOLDS** (conviction, war chest). Just a company accumulating an asset → far more defensible + what
  aligned holders actually want. Less to build too (no cron worker).
- **✅ Don't FULLY token-gate features** — keep a strong free tier so user-growth numbers stay real (needed for
  narrative/partnerships). PRO = additive premium (we only gate the 2 advanced agent strategies; core stays free).
- **✅ Points → Seasons** (Danny loved it; wants the structure — see `docs/nexus-seasons.md`). The treasury stack
  (from buying lows) FUNDS retroactive Season drops to top **verifiable** contributors. Quality-weighted via our
  trustless grading (reward being RIGHT, not loud) = built-in anti-wash-farming. Hold $NEXUS = points multiplier
  (aligned, not pay-to-win). Retroactive + merit-based + from a treasury = clean.
- **⚖️ SEC staff FAQ (Sept 25, 2026) — updates the legal half of the drop above.** CorpFin FAQ on crypto assets
  (builds on the March 2026 interpretation): a buyback of a NON-security token on an ALREADY-FUNCTIONAL network is not,
  by itself, a promise of managerial effort under Howey — UNLESS it's presented as yield/returns. Staff guidance only
  (not law, not Commission-approved, reversible). So "buyback = automatic Howey" is STALE — don't repeat it. What still
  holds: NO revenue share/yield/dividends (the carve-out), NO automated/marketed fee→buyback→burn (legal carve-out +
  Danny's market argument, which the FAQ doesn't touch). $NEXUS nuance: it's a meme token, not the network's token —
  its best argument is CONSUMPTIVE use (x402 payment unit, PRO discount, hold-to-unlock). **Draft policy for counsel:
  `docs/treasury-buyback-policy.md`** (discretionary, revenue-funded, hold-not-burn, disclosed onchain after the fact,
  say/never-say list). **Buys ARE already happening** (discretionary, since the June pivot; 10.93B $NEXUS ≈10.93% of supply held as of Sept 25) — the policy writes that practice down; counsel confirms via §7, and buys pause only if counsel says so. `marketing/lab-article.md`'s old
  "fees → treasury → buyback → burn" line was rewritten (Sept 25) to "the treasury holds what it earns".
- **Narrative pivot:** burn counter → **treasury-accumulation counter** ("treasury holds X $NEXUS" = conviction,
  not "X burned" = scarcity). Transparency pillar makes the stacking a feature.
- **Relationship:** Bankr connecting borst to their devs (facu & edit) + dev-console access → path to deeper
  integration + a Farcaster mini-app distribution play.

## Farcaster Mini App (distribution play — 2026-06-08) ⭐ CURRENT
The cold-start/distribution weapon: a slim Nexus surface native to Warpcast, where Bankr's users are.
- **LIVE:** `/mini` route (`app/pages/mini/index.tsx`) — STANDALONE, OUTSIDE `<App>`/OrderlyProvider (frames must
  stay light). Manifest at `public/.well-known/farcaster.json` is **SIGNED** (accountAssociation, FID 389456,
  domain trade.nexustradinglabs.com verified) → Warpcast recognizes it as an official Mini App. Uses
  `@farcaster/miniapp-sdk` v0.3: `isInMiniApp`, `context` (identity, free), `actions.ready`, `wallet.getEthereum
  Provider` (connect CONFIRMED working in Warpcast preview).
- **v1 (zero-auth, shipped):** identity + LIVE CALLS feed (read-only `/feed`) + Buy $NEXUS (`actions.swapToken`
  → `actions.viewToken` fallback, 100% native, no Uniswap redirect) + share-to-cast (`actions.composeCast` —
  the viral loop: each thesis embeds `/feed/thesis/:wallet/:id`).
- **⚠️ Native swap can't route $NEXUS (same v4-hook gap):** Warpcast's swap uses an aggregator; aggregators
  don't route the v4 NEXUS pool (see swap section). So the native sheet may show "no route" until liquidity
  deepens / aggregators index v4. UX is native now; actual fill depends on routing. Real fix = depth.
- **⚠️ Frame wallet is FRESH/separate** from the user's main wallet (no Orderly acct, no funds, no $NEXUS). Can
  read verified wallets from `context.user.verifications`. Shapes the build order (zero-auth first).
- **✅ TRADING PHASE — BUILT + LIVE-VERIFIED in-frame (2026-06-11; full real-money loop works).** Flow:
  connect → ENABLE (registers Orderly acct + order-key, no funds move) → DEPOSIT (real Arbitrum USDC txs) →
  TRADE (`POST /trade {symbol, side, notional, leverage, walletSig, walletAddress}`, auth =
  `sign_message('nexus-trading-key-v1')`, places MARKET via Orderly `/v1/order`). The frame wallet signs once;
  `ensureSig()` caches the sig per session so reads don't re-prompt. **Account read-back** (`POST /positions`
  → free_collateral + total_collateral_value + rows; `POST /balance` = `/v1/client/holding`) renders collateral
  + open positions with live uPnL + a real per-position **CLOSE** (`POST /close-position {symbol, walletSig,
  walletAddress}`). Verified live: $10 BTC short filled, position shown, closed; HYPE closed.
- **⚠️ /trade money-path gotchas (all bit us, all fixed — don't regress):** (1) **min_notional + base_tick
  live on `/v1/public/info/{symbol}`, NOT `/v1/public/futures/`** (futures returns null for both → silently
  defaulted minNotional to 1 → sub-min orders slipped through). (2) **/trade MUST check `orderResult.success`** —
  Orderly returns `{success:false, code, message}` on reject; the old code wrapped it as `ok:true` → trades
  "placed" with no position. (3) **Floor-snapping qty to base_tick can dip the VALUE under min_notional** (e.g.
  $10 HYPE → 0.17 → $9.95 → "order value should be ≥ 10"); ceil up one step to clear it. (4) **Orderly position
  rows have NO flat `unrealized_pnl` field** — compute uPnL = `(mark - entry) * signed_qty` (NaN-safe). HYPE/most
  perps min_notional = $10, so with a small balance use leverage so margin fits (e.g. $10 @ 2x = $5 margin).
- **⚠️ Frame wallet ≠ Bankr/main wallet:** the mini frame wallet is its OWN Orderly account, separate from the
  Bankr wallet used by the skill `/proxy/bankr-deposit`. Funds/positions deposited via one are invisible to the
  other — a common "where are my funds?" confusion. Each account is keyed by its own address.
- **⚠️ This repo is YARN 4** — use `yarn add`, NEVER `npm install` (npm writes a conflicting root
  `package-lock.json` + desyncs `yarn.lock` → CI `yarn install` fails → deploy skipped). Bit us once on the
  miniapp-sdk add.

### ✅ PUBLISHED + INSTALLABLE (2026-06-15) — full money loop + the manifest gotchas that blocked publishing
- **Money loop COMPLETE:** added **in-frame WITHDRAWAL** (deposit/trade/close already shipped). Frame EOA signs
  the Orderly `Withdraw` EIP-712 CLIENT-side (non-custodial); two lab-api routes: `POST /withdraw/prepare`
  (derives ed25519 from walletSig, gets withdraw_nonce, returns typedData; `settle:true` settles PnL first +
  recomputes safe amount from free_collateral) + `POST /withdraw/submit` (relays `{message,signature}` to
  `/v1/withdraw_request`; returns `needsSettle` on Orderly **code 78** → client re-signs with settle:true).
  Receiver is server-guarded to == caller's wallet. Ported from `/proxy/bankr-withdraw` (which signs server-side
  via Bankr). Withdraw `verifyingContract` = `0x6F7a338F2aA472838dEFD3283eB360d4Dff5D203` **passed in the POST body**.
- **⚠️ Orderly OFF-CHAIN EIP-712 verifyingContract = the all-C sentinel `0xCcCCccccCCCCcCCCCCCcCcCccCcCCCcCcccccccC`**
  for **registration/AddOrderlyKey** (Orderly reconstructs the hash with THIS + ecrecovers). The miniapp had copied
  the wrong `0x6F7a338F…` from the Bankr path → **"address and signature do not match"** on every enable/trade.
  Fixed. (The Bankr/withdraw flows use `0x6F7a338F…` but ONLY because they pass `verifyingContract` in the body.)
  Match the web ENABLE flow / Orderly docs: registration→all-C; withdraw→0x6F7a338F-in-body.
- **Trading slickness pass:** live price + 24h change + **funding** header + **candlestick chart** (dependency-free
  SVG from public `GET /tv/history` OHLC) + 24h vol / OI / funding-countdown — all public client fetches, 25s poll,
  fail-soft. **ALL ~106 markets** via a search picker (full list from `/v1/public/info`; popular quick-chips +
  search) replacing the hardcoded 6. **Per-asset max leverage = 1/base_imr** (BTC 100x, small-caps 20x) drives
  slider max + dynamic preset chips + clamps on symbol switch. **Accuracy line:** position-size estimate + est.
  liquidation price (mark ± maint-margin). **Progressive disclosure** (Fund/Withdraw behind a ⚙ MANAGE FUNDS
  toggle). **Copy-trade loop:** ⚡ TRADE on a feed call prefills the panel (symbol+direction, highlights the side).
  **Share PnL to cast** (↗ on each open position → composeCast w/ entry→mark + uPnL, embeds /mini).
- **⚠️ PUBLISHING/MANIFEST — the gotchas that blocked "Add" (all fixed; see memory `farcaster-miniapp-publish-gotchas`):**
  (1) A Mini App is public the moment its **signed manifest** is valid — no app-store approval. (2) You CANNOT open
  it by visiting the URL in a browser — only in-frame (cast embed Launch button / dev tool / search). (3) Manifest
  `iconUrl` **must be 1024×1024 PNG, no alpha** — a `.webp` or 512px fails validation → can't add. (4) Top-level key
  must be **`miniapp`** (current spec); `frame` is legacy alias — include both. (5) **Field length limits are
  enforced and reject the WHOLE manifest** — `subtitle` ≤30 (a 34-char value gave `addMiniApp()` "Invalid domain
  manifest"), name ≤32, description ≤170. (6) For casts to render a **Launch button**, add `fc:miniapp` (+`fc:frame`
  alias) embed meta to `index.html` (crawler reads STATIC html, so per-route JS-injected tags don't count). (7)
  Diagnostic that cracked it: **surface the `addMiniApp()` error** instead of swallowing it. (8) `accountAssociation`
  verified: sig recovers to FID 389456's on-chain custody (IdRegistry `custodyOf` on Optimism). Manifest served as
  `application/json`, no BOM.
- **PnL share posters:** custom posters live in `public/pnl/poster_bg_{1..4}.png` (+ `.webp`), gated by
  `VITE_USE_CUSTOM_PNL_POSTERS=true` / `VITE_CUSTOM_PNL_POSTER_COUNT`. ⚠️ Orderly overlays its OWN text (title, %,
  stats, **QR bottom-left**) on the **LEFT** — so the poster bg must keep the **left dark/empty** and put branding
  on the RIGHT, else it doubles/garbles (bit us). Built one from the real brand banner (`nexustradinglabs.com/preview.png`).

### Trading page (perp) customization
- **Collapsible order book** (`app/pages/perp/Symbol.tsx`): desktop ⊟/⊞ toggle hides the order book via
  `<TradingPage disableFeatures={["orderBook"]}>` → chart reflows wider; persisted (`nexus_ob_collapsed`).
  ⚠️ `TradingFeatures` enum is NOT exported — pass the string literal, typed via the prop's own type; and **`key`
  the TradingPage** on the toggle so the SDK re-applies disableFeatures (it reads them at mount).
- **⚠️ `<MarketsHomePage>` / `<TradingPage>` are black-box SDK widgets** — only the props they expose are
  customizable (`disableFeatures`/`overrideFeatures` on TradingPage; `comparisonProps`/`onSymbolChange` on Markets).
  The markets overview "New listings/gainers/losers" cards render a FIXED preview (no scroll prop) — making them
  scrollable needs a rebuild from granular widgets (`NewListingListWidget`, `MarketsListWidget`, etc.), not a tweak.

## Testing (money-path + trust-path)
- Pure logic is extracted into `logic.mjs` next to each worker's `index.js` (which imports it, so
  tests cover the REAL deployed code, not a copy). Tests = zero-dep `node:test` in `logic.test.mjs`.
  Run: `node --test workers/<worker>/logic.test.mjs` (or `npm test` in the worker dir).
- **nexus-agent-exec/logic.mjs** (12 tests): `snapQty` (-1104 step-size float-artifact guard +
  base_min/min_notional), `shouldResetDaily`, `dailyCapBlocked` (never blocks a win), `computePnl`
  (long/short), `exitReason` (TP→SL→timeout priority).
- **nexus-lab-api/logic.mjs** (9 tests): `gradeCall` — trustless first-touch TP-vs-SL grading
  (same-candle=loss, short inversion, pre-call candles ignored). Ledger hashing left inline (anchored
  on-chain — don't risk it).
- **Monitoring (DONE):** `nexus-ledger-anchor` runs an hourly `runMonitor` (after `runAnchor`) → Telegram
  ops alerts for ⛽ anchor-signer gas low (<0.0004 ETH), ⚓ ledger drifted from on-chain anchor >6h,
  🧠 brain down (via `ops:brain:heartbeat` KV the brain stamps every run; >15min = down). 3h per-issue
  debounce + daily ✅ heartbeat. Secrets: `TELEGRAM_TOKEN` (same bot as lab-alerts) + `OPS_TELEGRAM_CHAT_ID`
  var (6927717434). Test: `GET /monitor-now`. Verified live → `{"issues":[]}`.
- **Refactor (LAB DONE):** `app/pages/lab/index.tsx` split 3775 → **190-line orchestrator** + modules:
  `styles.ts`, `helpers.ts`, `types.ts` (+ all view/agent types + DEFAULT_CONFIG), `useIsMobile.ts`,
  `components.tsx` (EmptyState/PnlChart), `AnalyticsView.tsx`, `TradeLog.tsx` (Calendar+TradeLog),
  `ThesisView.tsx` (+ThesisAnalyticsView), `AgentView.tsx` (+AGENT_API/key readers), `CopiesView.tsx`,
  `MarketIntel.tsx` (+NewsTab), `Onboarding.tsx` (LabWelcome+OnboardingChecklist). tsc clean + `vite build`
  verified green. Pattern: extract → import → tsc → small commit.
- **Refactor (worker — OPTIONAL/deferred):** `nexus-lab-api` (3.2k) is still one big fetch handler, but its
  risky logic (gradeCall) is already extracted to logic.mjs + tested, and it's uniform route blocks (lower
  maintainability pain than the Lab was). Split routes/agent|theses|feed only if it starts hurting.

## Conventions
- **⚠️ BROWSER-FIRST TRIAGE — rule out borst's browser BEFORE touching code (bit us TWICE; 2nd = 2026-09-25).**
  borst browses in **Brave**. Brave Shields (tracker/ad/fingerprint blocking) silently breaks third-party
  embeds, previews and fetches IN HIS BROWSER ONLY — e.g. the X composer's link preview showed "no card" while
  the server chain was fine (Cloudflare logs: Twitterbot fetched the share page AND the PNG, 17 events / 0
  errors, even on a never-shared wallet). A whole logging PR (#30) + a diagnosis round went into a non-bug.
  **Before any "X/embed/preview/widget/wallet-popup/fetch doesn't work" investigation:** (1) ask borst to retry
  with Shields DOWN for the site (lion icon → off) or in a clean Chrome/incognito window; (2) check the SERVER
  side from logs/curl (crawler hit? 200?) — if the server served it, it's the client. Only then open a PR.
- **⚠️ After creating new files, `git add` them + verify `git status` is clean BEFORE trusting a build.**
  A local `vite build`/`tsc` passes with untracked files (they exist in the working tree), but CI builds
  from a clean checkout and fails to resolve them (Build step → Pages deploy skipped). The CI result is the
  only one that counts. (Bit us once: `components.tsx` was created in the refactor but never committed →
  6 red deploys until `git add`ed.) To get CI step status without admin: `GET api.github.com/repos/<repo>/
  actions/runs` then `/jobs` (public, unauthenticated; logs need admin though).
- **Mobile/responsive:** the app uses inline styles, so CSS media queries can't override them. Pattern:
  stat-card grids use `repeat(auto-fit, minmax(NNpx,1fr))` (fluid, desktop unchanged since auto-fit never
  exceeds item count); dense row tables get `overflowX:auto` + `minWidth`; layout-level changes use the
  `useIsMobile()` hook (768px). Lab/Feed/Messages done; Intel partial; SDK pages are Orderly-managed.
- **⚠️ Restyling an Orderly SDK layout region (e.g. portfolio side-nav):** the scaffold widgets accept
  `classNames={{ leftSidebar | content | topNavbar | card: "your-class" }}` → that class lands on the region's
  wrapper div (`@orderly.network/ui-scaffold` does `className: cn(classNames?.leftSidebar)`). Pass a custom class
  there, then target it in `app/styles/index.css` with `!important` + a descendant `*` to beat the oui- utility
  classes. Did this for the portfolio side-nav (`.nexus-portfolio-side`) which was chopping labels mid-word
  ("Overvi/ew") — fix = `word-break:keep-all` + `overflow-wrap:normal` (break only at spaces) + desktop nowrap.
  ⚠️ /portfolio needs a CONNECTED WALLET to render the rail, so it can't be visually verified in preview unauthed.
- **⚠️ Mobile overflow playbook (Session 2026-06-02 sweep — the recurring bug class):** fixed-PIXEL
  `gridTemplateColumns` (e.g. `"180px 1fr repeat(4,90px) 28px"`, `"280px 1fr"`, `"1fr 54px 40px 54px"`)
  are THE recurring mobile-clip culprit — they overflow/clip off the right edge on phones. Fixes by case:
  (1) two-column "chart + panel" blocks (e.g. TRADING SCORE radar+composite) → `gridTemplateColumns: isMobile
  ? "1fr" : "<desktop>"` to STACK; (2) cards holding sub-tables (best/worst markets) → make the CARD grid
  single-col on mobile so the inner table gets full width; (3) genuinely dense rows that can't shrink (trade
  log day rows, agent history/leaderboard) → wrap in `overflowX:auto` + put `minWidth:<sumpx>` on the row so
  it SCROLLS instead of clipping; (4) flex rows with `flex:1`/`minWidth:0` children that collide → set
  `flexShrink:0` on every column + a fixed identity width (feed VERIFIED CALLERS rows); (5) badges/labels in a
  `nowrap`+`overflow:hidden` line get clipped → move them to their own wrap-capable line. Fractional (`1fr`/
  `0.6fr`) grids are SAFE (they shrink). ⚠️ **`useIsMobile()` is per-COMPONENT** — each refactored module
  (`ThesisView` vs `ThesisAnalyticsView`, `CalendarView` vs `TradeLogAllView`) needs its OWN
  `const isMobile = useIsMobile()` call; referencing `isMobile` without it = `ReferenceError` that white-screens
  the whole tab (bit us twice). Feed reuses the Lab hook: `import { useIsMobile } from "@/pages/lab/useIsMobile"`.
- **Calendar cells:** use a FIXED `height` (not `minHeight`) so data-days don't grow taller than empty days
  ("weekdays huge, weekends small"); 60px mobile / 80px desktop + condensed content + `overflow:hidden`.
- **Lab tab row mobile:** tabs are equal-width `flex:1` with `short` labels; Holders short = `ROOM` (was a
  cryptic `◆`); the sync/operational status dot is hidden on mobile to reclaim space. Feed nav mirrors this
  (equal `flex:1` tabs, glyphs+divider dropped, "N theses" count hidden on mobile — no awkward gap).
- Aesthetic: **see "## Brand & voice" below** — canonical system is `app/config/theme.ts`. Bone/white `#ededf0` is the ONE accent; green `#3ecf8e` is DEMOTED to profit-data only. **NOT neon `#00ff88`** (that was a wrong note that misled a build). Ownable brand — don't "SaaS-ify".
- Commit trailer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit/push when asked.
- Env is **Windows PowerShell** — no `&&` chaining; use `;`. `gh` CLI is NOT installed.
- `tsc --noEmit` baseline is now **0 errors** (cleaned up 2026-08-24 — the old walletConnector
  `EvmInitialProps` mismatch fixed via a `walletConfig` appMetadata.name fallback; useNav
  `RouteOption` now imported from `@orderly.network/types`). Keep it at 0 — any error you see is
  yours to fix, not pre-existing noise.

## Brand & voice — design source of truth ⭐ (read BEFORE any brand-facing asset: landing, decks, videos, share cards, motion, marketing)
Canonical system = **`app/config/theme.ts`** (`C` tokens), mirrored 1:1 by the landing (`nexus-landing/index.html` `:root`). Pull colors from these — never invent.
- **Palette (Linear-discipline monochrome):** canvas `#0a0a0b` · surface `#141416` · borders `#232327`/`#33333a` · text bone `#f4f4f5` / fog `#a1a1aa` / muted `#71717a` / faint `#52525b`. **THE accent = bone/white `#ededf0`** (CTAs, headlines, interaction). **Green `#3ecf8e` = DATA role — profit/up/live ONLY, never the brand color.** neg `#f7525f`, warn `#fbbf24`. Elevation = hairline border + surface tier, NOT heavy shadow; ONE rationed accent; 4px spacing scale.
  - ⚠️ **NOT neon green.** "near-black + acid-green pop" is the exact AI-cliché to AVOID. It's bone-on-near-black, green rationed to data.
  - **Signal colours (2026-09-25) — each means ONE thing, never decoration.** Beyond bone + data colours, a few
    colours earned a job and live NAMED in `theme.ts`: `SIGNAL.caution` soft amber `#e0a458` (caution/experimental/
    "watch" — softer than `C.warn`, which stays for real danger) · `SIGNAL.follow` gold `#f5c451` (someone you follow)
    · `SIGNAL.heat` orange `#f7931a` (🔥 engagement, never price) · `SIGNAL.posSoft` (moderate conviction) ·
    `SIGNAL.posMuted`/`negMuted` (DEMOTED context P&L under a graded headline) · `SIGNAL.sim.*` purple family
    (SIMULATED, not real money — Sim Composer) · `LINE.pos/neg/warn` agree/oppose/caution hairlines ·
    `C.text.disabled`. **New colour = name its one job in theme.ts, or use an existing token.**
  - **Palette guard:** `node tools/check-palette.mjs` (allows everything in theme.ts; ratchet baseline
    `tools/palette-baseline.json` — shrink, never grow). Runs on every PR via `.github/workflows/pr-checks.yml`
    (never blocks the deploy). It drifted to ~25 strays Sept 19–24 because nothing ran it.
- **⭐ WRITTEN VOICE = `marketing/VOICE.md`** (borst's brief, Sept 25 2026) — read it before writing ANY post, QT, article
  or launch copy as @nexustradinglab. A terminal that speaks: short end-stopped lines, fact → rule → action, numbers over
  adjectives, no hype words/emoji, no em-dash brochure clauses, default closer = nothing. Rewrites return 1 primary + 1
  tighter alt. @borstxbt (founder) is a separate, personal voice — the brand account never copies it.
  **Applied app-wide + landing (Sept 25 2026):** meta/SEO, PRO card + `PRO_FEATURES`, onboarding + connect modal, Lab
  hero ("Plan it. Run it. Prove it."), Proof, Feed, Agent, Thesis Engine, Intel, Arena, X-Ray, token/spot, mini app,
  share texts (X/Farcaster: fact → rule, no emoji). Brand labels carry NO pictographic emoji (glyphs ◆ ◇ ▪ ✓ ✕ ⛓ ⚡ →
  are fine); the top-nav bell is a line SVG matching the envelope. User SOCIAL REACTIONS (🔥💎📉 in SocialBar/
  CommentsPanel) are left as-is — they're stored data, not brand copy. "Welcome to The Lab" is retired (the brief bans
  "Welcome to"). LiveRead's "PROVEN-EDGE SETUP" is now "ALIGNED SETUP" — the scoreboard hasn't graded it PREDICTIVE;
  never label a read "proven" unless the scoreboard does.
- **Type:** IBM Plex Mono (labels/terminal) + Manrope (sans — headlines/CTAs) + Libre Baskerville (serif — editorial accent). Landing loads all three.
- **Voice / cadence (match the landing):** calm, declarative, confident, short sentences. Identity lines — **"an onchain trading terminal" · "Plan it. Run it. Prove it." · "From idea to an onchain call."** Agent: "hand an agent your rules · paper first, live when you say so · order-only keys + kill switch · 24/7." Intel: "funding edge intelligence · where the smart money is actually positioned · the edge the desk trades on."
  - ⚠️ **Verifiability is stated CALMLY, once, as fact** ("graded from public price · the ledger's on Arbitrum · open the contract and look") — NEVER a "can't fake" war-cry. Blockchain-can't-fake is table stakes; the onchain terminal (The Lab) OWNS verifiability inherently, so don't lead with it or preach it. It's a quiet supporting fact, not the thesis.
  - ⚠️ No filler ("in plain English", "the leaderboard you can't fake"). Say the thing, in the landing's register.
- **"Video demos"** = self-playing / animated **design artifacts** (branded HTML you screen-record), the same medium as the Claude Design "video demo" projects — there is NO rendered-MP4 export from Claude. Build these on the palette + voice above. Current demo motion kit: artifact `KuNRnRrDJ3Q9GDLwBP3Eai` (V2, on-brand: bone/near-black, green whisper).

## // NEXUS AI — floating AI copilot (Session 2026-06-05, on main)
Terminal-wide floating ◆ assistant; flagship "make-you-a-better-trader" feature. **BYOK, client-side
only** (user's Anthropic/OpenAI key in localStorage; browser calls provider REST directly via `fetch`,
no SDK — key never hits a Nexus server). Files: `app/components/NexusAssistant.tsx` (mounted in
`App.tsx` inside `<OrderlyProvider>`), `app/config/assistant.ts` (`runChat`/`runChatStream`+`readSSE`,
`SYSTEM_PROMPT` w/ advice-line guardrail, `listModels`, per-provider `LS_MODEL(p)`/`LS_KEY(p)`),
`app/config/assistantTools.ts` (31 tools, `ToolCtx`). **Streaming** (SSE) keeps the full bounded
tool-loop (max 5) for both providers; non-streaming `runChat` is the fallback. **Models fetched live
from the key's `/v1/models`** (stale `*-latest` ids 404 — `loadModel()` migrates them + rejects
cross-provider ids; Anthropic browser calls need header `anthropic-dangerous-direct-browser-access`).
**31 tools** (SYSTEM_PROMPT steers when to use them): read (market/explain_move, regime, open
positions, my performance, edge/operator profile, call advice, agent status/directive, get_trader,
top agents, verified callers, smart money, mispriced board, forecasts, arena, contested/contrarians,
xray_wallet, DeFi/macro/indicators) + action/no-execution (open_symbol/trader/xray/leaderboard/
mispriced/autocopy, draft_thesis/directive → localStorage `nexus_thesis_draft` + `/lab?tab=thesis`;
Lab reads `?tab=`, ThesisView consumes draft).
Persists chat (`nexus_ai_chat`), markdown render (incl. tables), discovery nudge (`nexus_ai_seen`),
local personal-insight teaser. ⚠️ Thesis form symbol = BARE ticker ("BTC"), not PERP_. Next: **hosted
inference** (pay-in-$NEXUS/USDC worker proxy) — the BYOK-wall unlock, BLOCKED on the treasury Safe; fold
into PRO rail. Open call: free-forever BYOK vs gate behind PRO.

## Agent ops + feed liveness (Session 2026-06-05, on main)
- ⚠️ **"Agents down" is usually a false alarm.** Before declaring an exec outage, check Cloudflare dash →
  Workers → nexus-agent-exec → Triggers → **View events** (per-minute Success log). Agents sit idle BY
  DESIGN when the brain emits `direction:NONE` (no funding+OI confluence). **CF "CPU time" ≠ wall time**
  (awaiting I/O is free) so ~2ms ticks are normal early-returns, not crashes.
- exec now stamps `ops:exec:heartbeat` every tick + has `GET /health` ({ok,users,lastTickAgeSec}); the
  hourly `nexus-ledger-anchor` monitor alerts "⚙️ Exec down" if >10min stale. Fixed a daily-reset
  persistence bug (state only saved on a trade → stale trades_today). 2 agent wallets: `0x325da3…95de`,
  `0x9a3012…cb28` (AUTONOMOUS, BTC).
- **Feed cold-start liveness** (`app/pages/feed/index.tsx` + lab-api `/theses/leaderboard`): emerging
  callers tier (1-4 graded calls + `callsToQualify`), FeedPulse strip, AgentTrackRecord social-proof
  card, ContributePrompt (feed<12), and **outbound 𝕏/Farcaster share** on theses (Lab ThesisView +
  thesis detail page) → links unfurl via existing `/og/thesis/:wallet/:id(.png)` cards. The
  create→distribute→recruit loop = the real fix for thin supply (rest is go-to-market).

## ⚠️ Settled — do NOT re-raise as "next moves" (borst, 2026-09-24)
- **Farcaster mini app (`/mini`) is PARKED (borst, 2026-09-25).** Don't work on it, audit it or pitch it until borst
  says so. Last change: its one-tap PAPER deploy loads the Basis × CVD Stack (same as the /proof lead).
- **Cold-start / feed liveness** is behind us — don't pitch it as the #1 risk or a next move.
- **Fabric in-app buy is LIVE and tested** — don't pitch "run a small live test" again.
- Current focus = **the engine and its signals** (basis stack, scoreboard → one-click strategies, mobile polish).

## Strategic framing (for partner/Orderly convos)
The DEX is a commodity (anyone can clone the Orderly template). The moat is the Lab + social graph:
plan→automate→grade retention loop, autonomous agent driving net-new volume into Orderly's book, and
network effects from the social layer. Biggest risk = cold-start / Feed liveness (user is recruiting
seed users). Positioning: "The trading terminal that makes you a better trader."
