// ── Paper wallets and judgment signatures the pipeline recorded (machine-written) ──────────────────────
// WRITTEN BY tools/pipeline/records.mjs (the daily watcher, docs/routines/pipeline-watch.md). Do not edit by hand.
// Each entry copies a signed record from lab-api (paperClaim.mjs / paperJudgePage.mjs) into git, with its signature,
// so the record survives the KV and anyone can recover the signer. readPipeline.mjs and paperJudge.mjs read these;
// an entry written by hand in those files always wins. pipelineRecords.test.mjs re-checks every signature.

export const PAPER_WALLET_RECORDS = Object.freeze({});

export const JUDGMENT_RECORDS = Object.freeze({});
