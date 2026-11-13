// Paper-wallet registration (app/lib/paperClaim.mjs + routes-paperclaim.mjs): the owner binds a FRESH paper wallet on
// the read's exact preset to a TRADEABLE read; first registration wins, forever. Run: node --test routes-paperclaim.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { handlePaperClaim, readPaperClaims } from "./routes-paperclaim.mjs";
import {
  PAPER_CLAIMS_KEY, PAPER_SETUPS, paperClaimMessage, checkClaimSignature, paperConfigMismatch, freshnessRefusal,
  claimRefusal, readsWithClaims, parseClaims, paperWalletOf, paperSetupRows,
} from "../../app/lib/paperClaim.mjs";
import { LEVEL_RECLAIM_PAPER_CONFIG } from "../../app/lib/levelReclaim.mjs";
import { OI_DIV_4H_PAPER_CONFIG } from "../../app/lib/oiDivReversal.mjs";
import { LockBusy } from "./lock.mjs";
import { recoverEthAddress } from "./shared.mjs";

const T0 = Date.parse("2026-11-14T12:00:00Z");
const owner = privateKeyToAccount("0x" + "a1".repeat(32));
const mallory = privateKeyToAccount("0x" + "b2".repeat(32));
const O = owner.address.toLowerCase();
const PW = "0x" + "7".repeat(40);           // the fresh paper wallet
const PW2 = "0x" + "8".repeat(40);
const KEY = "axisbt:test:min20";

// The two live paper wallets' configs as stored (GET /agent/:a, 2026-11-14): what the hidden setup links produce.
const LIVE_LR = { symbols: ["PERP_BTC_USDC", "PERP_ETH_USDC", "PERP_SOL_USDC", "PERP_XRP_USDC", "PERP_DOGE_USDC", "PERP_BNB_USDC", "PERP_ARB_USDC", "PERP_AVAX_USDC", "PERP_LINK_USDC", "PERP_HYPE_USDC", "PERP_WLD_USDC"], leverage: 3, capitalPerTrade: 50, tpPercent: 2.5, slPercent: 2, maxHoldHours: 168, maxTradesPerDay: 24, maxDailyLossUsdc: 1000, fundingThreshold: 0.01, fundingPercentileMin: 95, volTargetPct: 0, signalMode: "LEVEL_RECLAIM", oiChangeThreshold: 1, priceChangeThreshold: 0.5, mode: "PAPER", respectRegime: false, respectSmartMoney: false, invertSignal: false, maxSignalAgeSec: 0, volScaledStops: false, exitContract: "R_CONTRACT", dcaEnabled: false, breakevenTriggerPct: 0, takeProfits: [], trailingStopPct: 0 };
const LIVE_OI = { ...LIVE_LR, signalMode: "OI_DIV_4H", oiChangeThreshold: 0, symbols: [...LIVE_LR.symbols].reverse() };
const FRESH = { active: true, started_at: T0 - 60_000, current_position: null, daily_pnl: 0, trades_today: 0 };

// A read the brain doesn't trade yet, set up for the test only (no code wallet), so the success path can run.
const TEST_SETUPS = { ...PAPER_SETUPS, session_fade: { config: { ...OI_DIV_4H_PAPER_CONFIG, signalMode: "TEST_MODE" }, deploy: "t" } };
const TEST_CFG = { ...LIVE_OI, signalMode: "TEST_MODE" };

function kv(init = {}) {
  const m = new Map(Object.entries(init).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
  return { m, async get(k) { return m.has(k) ? m.get(k) : null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } };
}
const board = (stages) => ({ pipeline: { reads: Object.entries(stages).map(([axis, stage]) => ({ axis, stage })) } });
const envWith = ({ stages = { session_fade: "TRADEABLE" }, agent = {}, lab = {} } = {}) => ({
  LAB_STORE: kv({ "ops:safe:owners": [O], [KEY]: board(stages), ...lab }),
  NEXUS_AGENT: kv(agent),
});
const noFetch = async () => { throw new Error("network touched"); };
const directLock = async (_env, _key, fn) => fn();
const post = (env, body, { at = T0, lock = directLock } = {}) => handlePaperClaim(["pipeline", "paper-wallet"], new Request("https://og.test/pipeline/paper-wallet", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
}), env, { scorecardKey: KEY, now: () => at, fetchImpl: noFetch, lock, setups: TEST_SETUPS });
const signed = async (account, axis, wallet, ts = T0) => ({ address: account.address, axis, wallet, ts, sig: await account.signMessage({ message: paperClaimMessage(account.address, axis, wallet, ts) }) });

test("the message names the read and the wallet, says permanent, and moves nothing", () => {
  const m = paperClaimMessage(O, "level_reclaim", PW, T0);
  assert.match(m, /Read: level_reclaim/);
  assert.ok(m.includes(`Paper wallet: ${PW}`));
  assert.match(m, /can never be replaced/);
  assert.match(m, /Trades nothing\. Moves no funds\. Valid 5 minutes\./);
  assert.ok(/^[\x20-\x7e\n]+$/.test(m), "ASCII only");
});

test("signature: 5 minutes, signer = address, a known read and a 0x wallet", async () => {
  const ok = checkClaimSignature(await signed(owner, "level_reclaim", PW), { now: T0, recover: recoverEthAddress });
  assert.equal(ok.ok, true);
  assert.equal(ok.wallet, PW);
  const late = checkClaimSignature(await signed(owner, "level_reclaim", PW, T0 - 6 * 60_000), { now: T0, recover: recoverEthAddress });
  assert.equal(late.error, "signature_expired");
  const forged = { ...(await signed(mallory, "level_reclaim", PW)), address: owner.address };
  assert.equal(checkClaimSignature(forged, { now: T0, recover: recoverEthAddress }).error, "bad_signature");
  const swapped = { ...(await signed(owner, "level_reclaim", PW)), wallet: PW2 };
  assert.equal(checkClaimSignature(swapped, { now: T0, recover: recoverEthAddress }).error, "bad_signature", "the wallet is inside the signature");
  assert.equal(checkClaimSignature({ ...(await signed(owner, "nope", PW)) }, { now: T0, recover: recoverEthAddress }).error, "unknown_read");
});

test("the preset check passes the two live paper wallets as their setup links stored them", () => {
  assert.deepEqual(paperConfigMismatch(LIVE_LR, LEVEL_RECLAIM_PAPER_CONFIG), []);
  assert.deepEqual(paperConfigMismatch(LIVE_OI, OI_DIV_4H_PAPER_CONFIG), [], "symbol order doesn't matter");
});

test("…and refuses anything that isn't the read as graded", () => {
  const P = LEVEL_RECLAIM_PAPER_CONFIG;
  const cases = [
    [{ signalMode: "OI_DIV_4H" }, "signalMode"],
    [{ symbols: LIVE_LR.symbols.slice(1) }, "symbols"],
    [{ symbols: [...LIVE_LR.symbols, "PERP_SUI_USDC"] }, "symbols"],
    [{ exitContract: undefined }, "exitContract"],
    [{ leverage: 5 }, "leverage"],
    [{ takeProfits: [{ pct: 2, size: 50 }] }, "takeProfits"],
    [{ trailingStopPct: 1 }, "trailingStopPct"],
    [{ invertSignal: true }, "invertSignal"],
    [{ respectRegime: true }, "respectRegime"],
    [{ riskPerTradeUsd: 10 }, "riskPerTradeUsd"],
    [{ volTargetPct: 2 }, "volTargetPct"],
    [{ basisConfirm: "CVD" }, "basisConfirm"],
    [{ tradeSessions: ["ASIA"] }, "tradeSessions"],
    [{ autocopy: { enabled: true, leaders: ["0x1"] } }, "autocopy"],
  ];
  for (const [patch, field] of cases) assert.ok(paperConfigMismatch({ ...LIVE_LR, ...patch }, P).includes(field), field);
  assert.deepEqual(paperConfigMismatch({ ...LIVE_LR, basisConfirm: "OFF", autocopy: { enabled: false } }, P), []);
});

test("fresh = activation stamped, no trade, no open position, never reset", () => {
  assert.equal(freshnessRefusal(FRESH), null);
  assert.equal(freshnessRefusal(null), "no_agent_state");
  assert.equal(freshnessRefusal({ ...FRESH, started_at: undefined }), "no_start_stamp");
  assert.equal(freshnessRefusal({ ...FRESH, paper_reset_at: T0 - 1 }), "record_was_reset", "a reset record can't be registered: no wiping a bad run");
  assert.equal(freshnessRefusal({ ...FRESH, paper_agg: { trades: 1 } }), "has_trades");
  assert.equal(freshnessRefusal({ ...FRESH, paper_trades: [{}] }), "has_trades");
  assert.equal(freshnessRefusal({ ...FRESH, current_position: { symbol: "PERP_BTC_USDC" } }), "has_open_position", "no looking at an open trade first");
});

test("refusal order: setup, already bound, stage, wallet in use, config, freshness", () => {
  const base = { axis: "session_fade", wallet: PW, stage: "TRADEABLE", claims: {}, config: TEST_CFG, state: FRESH, setups: TEST_SETUPS };
  assert.equal(claimRefusal(base), null);
  assert.equal(claimRefusal({ ...base, axis: "rsi_reset_deep" }).error, "no_paper_setup", "the brain must trade it first");
  assert.equal(claimRefusal({ ...base, axis: "level_reclaim" }).error, "already_registered", "code registration wins");
  assert.equal(claimRefusal({ ...base, claims: { session_fade: { axis: "session_fade", wallet: PW2 } } }).error, "already_registered");
  assert.equal(claimRefusal({ ...base, stage: "LEAD" }).error, "not_tradeable");
  assert.equal(claimRefusal({ ...base, stage: "PAPER" }).error, "not_tradeable");
  assert.equal(claimRefusal({ ...base, stage: null }).error, "stage_unread", "an unread board refuses, never guesses");
  assert.equal(claimRefusal({ ...base, wallet: "0x95e26E980e300C34360933b849457F42c6Bd7622" }).error, "wallet_in_use", "one wallet, one read");
  assert.equal(claimRefusal({ ...base, config: null }).error, "no_agent_config");
  assert.equal(claimRefusal({ ...base, config: { ...TEST_CFG, mode: "AUTONOMOUS" } }).error, "not_paper");
  assert.equal(claimRefusal({ ...base, config: { ...TEST_CFG, leverage: 10 } }).error, "not_the_preset");
  assert.equal(claimRefusal({ ...base, state: { ...FRESH, paper_agg: { trades: 2 } } }).error, "not_fresh");
});

test("claims: the code wins, garbage is dropped, and the served reads fill in a claimed wallet", () => {
  const claims = parseClaims(JSON.stringify({
    session_fade: { axis: "session_fade", wallet: PW }, level_reclaim: { axis: "level_reclaim", wallet: PW2 },
    not_a_read: { wallet: PW }, spot_absorb: { wallet: "nope" },
  }));
  assert.deepEqual(Object.keys(claims).sort(), ["level_reclaim", "session_fade"]);
  assert.equal(paperWalletOf("level_reclaim", claims), "0x95e26E980e300C34360933b849457F42c6Bd7622", "a claim never overrides the code");
  assert.equal(paperWalletOf("session_fade", claims), PW);
  const reads = readsWithClaims(claims);
  assert.equal(reads.find((r) => r.axis === "session_fade").paperWallet, PW);
  assert.equal(reads.find((r) => r.axis === "level_reclaim").paperWallet, "0x95e26E980e300C34360933b849457F42c6Bd7622");
  assert.deepEqual(parseClaims("not json"), {});
  assert.deepEqual(parseClaims(null), {});
});

test("route: the owner registers a fresh wallet once; it is stored and can never be replaced", async () => {
  const env = envWith({ agent: { [`agent:config:${PW}`]: TEST_CFG, [`agent:state:${PW}`]: FRESH, [`agent:config:${PW2}`]: TEST_CFG, [`agent:state:${PW2}`]: FRESH } });
  const r1 = await post(env, await signed(owner, "session_fade", PW));
  assert.equal(r1.status, 200);
  const j1 = await r1.json();
  assert.equal(j1.claim.wallet, PW);
  assert.equal(j1.claim.by, O);
  assert.equal(j1.claim.startedAt, new Date(FRESH.started_at).toISOString());
  assert.equal((await readPaperClaims(env)).session_fade.wallet, PW);
  const r2 = await post(env, await signed(owner, "session_fade", PW2, T0 + 1000), { at: T0 + 1000 });
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).error, "already_registered");
  assert.equal((await readPaperClaims(env)).session_fade.wallet, PW, "first registration stands");
});

test("route: only a Safe owner / OPS wallet; a busy lock refuses; nothing written on any refusal", async () => {
  const env = envWith({ agent: { [`agent:config:${PW}`]: TEST_CFG, [`agent:state:${PW}`]: FRESH } });
  const r = await post(env, await signed(mallory, "session_fade", PW));
  assert.equal(r.status, 403);
  const busy = await post(env, await signed(owner, "session_fade", PW), { lock: async () => { throw new LockBusy("x"); } });
  assert.equal(busy.status, 409);
  const stale = await post(envWith({ stages: { session_fade: "LEAD" }, agent: { [`agent:config:${PW}`]: TEST_CFG, [`agent:state:${PW}`]: FRESH } }), await signed(owner, "session_fade", PW));
  assert.equal((await stale.json()).error, "not_tradeable");
  assert.equal(env.LAB_STORE.m.has(PAPER_CLAIMS_KEY), false);
});

test("route: the stage comes from the stored board, else its last-good copy; none = 503", async () => {
  const agent = { [`agent:config:${PW}`]: TEST_CFG, [`agent:state:${PW}`]: FRESH };
  const lastGoodOnly = { LAB_STORE: kv({ "ops:safe:owners": [O], [`${KEY}:lastgood`]: board({ session_fade: "TRADEABLE" }) }), NEXUS_AGENT: kv(agent) };
  assert.equal((await post(lastGoodOnly, await signed(owner, "session_fade", PW))).status, 200);
  const none = { LAB_STORE: kv({ "ops:safe:owners": [O] }), NEXUS_AGENT: kv(agent) };
  const r = await post(none, await signed(owner, "session_fade", PW));
  assert.equal(r.status, 503);
});

test("GET lists each read the brain can paper, with stage, wallet and where it's recorded", async () => {
  const env = envWith({ stages: { level_reclaim: "PAPER", oi_div_reversal_4h: "PAPER" } });
  const r = await handlePaperClaim(["pipeline", "paper-wallets"], new Request("https://og.test/pipeline/paper-wallets"), env, { scorecardKey: KEY });
  const j = await r.json();
  const lr = j.reads.find((x) => x.axis === "level_reclaim");
  assert.equal(lr.stage, "PAPER");
  assert.equal(lr.source, "code");
  assert.equal(lr.deploy, "/lab?tab=agent&deploy=level-reclaim-paper");
  assert.deepEqual(paperSetupRows({}, {}).map((x) => x.axis).sort(), Object.keys(PAPER_SETUPS).sort());
});

test("the paper run page and the pulse read a claimed wallet; the code still wins", async () => {
  const { paperRun } = await import("../../app/lib/paperRun.mjs");
  const { signalProgress } = await import("../../app/lib/signalProgress.mjs");
  assert.equal(paperRun("session_fade", null, null, { wallet: PW }).wallet, PW);
  assert.equal(paperRun("session_fade", null), null, "no claim, no wallet: still a 404");
  assert.equal(paperRun("level_reclaim", null, null, { wallet: PW }).wallet, "0x95e26E980e300C34360933b849457F42c6Bd7622");
  assert.equal(paperRun("not_a_read", null, null, { wallet: PW }), null, "a claim can't invent a read");
  const sc = { pipeline: { reads: [{ axis: "session_fade", stage: "PAPER", paperWallet: PW, numbers: { exitTrades: 40, exitNetBps: 12 } }] } };
  assert.equal(signalProgress(sc, { [PW]: 0 })[0].paper.wallet, PW);
  assert.equal(signalProgress(sc, { [PW]: 0 })[0].paper.trades, 0);
});
