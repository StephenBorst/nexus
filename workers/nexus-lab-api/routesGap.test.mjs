import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gapFor } from "./routes-gap.mjs";
import { readPaperConfig, HOUSE_PAPER_IDS } from "../../app/lib/housePaper.mjs";

const kv = (o) => ({ get: async (k) => (k in o ? o[k] : null), put: async () => { throw new Error("the gap route writes nothing"); } });
const USER = "0x" + "a".repeat(40);
const T = Date.parse("2026-11-20T00:00:00Z");
const iso = (m) => new Date(T + m * 60000).toISOString();
const row = (sym, dir, o, c, e, x, reason) => ({ symbol: `PERP_${sym}_USDC`, direction: dir, opened_at: iso(o), closed_at: iso(c), entry_price: e, exit_price: x, reason, sl_percent: 2 });

test("a user's paper run of a read is compared with that read's house run; nothing is written", async () => {
  const house = HOUSE_PAPER_IDS.oi_div_reversal;
  const store = {
    [`agent:config:${USER}`]: JSON.stringify(readPaperConfig("oi_div_reversal")),
    [`agent:state:${USER}`]: JSON.stringify({ started_at: iso(0), paper_trades: [row("ETH", "LONG", 101, 200, 3000.6, 3060, "TP")] }),
    [`agent:state:${house}`]: JSON.stringify({ started_at: iso(0), paper_trades: [row("ETH", "LONG", 100, 200, 3000, 3060, "TP")] }),
  };
  const env = { NEXUS_AGENT: kv(store), LAB_STORE: kv({}) };
  const { status, body } = await gapFor(USER, env, T + 10_000 * 60000);
  assert.equal(status, 200);
  assert.equal(body.refWallet, house);
  assert.equal(body.house, true);
  assert.equal(body.matched, 1);
  assert.equal(body.pairs[0].entryBps, 2);
  assert.match(body.line, /^Paired 1 of the read’s own 1 trade · missed 0 · extra 0\./);
  assert.deepEqual(body.runs.mine, { count: 1, target: 30 });
  assert.match(body.note, /not slippage/);
});

test("no registered read, or a live config = 400; the reference wallet itself = self", async () => {
  const env = (cfg) => ({ NEXUS_AGENT: kv({ [`agent:config:${USER}`]: JSON.stringify(cfg) }), LAB_STORE: kv({}) });
  assert.equal((await gapFor(USER, env({ mode: "PAPER", signalMode: "MOMENTUM" }))).status, 400);
  assert.equal((await gapFor(USER, env({ ...readPaperConfig("oi_div_reversal"), mode: "AUTONOMOUS" }))).status, 400);
  const house = HOUSE_PAPER_IDS.oi_div_reversal;
  const self = await gapFor(house, { NEXUS_AGENT: kv({ [`agent:config:${house}`]: JSON.stringify(readPaperConfig("oi_div_reversal")) }), LAB_STORE: kv({}) });
  assert.deepEqual([self.status, self.body.self], [200, true]);
});

test("wired: GET /agent/:a/gap only, before parity, through gapFor", () => {
  const src = readFileSync(new URL("./index.js", import.meta.url), "utf8");
  assert.match(src, /import \{ gapFor \} from "\.\/routes-gap\.mjs";/);
  assert.match(src, /request\.method === "GET" && parts\[2\] === "gap"\) \{\s+const \{ status, body \} = await gapFor\(address, env\);/);
});
