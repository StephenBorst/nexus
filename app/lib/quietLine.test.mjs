// The quiet line: why a flat agent isn't trading, from the brain's last check (app/lib/quietLine.mjs), on the agent card
// and the paper run page. Run: node --test app/lib/quietLine.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { quietLine, quietAgeText, BRAIN_STALE_MS } from "./quietLine.mjs";
import { quietReason } from "../../workers/nexus-agent-brain/logic.mjs";
import { handlePaperRun } from "../../workers/nexus-lab-api/routes-paperrun.mjs";

const NOW = Date.parse("2026-11-14T12:00:00Z");
const quiet = (extra = {}) => ({ symbol: null, direction: "NONE", confidence: 0, reason: quietReason(Array(11).fill("no extreme 4h move on falling OI this hour — sat out"), 0), timestamp: NOW - 3 * 60_000, ...extra });

test("a quiet check reads as the brain wrote it, with its age", () => {
  const q = quietLine(quiet(), NOW);
  assert.equal(q.text, "no signal · 11 of 11 markets: no extreme 4h move on falling OI this hour");
  assert.equal(q.ageMin, 3);
  assert.equal(q.stale, false);
  assert.equal(quietAgeText(q), "checked 3 min ago");
  assert.equal(quietAgeText(quietLine(quiet({ timestamp: NOW - 10_000 }), NOW)), "checked just now");
});

test("an old check says the brain may be down, never passes for current", () => {
  const q = quietLine(quiet({ timestamp: NOW - BRAIN_STALE_MS - 60_000 }), NOW);
  assert.equal(q.stale, true);
  assert.match(quietAgeText(q), /^last check 21 min ago: the brain may be down$/);
  assert.match(quietAgeText(quietLine(quiet({ timestamp: NOW - 3 * 3600_000 }), NOW)), /^last check 3 h ago/);
});

test("nothing to say when the brain picked a market, or no check is stored", () => {
  assert.equal(quietLine({ ...quiet(), symbol: "PERP_ETH_USDC", direction: "LONG" }, NOW), null);
  assert.equal(quietLine(null, NOW), null);
  assert.equal(quietLine({ direction: "NONE", reason: "x" }, NOW), null, "no timestamp, no line");
  assert.equal(quietLine(quiet({ reason: "" }), NOW).text, "no signal");
});

test("the text is one line and capped (it is a stored string, shown in two places)", () => {
  const q = quietLine(quiet({ reason: `a\nb\t${"x".repeat(400)}` }), NOW);
  assert.ok(!/[\n\t]/.test(q.text));
  assert.ok(q.text.length <= 240 && q.text.endsWith("…"));
});

test("the agent card and the paper run page both print it", () => {
  const card = readFileSync(new URL("../pages/lab/AgentView.tsx", import.meta.url), "utf8");
  assert.match(card, /quietLine\(agentState\?\.last_signal \?\? null\)/);
  const page = readFileSync(new URL("../pages/proof/PaperRun.tsx", import.meta.url), "utf8");
  assert.match(page, /!run\.open && !run\.complete && run\.quiet/);
});

const W = "0x95e26E980e300C34360933b849457F42c6Bd7622".toLowerCase();
const kv = (map) => ({ get: async (k) => map[k] ?? null });
const req = () => new Request("https://og.nexustradinglabs.com/x");

test("GET /signals/paper-run carries `quiet` only while the wallet is flat", async () => {
  const flat = { started_at: NOW - 86400_000, paper_trades: [], current_position: null };
  const signal = JSON.stringify(quiet({ timestamp: Date.now() - 60_000 }));
  const r = await (await handlePaperRun(["signals", "paper-run", "level_reclaim"], req(), { NEXUS_AGENT: kv({ [`agent:state:${W}`]: JSON.stringify(flat), [`agent:signal:${W}`]: signal }) })).json();
  assert.match(r.quiet.text, /^no signal · 11 of 11 markets/);
  const open = { ...flat, current_position: { symbol: "PERP_ETH_USDC", direction: "LONG", paper: true, opened_at: NOW, entry_price: 1 } };
  const r2 = await (await handlePaperRun(["signals", "paper-run", "level_reclaim"], req(), { NEXUS_AGENT: kv({ [`agent:state:${W}`]: JSON.stringify(open), [`agent:signal:${W}`]: signal }) })).json();
  assert.equal(r2.quiet, null, "in a trade: the open row says what it's doing");
  const r3 = await (await handlePaperRun(["signals", "paper-run", "level_reclaim"], req(), { NEXUS_AGENT: kv({ [`agent:state:${W}`]: JSON.stringify(flat), [`agent:signal:${W}`]: "{bad" }) })).json();
  assert.equal(r3.quiet, null, "an unreadable signal = no line, never a guess");
});
