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
