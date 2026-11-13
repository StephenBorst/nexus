// ── What the watcher writes into git from lab-api's signed pipeline records ─────────────────────────────
// Step 3 of the paper pipeline (borst 2026-11-14): a paper wallet registered on /ops (paperClaim.mjs) and the judgment
// page signed there (paperJudgePage.mjs) live in KV first. The daily watcher (tools/pipeline/records.mjs) copies them
// into app/lib/pipelineRecords.mjs and docs/research/paper-judgment-<read>.md, in its own record-only PR.
//
// It trusts nothing it is served: every claim signature and judgment signature is recovered here, and every page is
// re-rendered from the claim and must match what lab-api served, hash and all. Anything that doesn't check out is an
// ISSUE (reported, nothing written for that read), never a write. A page already in git is never rewritten: only the
// signed Results line is appended, once.
// Pure: signature recovery and sha256 are injected (viem + node:crypto in the tool and the tests).

import { registrationFor } from "./readPipeline.mjs";
import { paperClaimMessage } from "./paperClaim.mjs";
import { livePlanSignMessage, planAboveSignoff, signedPlanLine } from "./livePlanSign.mjs";
import {
  renderJudgmentPage, pageAboveResults, judgmentSignMessage, judgmentEntry, signedResultsLine, judgmentDocPath,
} from "./paperJudgePage.mjs";

const lower = (a) => String(a || "").toLowerCase();

/**
 * @param {object} p
 * @param {object} p.walletRecords   PAPER_WALLET_RECORDS as in git
 * @param {object} p.judgmentRecords JUDGMENT_RECORDS as in git
 * @param {object} p.codedJudgments  the hand-written PAPER_JUDGMENTS entries (they win; the pipeline never writes over them)
 * @param {object[]} p.claims        GET /pipeline/paper-wallets → claims
 * @param {Record<string, object>} p.drafts axis → GET /pipeline/judgment/:axis (only for claimed reads)
 * @param {Record<string, string|null>} p.docs path → the file as in git (null = none)
 * @param {(message: string, sig: string) => Promise<string>} p.recover
 * @param {(text: string) => string} p.sha256
 * @param {object} [p.setups] PAPER_SETUPS (tests inject a read the brain doesn't trade yet)
 * @returns {Promise<{ walletRecords, judgmentRecords, writes: Record<string,string>, changes: string[], issues: string[] }>}
 */
export async function nextRecords({ walletRecords = {}, judgmentRecords = {}, codedJudgments = {}, claims = [], drafts = {}, docs = {}, recover, sha256, setups }) {
  const wallets = { ...walletRecords };
  const judgments = { ...judgmentRecords };
  const writes = {};
  const changes = [];
  const issues = [];
  const checkSig = async (message, sig, who) => {
    try { return lower(await recover(message, sig)) === lower(who); } catch { return false; }
  };

  for (const c of claims) {
    const axis = c?.axis;
    if (!registrationFor(axis)) { issues.push(`claim for an unknown read: ${axis}`); continue; }
    if (!(await checkSig(paperClaimMessage(c.by, axis, c.wallet, c.sigTs), c.sig, c.by))) {
      issues.push(`${axis}: the claim's signature doesn't recover to ${c.by}; nothing written`);
      continue;
    }
    const inGit = wallets[axis]?.wallet || null;
    const coded = registrationFor(axis).paperWallet;
    if (inGit && lower(inGit) !== lower(c.wallet)) { issues.push(`${axis}: git records ${inGit}, lab-api claims ${c.wallet}`); continue; }
    if (!inGit && coded && lower(coded) !== lower(c.wallet)) { issues.push(`${axis}: the code names ${coded}, lab-api claims ${c.wallet}`); continue; }
    if (!inGit && !coded) {
      wallets[axis] = { wallet: lower(c.wallet), by: lower(c.by), at: c.at, startedAt: c.startedAt, sigTs: c.sigTs, sig: c.sig };
      changes.push(`${axis}: paper wallet ${c.wallet} recorded (registered ${c.at} by ${c.by})`);
    }

    // The judgment page, for a read the code doesn't judge by hand.
    if (codedJudgments[axis]) continue;
    const d = drafts[axis];
    if (!d) continue;
    const claim = { axis, wallet: lower(c.wallet), at: c.at, startedAt: c.startedAt };
    const page = setups ? renderJudgmentPage(claim, setups) : renderJudgmentPage(claim);
    const above = page ? pageAboveResults(page) : null;
    if (!above || d.page !== page || d.sha256 !== sha256(above)) { issues.push(`${axis}: the served page doesn't match the template rendered here; nothing written`); continue; }
    const s = d.signed || null;
    if (s && !(s.pageSha256 === d.sha256 && await checkSig(judgmentSignMessage(s.by, axis, d.sha256, s.sigTs), s.sig, s.by))) {
      issues.push(`${axis}: the judgment signature doesn't check out; nothing written`);
      continue;
    }
    const path = judgmentDocPath(axis);
    const have = docs[path] ?? null;
    let text = have;
    if (have == null) {
      text = page;
      changes.push(`${axis}: judgment page drafted (${path}, sha256 ${d.sha256.slice(0, 12)}…)`);
    } else if (pageAboveResults(have) !== above) {
      issues.push(`${axis}: ${path} in git differs from the page above Results; nothing written`);
      continue;
    }
    if (s && !text.includes(s.sig)) {
      text = `${text.replace(/\n*$/, "\n")}\n${signedResultsLine({ ...s, pageSha256: d.sha256 })}`;
      changes.push(`${axis}: judgment signed by ${s.by} at ${s.tradesAtSigning} trades`);
    }
    if (text !== have) writes[path] = text;
    const entry = {
      ...judgmentEntry(claim, { signed: !!s }), pageSha256: d.sha256,
      ...(s ? { signedBy: lower(s.by), signedSigTs: s.sigTs, signedSig: s.sig, tradesAtSigning: s.tradesAtSigning } : {}),
    };
    if (JSON.stringify(judgments[axis] || null) !== JSON.stringify(entry)) judgments[axis] = entry;
  }
  return { walletRecords: wallets, judgmentRecords: judgments, writes, changes, issues };
}

const sorted = (o) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]));
const block = (o) => {
  const keys = Object.keys(o).sort();
  if (!keys.length) return "Object.freeze({})";
  return `Object.freeze({\n${keys.map((k) => `  ${k}: Object.freeze(${JSON.stringify(sorted(o[k]))}),`).join("\n")}\n})`;
};

/** The whole app/lib/pipelineRecords.mjs, deterministic (sorted keys). */
export function recordsModuleSource(walletRecords, judgmentRecords) {
  return `// ── Paper wallets and judgment signatures the pipeline recorded (machine-written) ──────────────────────
// WRITTEN BY tools/pipeline/records.mjs (the daily watcher, docs/routines/pipeline-watch.md). Do not edit by hand.
// Each entry copies a signed record from lab-api (paperClaim.mjs / paperJudgePage.mjs) into git, with its signature,
// so the record survives the KV and anyone can recover the signer. readPipeline.mjs and paperJudge.mjs read these;
// an entry written by hand in those files always wins. pipelineRecords.test.mjs re-checks every signature.

export const PAPER_WALLET_RECORDS = ${block(walletRecords)};

export const JUDGMENT_RECORDS = ${block(judgmentRecords)};
`;
}

/** The watcher PR for these changes. */
export function recordsReport(changes, issues) {
  const title = `Pipeline watch: paper records · ${changes.map((c) => c.split(":")[0]).filter((v, i, a) => a.indexOf(v) === i).join(", ")}`;
  const body = [
    "Record-only: copies signed pipeline records from lab-api into git (tools/pipeline/records.mjs).",
    "Every signature was recovered and every page re-rendered from its claim before writing.",
    "", "Changes:", ...changes.map((c) => `- ${c}`),
    ...(issues.length ? ["", "Issues (nothing written for these):", ...issues.map((i) => `- ${i}`)] : []),
    "", "Arms nothing. No stage rule, preset or wallet setting is touched.",
  ].join("\n");
  return { title, body };
}

// ── Live plan signatures (livePlanSign.mjs) → a line under the page's Sign-off ─────────────────────────────
/**
 * @param {object} p
 * @param {Record<string, object>} p.served  axis → GET /pipeline/live-plan/:axis (its `signed` record, if any)
 * @param {Record<string, {doc, sha256, text}>} p.plans LIVE_PLAN_TEXT (generated from the pages in git)
 * @param {Record<string, string|null>} p.docs  path → the page as in git
 * @param {(message: string, sig: string) => Promise<string>} p.recover
 * @param {(text: string) => string} p.sha256
 * @returns {Promise<{ writes: Record<string,string>, changes: string[], issues: string[] }>}
 */
export async function nextPlanRecords({ served = {}, plans = {}, docs = {}, recover, sha256 }) {
  const writes = {}, changes = [], issues = [];
  for (const [axis, s] of Object.entries(served)) {
    const rec = s?.signed;
    const plan = plans[axis];
    if (!rec || !plan) continue;
    const page = docs[plan.doc];
    if (page == null) { issues.push(`${axis}: ${plan.doc} is missing; nothing written`); continue; }
    const above = planAboveSignoff(page);
    if (!above || sha256(above) !== plan.sha256 || rec.sha256 !== plan.sha256) { issues.push(`${axis}: the signed hash isn't the page in git; nothing written`); continue; }
    let ok = false;
    try { ok = lower(await recover(livePlanSignMessage(rec.by, axis, rec.sha256, rec.sigTs), rec.sig)) === lower(rec.by); } catch { ok = false; }
    if (!ok) { issues.push(`${axis}: the live plan signature doesn't recover to ${rec.by}; nothing written`); continue; }
    if (page.includes(rec.sig)) continue;
    writes[plan.doc] = `${page.replace(/\n*$/, "\n")}\n${signedPlanLine(rec)}`;
    changes.push(`${axis}: live plan signed by ${rec.by} (arms nothing)`);
  }
  return { writes, changes, issues };
}
