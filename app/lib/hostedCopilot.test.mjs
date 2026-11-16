import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HOSTED_DEFAULT_MODEL, hostedCaps, HOSTED_THINKING_MODELS } from "../../workers/nexus-lab-api/logic.mjs";
import { isThinkingModel } from "./anthropicTurn.mjs";

// The copilot's side of the hosted proxy (app/config/assistant.ts; borst 2026-11-15: current
// lineup, one cap slot per question).
const src = readFileSync(new URL("../config/assistant.ts", import.meta.url), "utf8");

test("client default + lineup match the server", () => {
  assert.match(src, new RegExp(`export const HOSTED_DEFAULT_MODEL = "${HOSTED_DEFAULT_MODEL}";`));
  for (const id of Object.keys(hostedCaps({}))) {
    assert.ok(src.includes(`id: "${id}"`), id);
    assert.equal(isThinkingModel(id), HOSTED_THINKING_MODELS.has(id), `${id}: client and server agree it thinks`);
  }
  for (const gone of ["claude-haiku-4-5", "claude-sonnet-4-6\"", "claude-opus-4-8\",   label", "claude-fable-5-1"]) {
    assert.ok(!src.slice(src.indexOf("export const HOSTED_TIERS"), src.indexOf("export const HOSTED_DEFAULT_MODEL")).includes(gone), gone);
  }
});

test("each question carries one id across its tool rounds", () => {
  const target = src.slice(src.indexOf("function anthropicTarget("), src.indexOf("export interface ChatMsg"));
  assert.match(target, /_q: newQuestionId\(\)/, "the hosted target names the question");
  // one target per run: built before the tool loop in both paths, so every round sends the same _q
  for (const fn of ["async function runAnthropic(", "async function runAnthropicStream("]) {
    const body = src.slice(src.indexOf(fn), src.indexOf("\n}\n", src.indexOf(fn)));
    assert.ok(body.indexOf("anthropicTarget(apiKey, hosted)") < body.indexOf("for (let round = 0"), fn);
  }
});

test("hosted refusals reach the user as the server's sentence, not raw JSON", () => {
  const err = src.slice(src.indexOf("async function errText("));
  assert.match(err, /typeof j\.hint === "string" && j\.hint\) return j\.hint;/);
  assert.match(err, /overloaded_error/);
});

test("system prompt goes up as [stable prompt (cached), live context]", async () => {
  const { systemBlocks, CONTEXT_MARKER } = await import("./anthropicTurn.mjs");
  const out = systemBlocks(`PROMPT\n\n${CONTEXT_MARKER}\nCurrent page: /lab`);
  assert.deepEqual(out, [
    { type: "text", text: "PROMPT", cache_control: { type: "ephemeral" } },
    { type: "text", text: `${CONTEXT_MARKER}\nCurrent page: /lab` },
  ]);
  assert.deepEqual(systemBlocks("ONLY"), [{ type: "text", text: "ONLY", cache_control: { type: "ephemeral" } }]);
  assert.match(src, /const lines: string\[\] = \[CONTEXT_MARKER\];/, "the context block starts with the marker");
  assert.equal(src.split("system: systemBlocks(system),").length - 1, 2, "both Anthropic paths send blocks");
});

test("token readout: a streamed turn's usage, summed across rounds, as one line", async () => {
  const { createStreamAssembler, addUsage, normUsage, usageLine } = await import("./anthropicTurn.mjs");
  const turn = createStreamAssembler();
  turn.push({ type: "message_start", message: { usage: { input_tokens: 400, cache_read_input_tokens: 8000, cache_creation_input_tokens: 0, output_tokens: 1 } } });
  turn.push({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 180 } });
  assert.deepEqual(turn.usage, { input: 400, cacheRead: 8000, cacheWrite: 0, output: 180 });
  const total = addUsage(turn.usage, normUsage({ input_tokens: 200, cache_read_input_tokens: 9000, output_tokens: 60 }));
  assert.equal(usageLine(total), "18k in (97% from cache) · 240 out");
  assert.equal(usageLine(normUsage({ input_tokens: 9500, cache_creation_input_tokens: 0, output_tokens: 90 })), "9.5k in (0% from cache) · 90 out");
  assert.equal(usageLine(null), null);
  assert.equal(usageLine(normUsage({})), null, "nothing reported = no line, never '0 in'");
  // both Anthropic paths return it, and the chat shows it under the answer
  assert.equal(src.split("usage = addUsage(usage,").length - 1, 2);
  const panel = readFileSync(new URL("../components/NexusAssistant.tsx", import.meta.url), "utf8");
  assert.match(panel, /usage: usageLine\(usage\)/);
});
