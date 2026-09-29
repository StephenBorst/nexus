// Run: node --test app/lib/registryEvent.test.mjs
// The registry's registration event is read by its emitter and layout (registryEvent.mjs). The bug
// this pins: a check keyed to the Lab ABI's signature hash never matched a real registration.
import test from "node:test";
import assert from "node:assert/strict";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { registryEvents, THESIS_REGISTRY } from "./registryEvent.mjs";

const sig = (s) => "0x" + bytesToHex(keccak_256(utf8ToBytes(s)));
const word = (n) => "0x" + BigInt(n).toString(16).padStart(64, "0");
const pad = (a) => "0x" + "0".repeat(24) + a.slice(2).toLowerCase();
const ME = "0x" + "Ab".repeat(20);
const REG_CHECKSUMMED = "0x2F4EdA890f96a7979d6f26bCB210cEDAD68346Bc";

test("the registry's event under a signature the Lab's ABI never declared", () => {
  const logs = [{ address: REG_CHECKSUMMED, topics: [sig("ThesisRegistered(uint256,address,string)"), word(42), pad(ME)], data: "0x" }];
  assert.deepEqual(registryEvents(logs), [{ topic0: sig("ThesisRegistered(uint256,address,string)"), thesisId: 42n, trader: ME.toLowerCase() }]);
  // …and under the one it did declare: the layout decides, not the hash.
  assert.equal(registryEvents([{ ...logs[0], topics: [sig("ThesisRegistered(uint256,address)"), word(7), pad(ME)] }])[0].thesisId, 7n);
});

test("only the registry's logs with an indexed id and an indexed address", () => {
  const good = { address: THESIS_REGISTRY, topics: [sig("X()"), word(1), pad(ME)] };
  assert.equal(registryEvents([{ ...good, address: "0x" + "99".repeat(20) }]).length, 0, "another contract");
  assert.equal(registryEvents([{ ...good, topics: good.topics.slice(0, 2) }]).length, 0, "no indexed trader");
  assert.equal(registryEvents([{ ...good, topics: [good.topics[0], good.topics[1], word(5)] }]).length, 1,
    "a small number reads as an address: callers match the trader to a wallet, so it proves no one");
  assert.equal(registryEvents([{ ...good, topics: [good.topics[0], good.topics[1], "0x" + "ff".repeat(32)] }]).length, 0, "not an address");
  assert.deepEqual(registryEvents(null), []);
  assert.deepEqual(registryEvents([null, {}, { address: THESIS_REGISTRY }]), []);
  assert.equal(registryEvents([{ ...good, topics: [good.topics[0], "not-hex", pad(ME)] }])[0].thesisId, null, "an unreadable id doesn't hide the trader");
});
