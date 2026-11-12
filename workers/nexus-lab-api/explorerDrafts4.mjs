// ── Explorer reads, batch 4 — DRAFTS (2026-11-07) ───────────────────────────────────────────────
// docs/research/explorer-drafts-4.md. borst's picks (2026-11-07). What is left here is NOT registered: the
// scoreboard (axisbt AXES) must not import this file and nothing trades these (explorerDrafts4.test.mjs
// fails if either happens). The only thing allowed to run a generator here is the COUNT-ONLY power check
// (tools/explorers/powerCheck.mjs --batch=4). A draft moves UNCHANGED into explorerReads.mjs only when
// borst signs a dated registration; a changed rule after that is a new name.
//
// Built to hold up on new coins: every threshold is relative to the coin's own history (or BTC's), never
// a fixed number tuned on the main card. On 2026-11-07 only level_reclaim held up on the holdout coins;
// the main-card-only winners all failed there.
//
// Generator shape as explorerReads.mjs: (cs, pmap, ctx) → [{ t, side }], decided on data up to and
// including the deciding bar; candle reads stamp at the deciding bar's CLOSE (bar open + 1h), oi:hist
// reads at the row's own time.

// A · btc_lead_lag: REGISTERED 2026-11-07 at p90 · lag 0.75 (explorerReads.mjs, btc-lead-lag-prereg.md).
// B · funding_settle_snap: DROPPED (borst 2026-11-07): it passed the count only at p80, which isn't an extreme;
//     the settlement hours were unconfirmed and the 168h R contract can't see an hours-long effect.
// C · level_reclaim_weekly: DROPPED (borst 2026-11-07): 5–19 events per 60 days at every setting.
// The dropped bodies are in git history.

// D · funding_basis_split: REGISTERED 2026-11-07 at the drafted setting (explorerReads.mjs,
//     funding-basis-split-prereg.md).
// Batch 4 is settled. A future draft goes here first, is counted (powerCheck.mjs --batch=4), and moves unchanged
// into explorerReads.mjs only when borst signs a dated registration.

export const DRAFT_READS_4 = Object.freeze([]);
export const DRAFT_GENS_4 = Object.freeze(Object.fromEntries(DRAFT_READS_4.map((r) => [r.name, r.gen])));
