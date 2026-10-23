// Operator groups: both wallets consent, joining is permanent, groups don't nest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { operatorJoinMessage, operatorOf, groupWallets, planJoin, OPERATOR_MAX_WALLETS, JOIN_ERRORS } from "./arenaOperator.mjs";

const A = "0x" + "a1".repeat(20), B = "0x" + "b2".repeat(20), C = "0x" + "c3".repeat(20), D = "0x" + "d4".repeat(20);

test("the message names both wallets, lowercase, and says it is permanent", () => {
  const m = operatorJoinMessage(A.toUpperCase().replace("0X", "0x"), B);
  assert.match(m, new RegExp(`operator: ${A}`));
  assert.match(m, new RegExp(`wallet: ${B}`));
  assert.match(m, /Permanent/);
  assert.notEqual(operatorJoinMessage(A, B), operatorJoinMessage(B, A), "who runs whom is part of the text");
});

test("a first join creates the group; the operator leads its own slot", () => {
  const p = planJoin(null, A, B, 1000);
  assert.equal(p.ok, true);
  assert.equal(p.already, false);
  assert.deepEqual(groupWallets(p.next, A), [A, B]);
  assert.equal(p.next[A].joined[B], 1000);
  assert.equal(operatorOf(p.next, A), A);
  assert.equal(operatorOf(p.next, B), A);
  assert.equal(operatorOf(p.next, C), null);
});

test("joining twice is a no-op, not a second slot", () => {
  const g = planJoin(null, A, B).next;
  const p = planJoin(g, A, B);
  assert.equal(p.ok, true);
  assert.equal(p.already, true);
  assert.equal(p.next, null);
});

test("a wallet counts toward one operator only (no hopping to a better slot)", () => {
  const g = planJoin(null, A, B).next;
  assert.deepEqual(planJoin(g, C, B), { ok: false, error: "wallet_in_other_group" });
});

test("groups don't nest", () => {
  const g = planJoin(null, A, B).next;
  assert.deepEqual(planJoin(g, C, A), { ok: false, error: "wallet_is_operator" }, "an operator can't become a member");
  assert.deepEqual(planJoin(g, B, C), { ok: false, error: "operator_is_member" }, "a member can't run its own group");
});

test("same wallet and bad addresses are refused", () => {
  assert.equal(planJoin(null, A, A).error, "same_wallet");
  assert.equal(planJoin(null, "0x12", B).error, "bad_address");
});

test("there is no leave: the plan only ever appends", () => {
  let g = planJoin(null, A, B).next;
  g = planJoin(g, A, C).next;
  g = planJoin(g, A, D).next;
  assert.deepEqual(groupWallets(g, A), [A, B, C, D]);
});

test("a slot has a size cap", () => {
  let g = null;
  for (let i = 0; i < OPERATOR_MAX_WALLETS; i++) {
    const w = "0x" + (i + 16).toString(16).padStart(2, "0").repeat(20);
    g = planJoin(g, A, w).next;
  }
  assert.equal(planJoin(g, A, B).error, "group_full");
  for (const k of ["bad_address", "same_wallet", "wallet_is_operator", "wallet_in_other_group", "operator_is_member", "group_full"]) {
    assert.ok(JOIN_ERRORS[k], `${k} has a readable hint`);
  }
});
