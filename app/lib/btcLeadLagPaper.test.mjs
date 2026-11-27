// btc_lead_lag's own paper wallet (borst 2026-11-27, option (a)): the preset is the house run's config exactly, the
// setup link loads it, and once a wallet is claimed the judgment follows THAT wallet, never the house run.
// Run: node --test app/lib/btcLeadLagPaper.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BTC_LEAD_LAG_PAPER_CONFIG, BTC_LEAD_LAG_DEPLOY } from "./btcLeadLagPaper.mjs";
import { housePaperConfig, HOUSE_PAPER_IDS, HOUSE_PAPER_SKIP } from "./housePaper.mjs";
import { PAPER_SETUPS, paperConfigMismatch, claimRefusal } from "./paperClaim.mjs";
import { PAPER_JUDGMENTS, judgmentsFor, judgePaperRun } from "./paperJudge.mjs";
import { paperRun } from "./paperRun.mjs";
import { renderJudgmentPage } from "./paperJudgePage.mjs";
import { registrationFor } from "./readPipeline.mjs";

const HOUSE = "0x97371cec6dc63aa0e9c0747110e5e3042b6217a5";
const PW = "0x1f74e1ec61427c9ba3f95d7f406a195b7fbdeeeb";
const CLAIMS = { btc_lead_lag: { axis: "btc_lead_lag", wallet: PW, at: "2026-11-28T00:00:00Z", startedAt: "2026-11-27T23:00:00Z" } };

test("the preset is the house run's config, field for field", () => {
  assert.equal(HOUSE_PAPER_IDS.btc_lead_lag, HOUSE);
  assert.deepEqual({ ...BTC_LEAD_LAG_PAPER_CONFIG, symbols: [...BTC_LEAD_LAG_PAPER_CONFIG.symbols], takeProfits: [] }, housePaperConfig("btc_lead_lag"));
  assert.deepEqual(paperConfigMismatch(housePaperConfig("btc_lead_lag"), BTC_LEAD_LAG_PAPER_CONFIG), []);
});

test("the preset, as borst stated it", () => {
  const c = BTC_LEAD_LAG_PAPER_CONFIG;
  assert.ok(Object.isFrozen(c));
  assert.equal(c.mode, "PAPER");
  assert.equal(c.signalMode, "REGISTERED_READ");
  assert.equal(c.read, "btc_lead_lag");
  assert.equal(c.exitContract, "R_CONTRACT");
  assert.equal(c.maxHoldHours, 168);
  assert.deepEqual(c.symbols, ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "WLD"].map((x) => `PERP_${x}_USDC`));
  assert.equal(c.leverage, 3);
  assert.equal(c.capitalPerTrade, 50);
  assert.equal(c.maxTradesPerDay, 24);
  assert.equal(c.maxDailyLossUsdc, 1000);
  assert.deepEqual(c.takeProfits, []);
  for (const k of ["trailingStopPct", "breakevenTriggerPct", "maxSignalAgeSec"]) assert.equal(c[k], 0, k);
  for (const k of ["dcaEnabled", "volScaledStops", "invertSignal", "respectRegime", "respectSmartMoney"]) assert.equal(c[k], false, k);
  for (const k of ["riskPerTradeUsd", "volTargetPct", "basisConfirm", "tradeSessions", "autocopy"]) assert.ok(!(k in c), `${k} stays unset`);
});

test("PAPER_SETUPS carries it with the hidden deploy link, and the Lab loads that link", () => {
  assert.equal(BTC_LEAD_LAG_DEPLOY, "btc-lead-lag-paper");
  const s = PAPER_SETUPS.btc_lead_lag;
  assert.equal(s.config, BTC_LEAD_LAG_PAPER_CONFIG);
  assert.equal(s.configName, "BTC_LEAD_LAG_PAPER_CONFIG");
  assert.equal(s.deploy, BTC_LEAD_LAG_DEPLOY);
  const lab = readFileSync(new URL("../pages/lab/index.tsx", import.meta.url), "utf8");
  assert.match(lab, /searchParams\.get\("deploy"\) !== BTC_LEAD_LAG_DEPLOY/);
  assert.match(lab, /deployToAgent\(\{ \.\.\.BTC_LEAD_LAG_PAPER_CONFIG,[^]*?replaceFilters: true \}\)/);
});

test("a fresh wallet on the preset can be claimed while the read is served TRADEABLE; nothing else can", () => {
  const fresh = { started_at: "2026-11-27T23:00:00Z", paper_agg: { trades: 0 }, paper_trades: [] };
  const base = { axis: "btc_lead_lag", wallet: PW, stage: "TRADEABLE", claims: {}, config: { ...BTC_LEAD_LAG_PAPER_CONFIG }, state: fresh };
  assert.equal(claimRefusal(base), null);
  assert.equal(claimRefusal({ ...base, stage: "LEAD" }).error, "not_tradeable");
  assert.equal(claimRefusal({ ...base, config: { ...BTC_LEAD_LAG_PAPER_CONFIG, read: "level_reclaim" } }).error, "not_the_preset");
  assert.equal(claimRefusal({ ...base, config: { ...BTC_LEAD_LAG_PAPER_CONFIG, invertSignal: true } }).error, "not_the_preset");
  assert.equal(claimRefusal({ ...base, state: { ...fresh, paper_agg: { trades: 6 } } }).error, "not_fresh");
  // the house run itself can never be the claimed wallet: it has trades, and no one can sign its activation
  assert.equal(claimRefusal({ ...base, wallet: HOUSE, state: { ...fresh, paper_agg: { trades: 6 } } }).error, "not_fresh");
});

test("no claim: the house run is judged, as the signed house-runs page says", () => {
  assert.equal(registrationFor("btc_lead_lag")?.paperWallet ?? null, null, "no code wallet yet (the watcher writes it after the claim)");
  assert.equal(PAPER_JUDGMENTS.btc_lead_lag.wallet, HOUSE);
  assert.equal(judgmentsFor({}).btc_lead_lag.wallet, HOUSE);
});

test("claimed: the house run is no longer judged; the read has no entry until its own page is signed", () => {
  const j = judgmentsFor(CLAIMS);
  assert.equal(j.btc_lead_lag, undefined);
  assert.equal(judgePaperRun("btc_lead_lag", { state: { started_at: 1, paper_agg: { trades: 30 } }, judgments: j }), null);
  // every other read is untouched
  for (const [axis, rule] of Object.entries(PAPER_JUDGMENTS)) if (axis !== "btc_lead_lag") assert.deepEqual(j[axis], rule, axis);
  // the reads with their own wallets in code keep their own pages
  assert.equal(j.level_reclaim.wallet, "0x95e26E980e300C34360933b849457F42c6Bd7622");
  assert.equal(j.oi_div_reversal_4h.wallet, "0xd446acE5934a0A337A9ee5F0D8ad37FdF8a1e2CD");
});

test("no read with its own wallet in code is ever judged on a house run", () => {
  for (const axis of Object.keys(HOUSE_PAPER_IDS)) {
    if (registrationFor(axis)?.paperWallet) assert.notEqual(PAPER_JUDGMENTS[axis]?.wallet?.toLowerCase(), HOUSE_PAPER_IDS[axis], axis);
  }
  assert.ok(!("btc_lead_lag" in HOUSE_PAPER_SKIP), "the house run keeps running as data");
});

test("claimed: /proof's run is the claimed wallet, not the house run", () => {
  const run = paperRun("btc_lead_lag", null, null, { wallet: PW });
  assert.equal(String(run.wallet).toLowerCase(), PW);
  assert.equal(run.house, false);
  assert.equal(paperRun("btc_lead_lag", null, null, {}).house, true);
});

test("claimed: its judgment page drafts from the claim, naming the preset", () => {
  const page = renderJudgmentPage(CLAIMS.btc_lead_lag);
  assert.ok(page);
  assert.match(page, /`0x1f74e1ec61427c9ba3f95d7f406a195b7fbdeeeb`, the btc_lead_lag paper wallet/);
  assert.match(page, /`BTC_LEAD_LAG_PAPER_CONFIG` \(graded exit, 11 main coins, fixed \$50 margin at 3×\)/);
});
