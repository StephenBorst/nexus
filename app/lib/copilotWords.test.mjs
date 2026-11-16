import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The copilot never tells the model that something is an edge, proven or guaranteed unless the scoreboard says so
// (2026-11-16 sweep: "+EV edge", "a proven agent", "funding-edge board", "provably RIGHT", "proven strengths").
// Every string the model reads (tool descriptions, tool notes, the system prompt) is checked sentence by sentence.
const read = (f) => readFileSync(new URL(f, import.meta.url), "utf8");
const tools = read("../config/assistantTools.ts");
const asst = read("../config/assistant.ts");
const prompt = asst.slice(asst.indexOf("export const SYSTEM_PROMPT = `"), asst.indexOf("`;", asst.indexOf("export const SYSTEM_PROMPT")));

function strings(src) {
  const out = [];
  // double-quoted strings: every description and note the model reads (template literals here are mostly code)
  const re = /"((?:[^"\\\n]|\\.){24,})"/g;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}
const sentences = [...strings(tools), prompt].flatMap((s) => s.split(/(?<=[.!?])\s+|\n/)).filter(Boolean);

const BANNED = [
  /\bprovabl[ey]\b/i,
  /\+EV\b/,
  /funding-edge/i,
  /\bproven (agent|edge|strateg\w*|caller|strengths?|signal|trader)s?\b/i,
  /\bthe purest\b/i,
  /\bguaranteed?\b(?![^.]*\bnot\b)/i,
];
// "edge" is allowed only where the sentence denies it, ties it to the grade, or means the user's own record.
const EDGE_OK = new RegExp([
  String.raw`\b(not|never|no|isn't|n't|unless|until|only if)\b`, "BEATS_RANDOM", "grade",
  "my_edge", "my edge", "your edge", "their edge", "PERSONALI[SZ]ED EDGE", "edge_note", "edgeGate", "edge-decay", "edgeVsCrowd",
  String.raw`'[^']*\bedge\b[^']*'`,            // the user's own words, quoted as a trigger ('which reads have an edge')
  String.raw`\{[^}]*\bedge\b[^}]*\}`,          // a field name in a shape
].join("|"), "i");

test("no copilot text claims an edge, proof or guarantee the scoreboard hasn't given", () => {
  const hits = [];
  for (const s of sentences) {
    for (const re of BANNED) if (re.test(s)) hits.push(`${re} :: ${s.slice(0, 140)}`);
    if (/\bedge\b/i.test(s) && !EDGE_OK.test(s)) hits.push(`edge :: ${s.slice(0, 140)}`);
  }
  assert.deepEqual(hits, []);
});

test("the guard catches the phrases it was written for", () => {
  const bad = ["the one +EV edge the team found", "Autocopy a proven agent", "Open the funding-edge board", "callers who are provably RIGHT", "to find non-consensus edge."];
  for (const s of bad) {
    const caught = BANNED.some((re) => re.test(s)) || (/\bedge\b/i.test(s) && !EDGE_OK.test(s));
    assert.ok(caught, s);
  }
});
