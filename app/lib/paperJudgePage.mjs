// ── A read's 30-trade judgment page, drafted by the pipeline when its paper wallet is registered ────────
// borst, 2026-11-14: "When a read first hits TRADEABLE, auto-draft the 30-trade rules (copy of the existing template
// with the new read + wallet). You review and sign once. After that the judge is locked." His choice: the signature
// is the owner's WALLET signature over the page, not a PR.
//
// The rules are level_reclaim's (paper-judgment-level-reclaim.md, signed 2026-11-13), as oi_div_reversal_4h's page
// copied them word for word: RULES_TEMPLATE below is that page's text from "## Where the bar comes from" to Results,
// with only the read, wallet, config, record start and reset cut-off made into fields. paperJudgePage.test.mjs
// renders it with oi_div_reversal_4h's values and checks the result is that page's text, byte for byte.
//
// The owner signs judgmentSignMessage(axis, sha256 of the page above Results) on /ops (routes-judgesign.mjs); the
// daily watcher writes the page, the signature and the code entry (paperJudge.mjs PAPER_JUDGMENTS) into the repo.
// Pure: no fetch, no KV.

import { PAPER_SETUPS, ownerSign } from "./paperClaim.mjs";

export const JUDGE_FEE_BPS = 2.5; // taker, each side: the account's Gold-tier rate (CLAUDE.md, PAPER_TAKER_FEE_BPS)

export const RULES_TEMPLATE = "## Where the bar comes from\n\nThe Paper gate was written before this wallet existed (`pipeline-if-then.md`, signed 2026-10-23): \"After 30 or more\npaper trades with parity CLEAN and net positive after fees: a written live plan\". This page adds nothing to that bar.\nIt fixes how each part of it is counted, so the answer at trade 30 is computed, not argued.\n\nWhat was visible when this was written: nothing. The wallet started at {{STARTED}} and had 0 trades. The\nrules are level_reclaim's, written before this read had a paper wallet.\n\n## The rules\n\n1. **Wallet.** `{{WALLET}}`, the {{AXIS}} paper wallet, trading\n   `{{CONFIG}}` ({{CONFIG_DESC}}).\n2. **The trades judged.** The first 30 paper trades closed after the record start (the later of the wallet's\n   `started_at` and its `paper_reset_at`), numbered by close time as `/proof/paper/{{AXIS}}` numbers them.\n   Trade 31 and later never count toward this verdict.\n3. **A reset ends the run.** If the wallet's paper record is reset after this page was written (`paper_reset_at`\n   later than {{CUTOFF}}) the verdict is RESET: final, shown, and the run it replaced is not judged. A\n   new run needs a new dated page.\n4. **The money bar.** Each trade's net, in bps of its entry notional:\n   `net = move − fees − funding`, where\n   - move = the price move in the trade's direction, from its judged entry to its judged exit (rule 5);\n   - fees = 2.5 bps taker on the entry notional plus 2.5 bps on the exit notional (the account's Gold-tier rate on\n     the day of writing; frozen here, a later change of rate doesn't move this run);\n   - funding = what the position paid while held, from the recorded hourly rates (`heldFundingBps`); collected\n     funding counts as a negative cost. A trade whose funding can't be read is judged without it and counted.\n   The 30 trades weigh the same (the wallet trades a fixed notional). **Mean net above 0 bps = PASS. Mean net at or\n   below 0 = FAIL.** No slippage is charged: paper fills at the mark, and live slippage is measured on its own\n   (`GET /agent/:a/slippage`).\n5. **Judged prices come from the public tape** (`paper-tape.md`, the stored check of each fill):\n   - ON_TAPE or NEAR (within 10 bps of what traded): the paper price.\n   - OFF (more than 10 bps outside what traded in that minute): the worse of the paper price and the nearest price\n     that traded in the checked bar. A buy is judged at no less than the bar's low, a sell at no more than its high.\n     A price that wasn't on the tape can only hurt the run, never help it.\n   - NO_DATA or NO_TRADES (Orderly had no bar to check against): the paper price, and the count is printed with\n     the verdict.\n   - Not checked yet (PENDING): the verdict waits.\n6. **Parity.** `paperParity` over the run's entries: from the record start to the 30th trade's entry (plus parity's\n   10-minute clock slack). Each of the 30 entries must pair with a graded event, and every graded event the wallet\n   was free to take before then must have an entry. Events while the 30th trade is held are its own (busy) and\n   outside the run. Read once that window is settled (2 hours, parity's settle time) and the 30th trade has closed.\n   CLEAN = the verdict is given. DRIFT or UNVERIFIABLE = HELD: no verdict until the drift is explained (\"a DRIFT\n   stops every step below until it's explained\", pipeline-if-then.md). An explanation is a change to the parity\n   rule in its own PR, never an edit here.\n7. **Final once.** PASS, FAIL or RESET is recorded once in `pjudge:{{AXIS}}` (LAB_STORE) with the 30\n   trades as judged, and never rewritten. Served at `GET /signals/paper-judge/{{AXIS}}` and on the paper\n   run page. The verdict is then appended under Results in its own PR.\n8. **What a verdict licenses.** Nothing automatic.\n   - PASS: a written live plan may be drafted and signed (its own dated page and PR; none exists for this read). The\n     house rules (`live-money-review.md`) still bind: the $10 mechanics test first; arming and size are borst's, in\n     person.\n   - FAIL: the read stays Tradeable on the scoreboard and nothing goes live. The gap between graded and traded is the\n     next question, written down before it is looked at.\n";

const iso = (v) => new Date(typeof v === "number" ? v : Date.parse(v)).toISOString();
const isoSec = (v) => iso(v).replace(/\.\d{3}Z$/, "Z");

/** "graded exit, 11 main coins, fixed $50 margin at 3×", read from the preset itself. */
export function configDescription(config) {
  const n = Array.isArray(config?.symbols) ? config.symbols.length : 0;
  return `graded exit, ${n} main coins, fixed $${config?.capitalPerTrade} margin at ${config?.leverage}×`;
}

/** The rules part (from "## Where the bar comes from" up to Results), as the template fills it. */
export function renderRules({ axis, wallet, configName, configDesc, startedAt, resetCutoff }) {
  const f = { AXIS: axis, WALLET: wallet, CONFIG: configName, CONFIG_DESC: configDesc, STARTED: isoSec(startedAt), CUTOFF: isoSec(resetCutoff) };
  return RULES_TEMPLATE.replace(/\{\{(AXIS|WALLET|CONFIG_DESC|CONFIG|STARTED|CUTOFF)\}\}/g, (_, k) => f[k]);
}

/** The file name a read's page lives at. */
export const judgmentDocPath = (axis) => `docs/research/paper-judgment-${String(axis).replace(/_/g, "-")}.md`;

/**
 * The whole page for a read whose paper wallet was registered (a paperClaim.mjs record): the text above Results,
 * then an empty Results heading. null if the read has no paper setup.
 * @param {{ axis, wallet, at, startedAt }} claim
 */
export function renderJudgmentPage(claim, setups = PAPER_SETUPS) {
  const setup = setups[claim?.axis];
  if (!setup?.configName) return null;
  const day = iso(claim.at).slice(0, 10);
  const head = `# ${claim.axis} on paper · the 30-trade judgment, locked before trade 1\n\n`
    + `Drafted ${day} by the pipeline when \`${claim.wallet}\` was registered as ${claim.axis}'s paper wallet\n`
    + "(`app/lib/paperClaim.mjs`), as a copy of the level_reclaim page (`paper-judgment-level-reclaim.md`, signed by borst\n"
    + "2026-11-13). Only the read, its wallet, its config and its record are changed; every rule is that page's rule. The\n"
    + "owner signs the sha256 of this text above Results with the owner wallet; the signature is recorded under Results, so\n"
    + "the text above it never moves. The same rules are in code in `app/lib/paperJudge.mjs` (`PAPER_JUDGMENTS`,\n"
    + "`judgePaperRun`).\n\n";
  const rules = renderRules({
    axis: claim.axis, wallet: claim.wallet, configName: setup.configName, configDesc: configDescription(setup.config),
    startedAt: claim.startedAt, resetCutoff: claim.at,
  });
  return `${head}${rules}\n## Results\n`;
}

/** The text a signature covers: everything above "\n## Results" (the same cut paperJudge.test.mjs pins). */
export function pageAboveResults(page) {
  const cut = String(page || "").indexOf("\n## Results");
  return cut > 0 ? page.slice(0, cut) : null;
}

/** The exact text the owner signs. ASCII only. */
export function judgmentSignMessage(address, axis, pageSha256, ts) {
  return "Nexus pipeline: SIGN a 30-trade paper judgment\n"
    + `Read: ${axis}\nPage sha256: ${pageSha256}\n`
    + "I have read these rules. A PASS or FAIL at trade 30 is final.\n"
    + `Address: ${String(address).toLowerCase()}\nTimestamp: ${ts}\nTrades nothing. Moves no funds. Valid 5 minutes.`;
}

/** The code entry the watcher writes into PAPER_JUDGMENTS (paperJudge.mjs) for a drafted page. */
export function judgmentEntry(claim, { signed }) {
  return {
    doc: judgmentDocPath(claim.axis),
    signedAt: iso(claim.at), // the reset cut-off (rule 3)
    wallet: claim.wallet,
    feeBps: JUDGE_FEE_BPS,
    signature: signed ? "signed" : "pending",
  };
}

/** The line the watcher appends under Results once the owner has signed (a judgment signature record). */
export function signedResultsLine(rec) {
  return `### ${iso(rec.at).slice(0, 10)} · signed\n\n`
    + `Signed with the owner's wallet \`${rec.by}\` at ${iso(rec.at)}, with ${rec.tradesAtSigning} closed trades on the paper wallet.\n`
    + `The signature covers the sha256 of the text above Results, \`${rec.pageSha256}\`, in the message\n`
    + "`judgmentSignMessage` (`app/lib/paperJudgePage.mjs`) builds; anyone can recover the signer from it:\n\n"
    + `\`${rec.sig}\` (timestamp ${rec.sigTs}).\n`;
}

/** Browser: the owner signs a drafted page by its sha256 (the hash the server served with the page). */
export async function signJudgment(addr, wallet, axis, pageSha256, opts = {}) {
  const s = await ownerSign(addr, wallet, (me, ts) => judgmentSignMessage(me, axis, pageSha256, ts), opts);
  return { ...s, sha256: pageSha256 };
}
