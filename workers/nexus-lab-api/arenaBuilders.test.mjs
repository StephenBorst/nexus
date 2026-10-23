// Builder groups: a claim is signed per wallet, a typed name groups nothing, and the
// board sums every member's record (no losers hidden). Pure rules + the claim route
// end-to-end with real signatures against an in-memory KV.
import { test } from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { normBuilderName, builderMessage, validateBuilderClaim, groupIntoSlots } from "./arenaBuilders.mjs";
import { recoverEthAddress } from "./shared.mjs";
import { handleArena, arenaPaperBlock } from "./routes-arena.mjs";

const DAY = 86400000;
const pk = (n) => `0x${n.toString(16).padStart(64, "0")}`;
const acct = (n) => privateKeyToAccount(pk(n));

// ── name normalisation ──
test("builder names: lowercase, single-spaced, 2–40 chars of [a-z0-9 ._-]", () => {
  assert.equal(normBuilderName("  Ada   Lovelace  "), "ada lovelace");
  assert.equal(normBuilderName("x"), null, "too short");
  assert.equal(normBuilderName("a<script>"), null, "markup chars refused");
  assert.equal(normBuilderName("-lead"), null, "must start alnum");
  assert.equal(normBuilderName("a".repeat(41)), null, "too long");
  assert.equal(normBuilderName("a".repeat(40)), "a".repeat(40));
});

// ── claim validation (recover stubbed: signature string encodes its signer) ──
const fakeRecover = (msg, sig) => (sig.startsWith("sig-") ? sig.slice(4) : null);
const W1 = "0x" + "1".repeat(40), W2 = "0x" + "2".repeat(40);

test("claim: every wallet must sign the claim message itself", () => {
  const ok = validateBuilderClaim({ builder: "Ada", claims: [{ wallet: W1, sig: "sig-" + W1 }, { wallet: W2, sig: "sig-" + W2 }] }, fakeRecover);
  assert.equal(ok.ok, true);
  assert.equal(ok.norm, "ada");
  assert.deepEqual(ok.wallets, [W1, W2]);

  const forged = validateBuilderClaim({ builder: "Ada", claims: [{ wallet: W1, sig: "sig-" + W2 }] }, fakeRecover);
  assert.equal(forged.error, "bad_sig", "a signature from another wallet is refused");
});

test("claim: duplicate, empty, and oversized claims are refused", () => {
  const dup = validateBuilderClaim({ builder: "Ada", claims: [{ wallet: W1, sig: "sig-" + W1 }, { wallet: W1, sig: "sig-" + W1 }] }, fakeRecover);
  assert.equal(dup.error, "duplicate_wallet");
  assert.equal(validateBuilderClaim({ builder: "Ada", claims: [] }, fakeRecover).error, "claims_required");
  const many = Array.from({ length: 11 }, (_, i) => { const w = "0x" + (i + 1).toString(16).padStart(40, "0"); return { wallet: w, sig: "sig-" + w }; });
  assert.equal(validateBuilderClaim({ builder: "Ada", claims: many }, fakeRecover).error, "too_many_wallets");
});

test("claim: the signed message is bound to the normalised name", () => {
  let seen = null;
  validateBuilderClaim({ builder: "  ADA ", claims: [{ wallet: W1, sig: "sig-" + W1 }] }, (msg, sig) => { seen = msg; return sig.slice(4); });
  assert.equal(seen, builderMessage("ada"));
  assert.notEqual(builderMessage("ada"), "nexus-trading-key-v1", "claim sigs can't be replayed as registration sigs");
});

// ── grouping + aggregation ──
const paperOf = (trades, wins, net, gw, gl, opts = {}) => arenaPaperBlock({
  paper_agg: { trades, wins, grossWin: gw, grossLoss: gl, net, firstTradeAt: Date.parse("2026-08-01T00:00Z"), lastTradeAt: Date.parse("2026-08-01T00:00Z") + (opts.days ?? 10) * DAY },
  paper_resets: opts.resets ?? 0,
});
const row = (wallet, paper, extra = {}) => ({ wallet, name: "n-" + wallet.slice(0, 4), description: "", builder: "", createdAt: 1, active: true, mode: "PAPER", currentPosition: null, paper, live: null, claim: null, ...extra });

test("ungrouped wallets stay separate even with the same typed builder string", () => {
  const a = row(W1, paperOf(20, 12, 50, 300, 250), { builder: "Same" });
  const b = row(W2, paperOf(20, 5, -40, 100, 140), { builder: "Same" });
  const slots = groupIntoSlots([a, b]);
  assert.equal(slots.length, 2, "a typed name alone never merges wallets");
  assert.ok(slots.every((s) => s.walletCount === 1));
});

test("claimed wallets form one slot whose record is the sum of all members, losers included", () => {
  const claim = { norm: "ada", name: "Ada" };
  const winner = row(W1, paperOf(30, 20, 120, 400, 280), { claim });
  const loser = row(W2, paperOf(20, 4, -90, 60, 150), { claim });
  const slots = groupIntoSlots([winner, loser]);
  assert.equal(slots.length, 1);
  const s = slots[0];
  assert.equal(s.walletCount, 2);
  assert.deepEqual(s.wallets.sort(), [W1, W2].sort());
  assert.equal(s.builder, "Ada");
  assert.equal(s.paper.trades, 50, "losing wallet's trades are counted");
  assert.equal(s.paper.wins, 24);
  assert.equal(s.paper.netPnl, 30, "losing wallet's P&L is subtracted");
  assert.equal(s.paper.winRate, 48);
  assert.equal(s.paper.lifetime, true);
});

test("a single-wallet slot reproduces that wallet's own record exactly", () => {
  const own = paperOf(40, 22, 75.5, 310, 234.5, { resets: 2 });
  const [s] = groupIntoSlots([row(W1, own)]);
  assert.equal(s.paper.trades, own.trades);
  assert.equal(s.paper.wins, own.wins);
  assert.equal(s.paper.netPnl, own.netPnl);
  assert.equal(s.paper.winRate, own.winRate);
  assert.equal(s.paper.score, own.score);
  assert.equal(s.paper.resets, 2);
  assert.equal(s.paper.qualify.eligible, own.qualify.eligible);
});

test("a window member makes the slot a window, and it can't qualify", () => {
  const windowOnly = arenaPaperBlock({ paper_trades: [{ pnl: 4, opened_at: new Date(0).toISOString(), closed_at: new Date(DAY).toISOString() }] });
  const claim = { norm: "mix", name: "Mix" };
  const [s] = groupIntoSlots([row(W1, paperOf(30, 20, 120, 400, 280), { claim }), row(W2, windowOnly, { claim })]);
  assert.equal(s.paper.lifetime, false);
  assert.equal(s.paper.qualify, null);
  assert.match(s.paper.window, /some wallets/);
});

test("the lead wallet (its detail page) is the strongest member; rows sorted by live then score", () => {
  const claim = { norm: "ada", name: "Ada" };
  const weak = row(W2, paperOf(12, 5, -5, 50, 55), { claim });
  const strong = row(W1, paperOf(60, 40, 300, 700, 400), { claim });
  const [s] = groupIntoSlots([weak, strong]);
  assert.equal(s.wallet, W1);
  assert.equal(s.wallets[0], W1);
});

// ── the claim route, with real signatures and an in-memory KV ──
function fakeKV() {
  const m = new Map();
  return {
    get: async (k) => (m.has(k) ? m.get(k) : null),
    put: async (k, v) => { m.set(k, String(v)); },
    delete: async (k) => { m.delete(k); },
    _m: m,
  };
}
const claimReq = (body) => new Request("https://og.test/arena/builder/claim", { method: "POST", headers: { "content-type": "application/json", origin: "https://trade.nexustradinglabs.com" }, body: JSON.stringify(body) });
async function registered(kv, n) {
  const a = acct(n);
  kv._m.set(`arena:profile:${a.address.toLowerCase()}`, JSON.stringify({ name: "agent " + n, wallet: a.address.toLowerCase(), createdAt: 1 }));
  return a;
}
async function signFor(a, name) {
  return a.signMessage({ message: builderMessage(normBuilderName(name)) });
}

test("route: wallets sign and the name groups them; a re-claim needs every member", async () => {
  const kv = fakeKV();
  const env = { NEXUS_AGENT: kv };
  const A = await registered(kv, 11), B = await registered(kv, 12), C = await registered(kv, 13);
  const mk = async (signers, name = "Forge") => ({
    builder: name,
    claims: await Promise.all(signers.map(async (s) => ({ wallet: s.address, sig: await signFor(s, name) }))),
  });

  const r1 = await handleArena(["arena", "builder", "claim"], claimReq(await mk([A, B])), env);
  assert.equal(r1.status, 200);
  assert.equal((await r1.json()).walletCount, 2);

  // C tries to take the name with only its own signature: refused, A and B are members.
  const r2 = await handleArena(["arena", "builder", "claim"], claimReq(await mk([C])), env);
  assert.equal(r2.status, 409);
  assert.equal((await r2.json()).error, "builder_name_taken");

  // Re-claim by all current members (plus C) is accepted.
  const r3 = await handleArena(["arena", "builder", "claim"], claimReq(await mk([A, B, C])), env);
  assert.equal(r3.status, 200);
});

test("route: an unregistered wallet can't be grouped, and a grouped wallet can't move", async () => {
  const kv = fakeKV();
  const env = { NEXUS_AGENT: kv };
  const A = await registered(kv, 21);
  const ghost = acct(22); // never registered
  const r1 = await handleArena(["arena", "builder", "claim"], claimReq({
    builder: "Alpha", claims: [{ wallet: A.address, sig: await signFor(A, "Alpha") }, { wallet: ghost.address, sig: await signFor(ghost, "Alpha") }],
  }), env);
  assert.equal(r1.status, 400);
  assert.equal((await r1.json()).error, "not_registered");

  const r2 = await handleArena(["arena", "builder", "claim"], claimReq({ builder: "Alpha", claims: [{ wallet: A.address, sig: await signFor(A, "Alpha") }] }), env);
  assert.equal(r2.status, 200);
  const B = await registered(kv, 23);
  const r3 = await handleArena(["arena", "builder", "claim"], claimReq({ builder: "Beta", claims: [{ wallet: A.address, sig: await signFor(A, "Beta") }, { wallet: B.address, sig: await signFor(B, "Beta") }] }), env);
  assert.equal(r3.status, 409, "A is already grouped under Alpha");
  assert.equal((await r3.json()).error, "wallet_in_other_builder");
});

test("route: a claim signed for a different name is refused", async () => {
  const kv = fakeKV();
  const env = { NEXUS_AGENT: kv };
  const A = await registered(kv, 31);
  const r = await handleArena(["arena", "builder", "claim"], claimReq({ builder: "Gamma", claims: [{ wallet: A.address, sig: await signFor(A, "Delta") }] }), env);
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "bad_sig");
});
