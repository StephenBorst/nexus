// The pipeline's machine-written records (app/lib/pipelineRecords.mjs) and the watcher's writer
// (app/lib/pipelineRecordsWrite.mjs, tools/pipeline/records.mjs). Run: node --test pipelineRecords.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { PAPER_WALLET_RECORDS, JUDGMENT_RECORDS } from "../../app/lib/pipelineRecords.mjs";
import { nextRecords, recordsModuleSource, recordsReport } from "../../app/lib/pipelineRecordsWrite.mjs";
import { paperClaimMessage, PAPER_SETUPS } from "../../app/lib/paperClaim.mjs";
import { renderJudgmentPage, pageAboveResults, judgmentSignMessage, judgmentDocPath } from "../../app/lib/paperJudgePage.mjs";
import { OI_DIV_4H_PAPER_CONFIG } from "../../app/lib/oiDivReversal.mjs";
import { registrationFor } from "../../app/lib/readPipeline.mjs";
import { PAPER_JUDGMENTS } from "../../app/lib/paperJudge.mjs";

const ROOT = new URL("../../", import.meta.url);
const sha = (t) => createHash("sha256").update(t).digest("hex");
const recover = (message, signature) => recoverMessageAddress({ message, signature });

// ── What is in git right now ──────────────────────────────────────────────────────────────────────
test("the records file is exactly what the writer would write (nobody edited it by hand)", () => {
  assert.equal(readFileSync(new URL("app/lib/pipelineRecords.mjs", ROOT), "utf8"), recordsModuleSource(PAPER_WALLET_RECORDS, JUDGMENT_RECORDS));
});

test("every recorded paper wallet carries the owner's signature, and the registry reads it", async () => {
  for (const [axis, r] of Object.entries(PAPER_WALLET_RECORDS)) {
    assert.equal((await recover(paperClaimMessage(r.by, axis, r.wallet, r.sigTs), r.sig)).toLowerCase(), r.by, axis);
    assert.equal(registrationFor(axis).paperWallet.toLowerCase(), r.wallet, `${axis}: readPipeline serves it`);
  }
});

test("every recorded judgment page is the template rendered from its claim, its hash and signature check out", async () => {
  for (const [axis, j] of Object.entries(JUDGMENT_RECORDS)) {
    const claim = PAPER_WALLET_RECORDS[axis];
    assert.ok(claim, `${axis}: a judgment needs its wallet record`);
    const page = renderJudgmentPage({ axis, wallet: claim.wallet, at: claim.at, startedAt: claim.startedAt });
    const doc = readFileSync(new URL(j.doc, ROOT), "utf8");
    assert.equal(pageAboveResults(doc), pageAboveResults(page), `${axis}: the page in git is the template`);
    assert.equal(sha(pageAboveResults(doc)), j.pageSha256);
    if (j.signature === "signed") {
      assert.equal((await recover(judgmentSignMessage(j.signedBy, axis, j.pageSha256, j.signedSigTs), j.signedSig)).toLowerCase(), j.signedBy);
      assert.ok(doc.includes(j.signedSig), `${axis}: the signature is under Results`);
    }
    assert.equal(PAPER_JUDGMENTS[axis].signature, j.signature, `${axis}: the judge reads it`);
  }
});

// ── The writer, end to end on a fixture ───────────────────────────────────────────────────────────
const owner = privateKeyToAccount("0x" + "a1".repeat(32));
const O = owner.address.toLowerCase();
const PW = "0x" + "7".repeat(40);
const TEST_SETUPS = { ...PAPER_SETUPS, session_fade: { config: OI_DIV_4H_PAPER_CONFIG, configName: "SESSION_FADE_PAPER_CONFIG", deploy: "t" } };
const AT = "2026-11-20T10:00:00.000Z", STARTED = "2026-11-20T09:58:12.345Z", TS = Date.parse(AT) - 5000;

async function fixture({ signed = false } = {}) {
  const claim = { axis: "session_fade", wallet: PW, by: O, at: AT, startedAt: STARTED, sigTs: TS, sig: await owner.signMessage({ message: paperClaimMessage(O, "session_fade", PW, TS) }) };
  const page = renderJudgmentPage({ axis: "session_fade", wallet: PW, at: AT, startedAt: STARTED }, TEST_SETUPS);
  const h = sha(pageAboveResults(page));
  const sTs = TS + 3600_000;
  const sig = signed ? { by: O, at: new Date(sTs).toISOString(), sigTs: sTs, pageSha256: h, tradesAtSigning: 1, sig: await owner.signMessage({ message: judgmentSignMessage(O, "session_fade", h, sTs) }) } : null;
  return { claim, draft: { page, sha256: h, signed: sig } };
}
const run = (over) => nextRecords({ recover, sha256: sha, setups: TEST_SETUPS, codedJudgments: PAPER_JUDGMENTS, ...over });
const PATH = judgmentDocPath("session_fade");

test("first run: the wallet is recorded and the page drafted, signature pending", async () => {
  const { claim, draft } = await fixture();
  const out = await run({ claims: [claim], drafts: { session_fade: draft }, docs: { [PATH]: null } });
  assert.deepEqual(out.issues, []);
  assert.equal(out.walletRecords.session_fade.wallet, PW);
  assert.equal(out.walletRecords.session_fade.sig, claim.sig);
  assert.equal(out.judgmentRecords.session_fade.signature, "pending");
  assert.equal(out.writes[PATH], draft.page);
  assert.equal(out.changes.length, 2);
  const { title } = recordsReport(out.changes, out.issues);
  assert.match(title, /^Pipeline watch: paper records · session_fade$/, "the watcher's own title prefix");
});

test("after the owner signs: the Results line is appended once; a rerun changes nothing", async () => {
  const first = await fixture();
  const one = await run({ claims: [first.claim], drafts: { session_fade: first.draft }, docs: { [PATH]: null } });
  const { claim, draft } = await fixture({ signed: true });
  const two = await run({ walletRecords: one.walletRecords, judgmentRecords: one.judgmentRecords, claims: [claim], drafts: { session_fade: draft }, docs: { [PATH]: one.writes[PATH] } });
  assert.deepEqual(two.issues, []);
  const doc = two.writes[PATH];
  assert.equal(pageAboveResults(doc), pageAboveResults(draft.page), "the text above Results never moves");
  assert.ok(doc.includes(draft.signed.sig) && doc.includes("with 1 closed trades"));
  assert.equal(two.judgmentRecords.session_fade.signature, "signed");
  assert.deepEqual(two.changes, ["session_fade: judgment signed by " + O + " at 1 trades"]);
  const three = await run({ walletRecords: two.walletRecords, judgmentRecords: two.judgmentRecords, claims: [claim], drafts: { session_fade: draft }, docs: { [PATH]: doc } });
  assert.deepEqual(three.writes, {});
  assert.deepEqual(three.changes, []);
  assert.equal(recordsModuleSource(three.walletRecords, three.judgmentRecords), recordsModuleSource(two.walletRecords, two.judgmentRecords));
});

test("the written module loads and serves the same records", async () => {
  const { claim, draft } = await fixture({ signed: true });
  const out = await run({ claims: [claim], drafts: { session_fade: draft }, docs: { [PATH]: null } });
  const src = recordsModuleSource(out.walletRecords, out.judgmentRecords);
  const mod = await import(`data:text/javascript,${encodeURIComponent(src)}`);
  assert.deepEqual(JSON.parse(JSON.stringify(mod.PAPER_WALLET_RECORDS)), JSON.parse(JSON.stringify(out.walletRecords)));
  assert.equal(mod.JUDGMENT_RECORDS.session_fade.signature, "signed");
  assert.ok(Object.isFrozen(mod.PAPER_WALLET_RECORDS.session_fade));
});

test("nothing served is trusted: a bad signature, a changed page or a git page that differs = an issue, no write", async () => {
  const { claim, draft } = await fixture({ signed: true });
  const forged = await run({ claims: [{ ...claim, wallet: "0x" + "9".repeat(40) }], drafts: { session_fade: draft }, docs: { [PATH]: null } });
  assert.equal(forged.issues.length, 1);
  assert.deepEqual(forged.writes, {});
  assert.equal(forged.walletRecords.session_fade, undefined, "the wallet is inside the signature");
  const edited = await run({ claims: [claim], drafts: { session_fade: { ...draft, page: draft.page.replace("Mean net above 0 bps", "Mean net above -5 bps") } }, docs: { [PATH]: null } });
  assert.match(edited.issues[0], /doesn't match the template/);
  assert.equal(edited.writes[PATH], undefined);
  const badSig = await run({ claims: [claim], drafts: { session_fade: { ...draft, signed: { ...draft.signed, by: "0x" + "1".repeat(40) } } }, docs: { [PATH]: null } });
  assert.match(badSig.issues[0], /judgment signature/);
  const drifted = await run({ claims: [claim], drafts: { session_fade: draft }, docs: { [PATH]: draft.page.replace("## The rules", "## The rules (edited)") } });
  assert.match(drifted.issues[0], /differs from the page above Results/);
  assert.equal(drifted.writes[PATH], undefined);
});

test("the code wins: a claim against a hand-written wallet is an issue, a hand-written judgment is never drafted over", async () => {
  const other = "0x" + "6".repeat(40);
  const c = { axis: "level_reclaim", wallet: other, by: O, at: AT, startedAt: STARTED, sigTs: TS, sig: await owner.signMessage({ message: paperClaimMessage(O, "level_reclaim", other, TS) }) };
  const out = await run({ claims: [c], drafts: {}, docs: {} });
  assert.match(out.issues[0], /the code names/);
  assert.deepEqual(out.walletRecords, {});
  const same = { ...c, wallet: registrationFor("level_reclaim").paperWallet.toLowerCase() };
  same.sig = await owner.signMessage({ message: paperClaimMessage(O, "level_reclaim", same.wallet, TS) });
  const ok = await run({ claims: [same], drafts: { level_reclaim: { page: "x", sha256: "y" } }, docs: {} });
  assert.deepEqual(ok.issues, []);
  assert.deepEqual(ok.changes, [], "already in the code: nothing to record, its judgment is hand-written");
});

test("the watcher routine runs the records step and may merge only its record-only PR", () => {
  const doc = readFileSync(new URL("docs/routines/pipeline-watch.md", ROOT), "utf8");
  assert.match(doc, /node tools\/pipeline\/records\.mjs/);
  assert.ok(existsSync(new URL("tools/pipeline/records.mjs", ROOT)));
});
