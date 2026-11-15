import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isThinkingModel, requestLimits, textOf, emptyTurnText, createStreamAssembler,
  MAX_TOKENS, THINKING_MAX_TOKENS,
} from "./anthropicTurn.mjs";

test("isThinkingModel: the 5.x line (Haiku 5.5 too), Fable and Mythos think; 4.x doesn't", () => {
  for (const m of ["claude-haiku-5-5", "claude-fable-5-2", "claude-sonnet-5-5", "claude-opus-5-5", "claude-fable-5-1", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-mythos-5-1"])
    assert.equal(isThinkingModel(m), true, m);
  for (const m of ["claude-haiku-4-5", "claude-sonnet-4-6", "claude-opus-4-8", "gpt-5.5", "", undefined])
    assert.equal(isThinkingModel(m), false, String(m));
});

test("requestLimits: thinking models get room to think and low effort; older ones keep 1024", () => {
  assert.deepEqual(requestLimits("claude-opus-5-5"), { max_tokens: THINKING_MAX_TOKENS, output_config: { effort: "low" } });
  assert.deepEqual(requestLimits("claude-sonnet-4-6"), { max_tokens: MAX_TOKENS });
});

test("textOf: reads text by block type, not content[0]", () => {
  const content = [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "text", text: "BTC funding is flat." },
    { type: "text", text: "No edge." },
  ];
  assert.equal(textOf(content), "BTC funding is flat.\nNo edge.");
  assert.equal(textOf(null), "");
});

test("emptyTurnText: refusal and cut-off get their own line", () => {
  assert.match(emptyTurnText("refusal"), /declined/);
  assert.match(emptyTurnText("max_tokens"), /Ran out of room/);
  assert.equal(emptyTurnText("end_turn"), "(empty response)");
});

// A real-shaped stream: thinking (omitted display → empty text + signature), a text preamble,
// then a tool call. The rebuilt turn must carry the thinking block with its signature, which the
// old reader turned into an empty text block.
function stream(events, onText) {
  const a = createStreamAssembler(onText);
  for (const ev of events) a.push(ev);
  return a;
}

test("createStreamAssembler: thinking + signature survive, tool input is parsed, text streams out", () => {
  const seen = [];
  const a = stream([
    { type: "message_start" },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "signature_delta", signature: "EqQBCkgIAR..." } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Checking " } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "BTC." } },
    { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tu_1", name: "get_market", input: {} } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "{\"symbol\":" } },
    { type: "content_block_delta", index: 2, delta: { type: "input_json_delta", partial_json: "\"BTC\"}" } },
    { type: "message_delta", delta: { stop_reason: "tool_use" } },
  ], (t) => seen.push(t));
  assert.equal(a.stopReason, "tool_use");
  assert.deepEqual(a.content(), [
    { type: "thinking", thinking: "", signature: "EqQBCkgIAR..." },
    { type: "text", text: "Checking BTC." },
    { type: "tool_use", id: "tu_1", name: "get_market", input: { symbol: "BTC" } },
  ]);
  assert.deepEqual(seen, ["Checking ", "BTC."]);
});

test("createStreamAssembler: summarized thinking text accumulates; redacted and unknown blocks pass through unchanged", () => {
  const a = stream([
    { type: "content_block_start", index: 0, content_block: { type: "redacted_thinking", data: "ENC" } },
    { type: "content_block_start", index: 1, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "Funding " } },
    { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "is flat." } },
    { type: "content_block_delta", index: 1, delta: { type: "signature_delta", signature: "S" } },
    { type: "content_block_start", index: 2, content_block: { type: "server_tool_use", id: "x", name: "web_search", input: { q: "a" } } },
    { type: "message_delta", delta: { stop_reason: "end_turn" } },
  ]);
  assert.deepEqual(a.content(), [
    { type: "redacted_thinking", data: "ENC" },
    { type: "thinking", thinking: "Funding is flat.", signature: "S" },
    { type: "server_tool_use", id: "x", name: "web_search", input: { q: "a" } },
  ]);
  assert.equal(a.stopReason, "end_turn");
});

test("createStreamAssembler: a refusal with no text reports the refusal", () => {
  const a = stream([{ type: "message_delta", delta: { stop_reason: "refusal" } }]);
  assert.deepEqual(a.content(), []);
  assert.match(emptyTurnText(a.stopReason), /declined/);
});

test("a stream that fails mid-reply surfaces its error instead of an empty turn", async () => {
  const { createStreamAssembler, streamErrorText } = await import("./anthropicTurn.mjs");
  const t = createStreamAssembler(() => {});
  t.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } });
  t.push({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Partial" } });
  t.push({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } });
  assert.deepEqual(t.error, { type: "overloaded_error", message: "Overloaded" });
  assert.match(streamErrorText(t.error), /overloaded right now/);
  assert.match(streamErrorText({ type: "api_error", message: "boom" }), /stopped with an error: boom/);
  assert.equal(streamErrorText(null), null);
  const ok = createStreamAssembler(() => {});
  ok.push({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  assert.equal(ok.error, null);
});

test("trimHistory: the last 20 messages, starting on a user turn", async () => {
  const { trimHistory, HISTORY_MAX_MESSAGES } = await import("./anthropicTurn.mjs");
  const h = Array.from({ length: 31 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) }));
  const t = trimHistory(h);
  assert.ok(t.length <= HISTORY_MAX_MESSAGES);
  assert.equal(t[0].role, "user");
  assert.equal(t[t.length - 1].content, "30", "the newest message is kept");
  assert.deepEqual(trimHistory([{ role: "assistant", content: "x" }]), []);
  assert.deepEqual(trimHistory(null), []);
  assert.equal(trimHistory(h.slice(0, 3)).length, 3);
});

test("the copilot wires them: every run path trims, the stream path throws the error, BYOK caches", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../config/assistant.ts", import.meta.url), "utf8");
  assert.equal((src.match(/trimHistory\(history\)/g) || []).length, 4, "runAnthropic, runAnthropicStream, runOpenAI, runOpenAIStream");
  assert.doesNotMatch(src, /history\.map\(/);
  assert.match(src, /const failed = streamErrorText\(turn\.error\);\n\s*if \(failed\) throw new Error\(failed\);/);
  assert.match(src, /cacheBody: \{ cache_control: \{ type: "ephemeral" \} \}/);
  assert.doesNotMatch(src, /export async function sendChat\(/);
  assert.match(src, /export async function getHostedAccess\(address: string, provider\?: unknown\)/);
  const ui = readFileSync(new URL("../components/NexusAssistant.tsx", import.meta.url), "utf8");
  assert.match(ui, /getHostedAccess\(walletAddress, labWallet\?\.provider\)/);
});
