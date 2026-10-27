// ── Explorer reads, batch 2 — DRAFTS (2026-10-27) ───────────────────────────────────────────────
// docs/research/explorer-drafts-b.md. Every draft of this batch is settled (borst, 2026-10-27):
//   A · oi_div_reversal_4h  REGISTERED (explorerReads.mjs, oi-div-reversal-4h-prereg.md)
//   B · oi_coil_break       REGISTERED at OI +3% (explorerReads.mjs, oi-coil-break-prereg.md)
//   C · funding_reset       DROPPED: 40 events per 60 days projected; only a non-extreme setting passed.
//   D · funding_basis_split PARKED: needs a read-only basis history route, none this batch.
// The draft bodies are in git history. A future draft goes here first, is counted with the
// COUNT-ONLY power check (tools/explorers/powerCheck.mjs --batch=b), and moves unchanged into
// explorerReads.mjs only when borst signs a dated registration. The scoreboard (axisbt AXES) must not
// import this file; explorerDraftsB.test.mjs fails if it does.

export const DRAFT_READS_B = Object.freeze([]);
export const DRAFT_GENS_B = Object.freeze(Object.fromEntries(DRAFT_READS_B.map((r) => [r.name, r.gen])));
