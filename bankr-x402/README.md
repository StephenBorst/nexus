# Nexus × Bankr x402 — paid data APIs, priced in $NEXUS

Nexus's **unfakeable** trading data, sold pay-per-call to agents/apps via Bankr's
x402 cloud — priced in **$NEXUS**. Bankr hosts the endpoint + the entire payment
layer (402 → wallet signs → verify → settle); we just supply the handler + config.

**Why this matters:** gives $NEXUS its first **consumptive utility** (pay-to-use,
Howey-safe — demand from usage, not speculation) and is the deepest "build on
Bankr" integration. We sell the one thing no competitor can: data graded from
public price + anchored on-chain.

## Endpoints (tiered — premium = the alpha)

| Service | Data | Price | Why |
|---|---|---|---|
| `nexus-callers` | Verified-caller leaderboard (graded, anchored) | 10,000 $NEXUS | Provably-real track records |
| `nexus-agents-live` | LIVE NOW open positions, uPnL from public price | 10,000 $NEXUS | Real-time, verifiable |
| `nexus-signals` | Funding + OI-divergence reads, with the scoreboard's live grade attached | 50,000 $NEXUS | Board data, graded in public (currently NOISE, see below) |

Prices are in TOKEN units, not USD (Bankr resolves symbol/decimals from the
`tokenAddress` at deploy). ~$0.005 / $0.025 at current $NEXUS price — **tune them.**
$NEXUS = `0x3D958634ab725B627919EF8F2Ed59227309fDba3` (Base).

## Files
- `bankr.x402.json` — all three services (custom-token config).
- `nexus-callers.ts` · `nexus-agents-live.ts` · `nexus-signals.ts` — handlers.
  Each is a plain `Request → Response` that, after Bankr settles payment, fetches
  the corresponding `og.nexustradinglabs.com` endpoint and returns it.

## ⚠️ Honest label on `nexus-signals` (2026-09-25)
Our own scoreboard (`/intel/axis-backtest`, shown on /proof) grades the funding-fade read this feed
serves as **NOISE** (n≈3,076, 31% hit, −0.21R). The handler now attaches that live grade to every
response (`grade`), and the listing no longer calls it "the edge". Plan: swap the feed to the graded
basis reads after the Oct-15 re-validation. **Redeploy to make it live:** `bankr x402 deploy nexus-signals`
(Bankr hosts the handler; pushing to GitHub does not update it).

## CLEARED gate (2026-11-27, built in, inert until a read clears)
`nexus-signals.ts` first asks lab-api `GET /signals/read/btc_lead_lag` (`workers/nexus-lab-api/routes-readsignals.mjs`,
rules `app/lib/soldRead.mjs`). That route answers 403 `not_cleared` (no signals) until the read is CLEARED on /proof
(served Tradeable/Paper, not failing, no promotion lock, a recorded 30-trade paper PASS that beat random entries,
pipeline-if-then.md "Only a CLEARED read may be marketed or promoted: … the paid feed"). The handler serves btc_lead_lag
only on a cleared 200 with its grade; anything else serves today's funding-fade feed with its NOISE grade, as before.
Every response names its `read` and carries `grade`. Nothing switches by hand: the gate is re-read on every call, and
it switches back by itself if the read loses CLEARED.

Deploy: after the PR merges, `bankr x402 deploy nexus-signals` from the deployer wallet (a separate step). Check: pay
one call and see `read: "funding_fade"` with the NOISE grade (btc_lead_lag hasn't cleared). The basis swap below stays
staged; don't run it.

## Oct-15 basis swap (STAGED — do not run before the verdict)
`nexus-signals-basis.ts` is the basis × CVD version of `nexus-signals`, pre-built. It is **not** in
`bankr.x402.json`, so nothing ships it today, and its data route (`GET /signals/basis`) answers 404
until the lab-api flag is set. Run the swap only if the Oct-15 re-validation holds basis × CVD:

1. lab-api: uncomment `BASIS_SIGNALS_LIVE = "true"` in `workers/nexus-lab-api/wrangler.toml`, merge
   (CI deploys). Check `curl https://og.nexustradinglabs.com/signals/basis` returns 12 rows.
2. Replace `nexus-signals.ts` with `nexus-signals-basis.ts` (same service name, so buyers' URL
   doesn't change) and update the `nexus-signals` description in `bankr.x402.json` to the basis read,
   keeping "Graded in public on /proof; each response carries the live grade."
3. `bankr x402 deploy nexus-signals` from the deployer wallet, then pay one call and check the
   response carries `grade.axis: "basis_x_cvd"`.

If the read does NOT hold on Oct-15: leave all three untouched. The live feed keeps its honest NOISE label.

## Deploy — two paths

**A) CLI (uses these files):**
```bash
npm i -g @bankr/cli
bankr login
bankr x402 deploy nexus-callers
bankr x402 deploy nexus-signals
bankr x402 deploy nexus-agents-live
```
→ live at `https://x402.bankr.bot/<your-wallet>/<service>`. Settlement books to the
wallet in the URL — **point it at the treasury Safe** (`0x4Fe2…C733`).

**B) Chat-deploy (Bankr writes the handler):**
> "Deploy an x402 endpoint `nexus-signals` that fetches
> `https://og.nexustradinglabs.com/signals` and returns the JSON, priced at
> 50000 $NEXUS (`0x3D958634ab725B627919EF8F2Ed59227309fDba3`) per request on Base."

## Backing endpoints (live on lab-api)
- `GET /theses/leaderboard` — verified callers + merit ranks + `meritRank`.
- `GET /agents/live` — open positions, uPnL from public mark.
- `GET /signals` — funding + OI-divergence + confluence, **same `confluenceSignal()`
  engine as the autonomous agent** (tested in `workers/nexus-lab-api/logic.test.mjs`).

## Notes
- **Fees:** free tier 1,000 req/mo (0%), Pro 5%. Pilot fits free.
- **Free web vs paid API:** the web surfaces stay free for humans; x402 is the
  machine-consumable, pay-per-call rail for agents (and where you can later gate
  real-time/depth as the premium tier).
- **Handler signature** follows the docs' "plain Request → Response (+ ctx)" model;
  chat-deploy (B) sidesteps any CLI shape mismatch — keep these `.ts` as the spec.
