// Signing a live plan with the owner's wallet, after a PASS (app/lib/livePlanSign.mjs, routes-plansign.mjs, the
// watcher's nextPlanRecords). Run: node --test livePlanSign.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import {
  LIVE_PLANS, LIVE_PLAN_SIGS_KEY, planAboveSignoff, livePlanSignMessage, planSignRefusal, signedPlanLine, signedPlanLines,
} from "../../app/lib/livePlanSign.mjs";
import { LIVE_PLAN_TEXT } from "../../app/lib/livePlanText.mjs";
import { livePlanModule } from "../../tools/pipeline/livePlans.mjs";
import { nextPlanRecords } from "../../app/lib/pipelineRecordsWrite.mjs";
import { handlePlanSign } from "./routes-plansign.mjs";
import { PJUDGE_KEY } from "./paperJudge.mjs";

const ROOT = new URL("../../", import.meta.url);
const read = (p) => readFileSync(new URL(p, ROOT), "utf8");
const sha = (t) => createHash("sha256").update(t).digest("hex");
const recover = (message, signature) => recoverMessageAddress({ message, signature });
const owner = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const O = owner.address.toLowerCase();
const T0 = Date.parse("2026-12-16T12:00:00Z");

test("the generated text is each plan page above Sign-off, hash and all (edit the page = regenerate)", () => {
  assert.equal(read("app/lib/livePlanText.mjs"), livePlanModule(read), "run: node tools/pipeline/livePlans.mjs --write");
  for (const [axis, { doc }] of Object.entries(LIVE_PLANS)) {
    const above = planAboveSignoff(read(doc));
    assert.equal(LIVE_PLAN_TEXT[axis].text, above);
    assert.equal(LIVE_PLAN_TEXT[axis].sha256, sha(above));
  }
});

test("every signature written under a plan's Sign-off recovers to its signer, over the page as it stands", async () => {
  for (const [axis, { doc }] of Object.entries(LIVE_PLANS)) {
    const page = read(doc);
    for (const s of signedPlanLines(page)) {
      assert.equal(s.sha256, sha(planAboveSignoff(page)), `${axis}: the page changed after it was signed (a new number = a new dated page)`);
      assert.equal((await recover(livePlanSignMessage(s.by, axis, s.sha256, s.sigTs), s.sig)).toLowerCase(), s.by);
    }
  }
});

test("the message names the read and the hash, and says it arms nothing", () => {
  const m = livePlanSignMessage(O, "level_reclaim", "ab".repeat(32), T0);
  assert.ok(m.includes("Read: level_reclaim") && m.includes(`Plan sha256: ${"ab".repeat(32)}`));
  assert.match(m, /Signing arms nothing: arming is its own PR, in person\./);
  assert.ok(/^[\x20-\x7e\n]+$/.test(m), "ASCII only");
});

test("refused before a PASS, over another page, twice, or for a read with no plan", () => {
  const base = { axis: "level_reclaim", verdict: "PASS", planSha: "aa", sha: "aa", signed: null };
  assert.equal(planSignRefusal(base), null);
  assert.equal(planSignRefusal({ ...base, verdict: null }).error, "not_licensed");
  assert.match(planSignRefusal({ ...base, verdict: "FAIL" }).detail, /verdict is FAIL/);
  assert.equal(planSignRefusal({ ...base, verdict: "HELD" }).error, "not_licensed");
  assert.equal(planSignRefusal({ ...base, sha: "bb" }).error, "page_changed");
  assert.equal(planSignRefusal({ ...base, signed: {} }).error, "already_signed");
  assert.equal(planSignRefusal({ ...base, axis: "oi_div_reversal_4h", planSha: null }).error, "no_plan");
});

// ── The route on KV fixtures ─────────────────────────────────────────────────────────────────────
function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}
const env = (verdict) => ({ LAB_STORE: kv({ "ops:safe:owners": [O], ...(verdict ? { [PJUDGE_KEY("level_reclaim")]: { verdict } } : {}) }) });
const deps = { lock: async (_e, _k, fn) => fn(), fetchImpl: async () => { throw new Error("network"); }, now: () => T0 };
const get = (e, axis = "level_reclaim") => handlePlanSign(["pipeline", "live-plan", axis], new Request("https://og.test/x"), e, deps);
const post = (e, body) => handlePlanSign(["pipeline", "live-plan", "level_reclaim", "sign"], new Request("https://og.test/x", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), e, deps);
const signed = async (account, h, ts = T0) => ({ address: account.address, ts, sha256: h, sig: await account.signMessage({ message: livePlanSignMessage(account.address, "level_reclaim", h, ts) }) });
const H = LIVE_PLAN_TEXT.level_reclaim.sha256;

test("GET serves the plan's exact text and hash, and whether it may be signed", async () => {
  const j = await (await get(env(null))).json();
  assert.equal(j.text, LIVE_PLAN_TEXT.level_reclaim.text);
  assert.equal(j.sha256, H);
  assert.equal(j.licensed, false);
  assert.equal(j.verdict, null);
  assert.equal((await (await get(env("PASS"))).json()).licensed, true);
  assert.equal((await get(env(null), "oi_div_reversal_4h")).status, 404, "no plan written for that read yet");
});

test("the owner signs after a PASS, once; before a PASS, a forged or foreign signature = refused, nothing stored", async () => {
  const early = env(null);
  assert.equal((await (await post(early, await signed(owner, H))).json()).error, "not_licensed");
  assert.equal(early.LAB_STORE.m.has(LIVE_PLAN_SIGS_KEY), false);
  const e = env("PASS");
  assert.equal((await post(e, await signed(mallory, H))).status, 403);
  assert.equal((await (await post(e, { ...(await signed(mallory, H)), address: owner.address })).json()).error, "bad_signature");
  assert.equal((await (await post(e, await signed(owner, "cd".repeat(32)))).json()).error, "page_changed");
  assert.equal((await (await post(e, await signed(owner, H, T0 - 6 * 60_000))).json()).error, "signature_expired");
  assert.equal(e.LAB_STORE.m.has(LIVE_PLAN_SIGS_KEY), false);
  const ok = await post(e, await signed(owner, H));
  assert.equal(ok.status, 200);
  const rec = (await ok.json()).signed;
  assert.equal(rec.by, O);
  assert.equal(rec.sha256, H);
  assert.equal((await (await post(e, await signed(owner, H, T0 + 1000))).json()).error, "already_signed");
  assert.equal((await (await get(e)).json()).signed.by, O);
});

test("signing arms nothing: the live lift stays empty in every worker", () => {
  for (const w of ["nexus-lab-api", "nexus-agent-exec", "nexus-agent-brain"]) {
    assert.match(read(`workers/${w}/wrangler.toml`), /^GRADED_EXIT_LIVE_LIFT = ""$/m, w);
  }
  const route = read("workers/nexus-lab-api/routes-plansign.mjs");
  assert.doesNotMatch(route, /GRADED_EXIT_LIVE_LIFT\s*=|\.put\(\s*`agent:/, "the route writes only its own key");
});

// ── The watcher writes the signature under Sign-off ─────────────────────────────────────────────
test("the watcher appends the signed line once, after re-checking hash and signer; anything off = an issue", async () => {
  const doc = LIVE_PLAN_TEXT.level_reclaim.doc;
  const page = read(doc);
  const s = await signed(owner, H);
  const rec = { axis: "level_reclaim", by: O, at: new Date(T0).toISOString(), sigTs: s.ts, sig: s.sig, sha256: H };
  const run = (served, docs = { [doc]: page }) => nextPlanRecords({ served, plans: LIVE_PLAN_TEXT, docs, recover, sha256: sha });
  const one = await run({ level_reclaim: { signed: rec } });
  assert.deepEqual(one.issues, []);
  const written = one.writes[doc];
  assert.equal(planAboveSignoff(written), planAboveSignoff(page), "the text above Sign-off never moves");
  assert.deepEqual(signedPlanLines(written), [{ by: O, at: rec.at, sha256: H, sig: s.sig, sigTs: s.ts }]);
  assert.match(signedPlanLine(rec), /Arms nothing\.\n$/);
  const again = await run({ level_reclaim: { signed: rec } }, { [doc]: written });
  assert.deepEqual(again.writes, {}, "already written: nothing to do");
  const forged = await run({ level_reclaim: { signed: { ...rec, by: "0x" + "1".repeat(40) } } });
  assert.match(forged.issues[0], /doesn't recover/);
  const drifted = await run({ level_reclaim: { signed: rec } }, { [doc]: page.replace("## 3 · The plan", "## 3 · The plan (edited)") });
  assert.match(drifted.issues[0], /isn't the page in git/);
  assert.deepEqual((await run({ level_reclaim: { signed: null } })).writes, {});
});
