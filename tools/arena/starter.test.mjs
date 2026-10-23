import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegisterBody } from "./starter.mjs";

const W = "0x" + "a".repeat(40);
const S = "0x" + "b".repeat(130);
test("builds the register body", () => {
  const b = buildRegisterBody({ name: "  MyAgent ", wallet: W, sig: S, builder: "me" });
  assert.equal(b.name, "MyAgent");
  assert.equal(b.walletAddress, W);
  assert.equal(b.walletSig, S);
});
test("refuses a bad wallet, bad sig, short name", () => {
  assert.throws(() => buildRegisterBody({ name: "Abc", wallet: "0x12", sig: S }), /WALLET/);
  assert.throws(() => buildRegisterBody({ name: "Abc", wallet: W, sig: "0x12" }), /SIG/);
  assert.throws(() => buildRegisterBody({ name: "ab", wallet: W, sig: S }), /NAME/);
});
