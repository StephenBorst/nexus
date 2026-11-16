// ── Explorer reads, batch 5 — DRAFTS (2026-11-16) ───────────────────────────────────────────────
// docs/research/scanner-reads-prereg.md. SETTLED 2026-11-16: both signed by borst ("sign both") and moved UNCHANGED into
// explorerReads.mjs (shelf_breakdown_short, bb_rsi_momentum). Was: the two Bankr scanners' entry rules, written exactly so the scoreboard can
// run them itself from public price (borst 2026-11-16: "A, defaults OK, write the pages"). NOT registered: the
// scoreboard (axisbt AXES) must not import this file and nothing trades these (explorerDrafts5.test.mjs fails if
// either happens). The only thing allowed to run a generator here is the COUNT-ONLY power check
// (tools/explorers/powerCheck.mjs --batch=5). A draft moves UNCHANGED into explorerReads.mjs only when borst signs
// the page; a changed rule after that is a new name.
//
// Generator shape as explorerReads.mjs: (cs, pmap, ctx) → [{ t, side }], decided on bars up to and including the
// deciding 1h bar, stamped at that bar's CLOSE (bar open + 1h). Input: cs.candleHist [{t (ms, bar open), o,h,l,c,v}].
// Every window walks a fixed number of bars per hour (O(n · window)), per the scoreboard's CPU rule.

// A future batch-5 draft goes here first, is counted (powerCheck.mjs --batch=5), and moves unchanged into
// explorerReads.mjs only when borst signs a dated registration.

export const DRAFT_READS_5 = Object.freeze([]);
export const DRAFT_GENS_5 = Object.freeze(Object.fromEntries(DRAFT_READS_5.map((r) => [r.name, r.gen])));
