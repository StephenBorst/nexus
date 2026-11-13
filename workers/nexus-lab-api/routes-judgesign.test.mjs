// The drafted 30-trade judgment page (app/lib/paperJudgePage.mjs) and the owner's wallet signature on it
// (routes-judgesign.mjs). Run: node --test routes-judgesign.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";
import { handleJudgeSign, JUDGMENT_SIGS_KEY } from "./routes-judgesign.mjs";
import {
  renderRules, renderJudgmentPage, pageAboveResults, configDescription, judgmentSignMessage, judgmentEntry,
  signedResultsLine, judgmentDocPath, RULES_TEMPLATE,
} from "../../app/lib/paperJudgePage.mjs";
import { PAPER_CLAIMS_KEY, PAPER_SETUPS } from "../../app/lib/paperClaim.mjs";
import { OI_DIV_4H_PAPER_CONFIG } from "../../app/lib/oiDivReversal.mjs";
import { LEVEL_RECLAIM_PAPER_CONFIG } from "../../app/lib/levelReclaim.mjs";

const T0 = Date.parse("2026-11-20T12:00:00Z");
const owner = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const O = owner.address.toLowerCase();
const PW = "0x" + "7".repeat(40);
const sha = (t) => createHash("sha256").update(t).digest("hex");

const OI_PAGE = readFileSync(new URL("../../docs/research/paper-judgment-oi-div-reversal-4h.md", import.meta.url), "utf8");
const LR_PAGE = readFileSync(new URL("../../docs/research/paper-judgment-level-reclaim.md", import.meta.url), "utf8");
const section = (doc) => doc.slice(doc.indexOf("## Where the bar comes from"), doc.indexOf("\n## Results"));

test("the template IS the signed oi_div_reversal_4h rules: rendered with its values, byte for byte", () => {
  const got = renderRules({
    axis: "oi_div_reversal_4h", wallet: "0xd446acE5934a0A337A9ee5F0D8ad37FdF8a1e2CD", configName: "OI_DIV_4H_PAPER_CONFIG",
    configDesc: configDescription(OI_DIV_4H_PAPER_CONFIG), startedAt: "2026-11-13T19:35:47Z", resetCutoff: "2026-11-13T00:00:00Z",
  });
  assert.equal(got, section(OI_PAGE));
});

test("…and its numbered rules are level_reclaim's signed rules with only the read, wallet and config swapped", () => {
  const rules = (doc) => doc.slice(doc.indexOf("## The rules"), doc.indexOf("\n## Results"))
    .replace(/level_reclaim|oi_div_reversal_4h|\{\{AXIS\}\}/g, "READ").replace(/LEVEL_RECLAIM_PAPER_CONFIG|OI_DIV_4H_PAPER_CONFIG|\{\{CONFIG\}\}/g, "CONFIG")
    .replace(/0x[0-9a-fA-F]{40}|\{\{WALLET\}\}/g, "WALLET").replace(/\s+/g, " ");
  const norm = (s) => s.replace(/this page was (signed|written)|the day of (signing|writing)/g, "X").replace(/may be (drafted and )?signed.*?PR[^.]*\./, "LIVEPLAN.");
  assert.equal(norm(rules(`${RULES_TEMPLATE}\n## Results`).replace(/\{\{CONFIG_DESC\}\}/, "graded exit, 11 main coins, fixed $50 margin at 3×").replace(/\{\{CUTOFF\}\}/, "2026-11-13T00:00:00Z")), norm(rules(LR_PAGE)));
});

test("the config line is read from the preset", () => {
  assert.equal(configDescription(OI_DIV_4H_PAPER_CONFIG), "graded exit, 11 main coins, fixed $50 margin at 3×");
  assert.equal(configDescription(LEVEL_RECLAIM_PAPER_CONFIG), "graded exit, 11 main coins, fixed $50 margin at 3×");
  assert.equal(configDescription({ ...OI_DIV_4H_PAPER_CONFIG, symbols: ["A", "B"], capitalPerTrade: 20, leverage: 2 }), "graded exit, 2 main coins, fixed $20 margin at 2×");
});

// A read the brain doesn't trade yet, set up for the test only.
const TEST_SETUPS = { ...PAPER_SETUPS, session_fade: { config: OI_DIV_4H_PAPER_CONFIG, configName: "SESSION_FADE_PAPER_CONFIG", deploy: "t" } };
const CLAIM = { axis: "session_fade", wallet: PW, by: O, at: "2026-11-20T10:00:00.000Z", sigTs: T0, startedAt: "2026-11-20T09:58:12.345Z" };

test("a drafted page: the read, its wallet, start and cut-off filled in, then an empty Results", () => {
  const page = renderJudgmentPage(CLAIM, TEST_SETUPS);
  assert.match(page, /^# session_fade on paper · the 30-trade judgment, locked before trade 1\n/);
  assert.ok(page.includes(`\`${PW}\`, the session_fade paper wallet, trading\n   \`SESSION_FADE_PAPER_CONFIG\``));
  assert.ok(page.includes("The wallet started at 2026-11-20T09:58:12Z and had 0 trades."));
  assert.ok(page.includes("later than 2026-11-20T10:00:00Z) the verdict is RESET"));
  assert.ok(page.includes("`pjudge:session_fade`"));
  assert.doesNotMatch(page, /\{\{|oi_div|0xd446/);
  assert.ok(page.endsWith("\n## Results\n"));
  assert.equal(pageAboveResults(page), page.slice(0, page.indexOf("\n## Results")));
  assert.equal(renderJudgmentPage(CLAIM, TEST_SETUPS), page, "the same text every time: its hash is what gets signed");
  assert.equal(renderJudgmentPage({ ...CLAIM, axis: "rsi_reset_deep" }), null, "no paper setup, no page");
});

test("the message names the read and the page hash; the entry and the Results line the watcher writes", async () => {
  const h = sha("x");
  const m = judgmentSignMessage(O, "session_fade", h, T0);
  assert.ok(m.includes(`Page sha256: ${h}`) && m.includes("Read: session_fade"));
  assert.match(m, /A PASS or FAIL at trade 30 is final\./);
  assert.ok(/^[\x20-\x7e\n]+$/.test(m), "ASCII only");
  assert.deepEqual(judgmentEntry(CLAIM, { signed: true }), { doc: "docs/research/paper-judgment-session-fade.md", signedAt: CLAIM.at, wallet: PW, feeBps: 2.5, signature: "signed" });
  assert.equal(judgmentEntry(CLAIM, { signed: false }).signature, "pending");
  assert.equal(judgmentDocPath("oi_div_reversal_4h"), "docs/research/paper-judgment-oi-div-reversal-4h.md", "the existing pages' naming");
  const sig = await owner.signMessage({ message: m });
  const line = signedResultsLine({ by: O, at: new Date(T0).toISOString(), sigTs: T0, sig, pageSha256: h, tradesAtSigning: 0 });
  assert.ok(line.includes(sig) && line.includes(h) && line.includes("with 0 closed trades"));
  assert.equal((await recoverMessageAddress({ message: m, signature: sig })).toLowerCase(), O, "anyone can recover the signer");
});

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); } };
}
const envWith = ({ trades = 0, claims = { session_fade: CLAIM } } = {}) => ({
  LAB_STORE: kv({ "ops:safe:owners": [O], [PAPER_CLAIMS_KEY]: claims }),
  NEXUS_AGENT: kv({ [`agent:state:${PW}`]: { started_at: Date.parse(CLAIM.startedAt), paper_agg: { trades } } }),
});
const deps = { setups: TEST_SETUPS, judgments: {}, lock: async (_e, _k, fn) => fn(), fetchImpl: async () => { throw new Error("network"); } };
const get = (env, axis = "session_fade", d = deps) => handleJudgeSign(["pipeline", "judgment", axis], new Request(`https://og.test/pipeline/judgment/${axis}`), env, d);
const sign = (env, body, at = T0) => handleJudgeSign(["pipeline", "judgment", "session_fade", "sign"], new Request("https://og.test/x", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), env, { ...deps, now: () => at });
const signedBody = async (account, h, ts = T0) => ({ address: account.address, ts, sha256: h, sig: await account.signMessage({ message: judgmentSignMessage(account.address, "session_fade", h, ts) }) });

test("GET serves the page and its hash; none for a read the code already judges or one without a wallet", async () => {
  const env = envWith();
  const j = await (await get(env)).json();
  assert.equal(j.sha256, sha(pageAboveResults(j.page)));
  assert.equal(j.signed, null);
  assert.equal((await get(env, "level_reclaim", { ...deps, judgments: undefined })).status, 404, "level_reclaim's page is in the code");
  assert.equal((await get(envWith({ claims: {} }))).status, 404);
});

test("the owner signs the page as served, once; the record names the trades at signing", async () => {
  const env = envWith({ trades: 2 });
  const { sha256 } = await (await get(env)).json();
  const r = await sign(env, await signedBody(owner, sha256));
  assert.equal(r.status, 200);
  const rec = (await r.json()).signed;
  assert.equal(rec.by, O);
  assert.equal(rec.pageSha256, sha256);
  assert.equal(rec.tradesAtSigning, 2);
  assert.equal(JSON.parse(env.LAB_STORE.m.get(JUDGMENT_SIGS_KEY)).session_fade.sig, rec.sig);
  const again = await sign(env, await signedBody(owner, sha256, T0 + 1000), T0 + 1000);
  assert.equal((await again.json()).error, "already_signed");
  assert.equal((await (await get(env)).json()).signed.by, O);
});

test("refused: a different page, a non-owner, a forged signer, an old signature, after trade 30", async () => {
  const env = envWith();
  const { sha256 } = await (await get(env)).json();
  assert.equal((await (await sign(env, await signedBody(owner, sha("another page")))).json()).error, "page_changed");
  assert.equal((await sign(env, await signedBody(mallory, sha256))).status, 403);
  assert.equal((await (await sign(env, { ...(await signedBody(mallory, sha256)), address: owner.address })).json()).error, "bad_signature");
  assert.equal((await (await sign(env, await signedBody(owner, sha256, T0 - 6 * 60_000))).json()).error, "signature_expired");
  const late = envWith({ trades: 30 });
  assert.equal((await (await sign(late, await signedBody(owner, sha256))).json()).error, "too_late", "signing after the result is not signing rules");
  assert.equal(env.LAB_STORE.m.has(JUDGMENT_SIGS_KEY), false, "nothing written on a refusal");
});
