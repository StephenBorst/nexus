import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAttribution, settlementReport, isBaseChain, ERC8021_MARKER } from "./flashSettlement.mjs";

// Builds a suffix exactly as ox's erc8021 toDataSuffix does (schema 0 / 1).
const hexOf = (s) => Buffer.from(s, "ascii").toString("hex");
const byte = (n) => n.toString(16).padStart(2, "0");
function suffix(codes, registry) {
  const c = hexOf(codes.join(","));
  return (registry ? registry.toLowerCase().replace(/^0x/, "") : "") + c + byte(c.length / 2) + byte(registry ? 1 : 0) + ERC8021_MARKER;
}
const CALL = "0xa9059cbb" + "00".repeat(64);

test("reads codes at the end of calldata (schema 0)", () => {
  const p = parseAttribution(CALL + suffix(["definitive", "bc_lrqwbh7u"]));
  assert.equal(p.at, "end");
  assert.equal(p.schemaId, 0);
  assert.deepEqual(p.codes, ["definitive", "bc_lrqwbh7u"]);
});

test("pinned vector: the bytes ox's toDataSuffix produces for ['baseapp']", () => {
  // 0x + "baseapp" ascii + len 07 + schema 00 + marker
  assert.equal(suffix(["baseapp"]), "62617365617070" + "07" + "00" + "80218021802180218021802180218021");
  assert.deepEqual(parseAttribution("0x1234" + suffix(["baseapp"])).codes, ["baseapp"]);
});

test("schema 1 carries the registry address", () => {
  const reg = "0x" + "ab".repeat(20);
  const p = parseAttribution(CALL + suffix(["x"], reg));
  assert.equal(p.schemaId, 1);
  assert.equal(p.codeRegistryAddress, reg);
  assert.deepEqual(p.codes, ["x"]);
});

test("no marker → none; marker followed by more data → inside", () => {
  assert.equal(parseAttribution(CALL).at, "none");
  assert.equal(parseAttribution("0xzz").at, "none");
  const p = parseAttribution(CALL + suffix(["bc_lrqwbh7u"]) + "deadbeef");
  assert.equal(p.at, "inside");
  assert.deepEqual(p.codes, ["bc_lrqwbh7u"]);
});

test("Base detection", () => {
  assert.equal(isBaseChain({ id: "base", name: "Base", namespace: "eip155" }), true);
  assert.equal(isBaseChain({ id: "8453", name: "x", namespace: "eip155" }), true);
  assert.equal(isBaseChain({ id: "arbitrum", name: "Arbitrum", namespace: "eip155" }), false);
  assert.equal(isBaseChain({ id: "solana", name: "Solana", namespace: "solana" }), false);
});

const ORDER = {
  orderId: "o1", status: "ORDER_STATUS_FILLED", orderType: "market", integratorFeeBps: "10",
  targetAsset: { chain: { id: "base", name: "Base", namespace: "eip155" } },
  contraAsset: { chain: { id: "base", name: "Base", namespace: "eip155" } },
};
const FILL = { transactionId: "0xaaa", status: "CHAIN_STATUS_FINALIZED", notional: "5", integratorFeeNotional: "0.005", integratorFeeAmount: "0.005", feeTicker: "USDC" };
const OK_TX = { "0xaaa": { input: CALL + suffix(["definitive", "bc_lrqwbh7u"]) } };
const run = (o = {}) => settlementReport({ order: ORDER, fills: [FILL], txByHash: OK_TX, expectFeeBps: 10, expectCode: "bc_lrqwbh7u", ...o });

test("a $5 fill with $0.005 fee and our code at the end passes both", () => {
  const r = run();
  assert.equal(r.fee.verdict, "PASS");
  assert.equal(r.code.verdict, "PASS");
  assert.equal(r.fills[0].impliedBps, 10);
});

test("fee: zero, wrong rate, or not requested on the order = FAIL", () => {
  assert.equal(run({ fills: [{ ...FILL, integratorFeeNotional: "0" }] }).fee.verdict, "FAIL");
  assert.equal(run({ fills: [{ ...FILL, notional: "1000", integratorFeeNotional: "0.5" }] }).fee.verdict, "FAIL"); // 5 bps
  assert.equal(run({ order: { ...ORDER, integratorFeeBps: null } }).fee.verdict, "FAIL");
});

test("fee: cent rounding on a small fill still passes", () => {
  assert.equal(run({ fills: [{ ...FILL, notional: "3", integratorFeeNotional: "0.01" }] }).fee.verdict, "PASS"); // 33 bps raw, within 1¢
});

test("code: missing, someone else's only, or not at the end = FAIL", () => {
  assert.equal(run({ txByHash: { "0xaaa": { input: CALL } } }).code.verdict, "FAIL");
  assert.equal(run({ txByHash: { "0xaaa": { input: CALL + suffix(["definitive"]) } } }).code.verdict, "FAIL");
  assert.equal(run({ txByHash: { "0xaaa": { input: CALL + suffix(["bc_lrqwbh7u"]) + "00" } } }).code.verdict, "FAIL");
});

test("unreadable tx = UNREAD, never PASS; no fills = PENDING; other chain = NOT_BASE", () => {
  assert.equal(run({ txByHash: { "0xaaa": null } }).code.verdict, "UNREAD");
  const empty = run({ fills: [] });
  assert.equal(empty.fee.verdict, "PENDING");
  assert.equal(empty.code.verdict, "PENDING");
  const arb = { ...ORDER, targetAsset: { chain: { id: "arbitrum" } }, contraAsset: { chain: { id: "arbitrum" } } };
  assert.equal(run({ order: arb }).code.verdict, "NOT_BASE");
});

test("one failing fill fails the order", () => {
  const r = run({ fills: [FILL, { ...FILL, transactionId: "0xbbb" }], txByHash: { ...OK_TX, "0xbbb": { input: CALL } } });
  assert.equal(r.code.verdict, "FAIL");
});
