// Run: node --test workers/nexus-lab-api/labAuthScope.test.mjs
// The Lab signature's message says what it lets the worker do as a wallet (app/lib/labAuth.mjs
// labSaveMessage). It drifted once: the text said "calls, notes and profile" while comments, takes,
// follows and alerts used it too. This test lists every worker file that accepts the signature and
// what each one does with it; a new file, or a use the message doesn't name, fails here.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { labSaveMessage } from "../../app/lib/labAuth.mjs";

const DIR = new URL("./", import.meta.url);
// file → the words in the message that cover what the file does with the signature.
const USES = {
  "shared.mjs": [],                                            // defines checkLabAuth
  "socialAuth.mjs": [],                                        // defines provenWallet (used by the files below)
  "routes-lab.mjs": ["calls", "notes", "profile"],             // Lab record read/save/delete + profile
  "routes-feed.mjs": ["comments", "reactions", "takes"],
  "routes-social.mjs": ["follows", "notifications"],
  "routes-push.mjs": ["phone alerts"],
  "routes-telegram.mjs": ["Telegram link"],
  "routes-revenue.mjs": ["sign in"],                           // the owner revenue page: a read, proof of who is looking
};

test("every worker file that accepts the Lab signature is listed, and the message names its use", () => {
  const files = [...readdirSync(DIR), "index.js"].filter((f) => (f.endsWith(".mjs") && !f.endsWith(".test.mjs")) || f === "index.js");
  const users = new Set(files.filter((f) => /\b(checkLabAuth|provenWallet)\s*\(/.test(readFileSync(new URL(f, DIR), "utf8"))));
  assert.deepEqual([...users].sort(), Object.keys(USES).sort(), "a file started or stopped accepting the Lab signature: update USES and, if it does something new, the message");
  const text = labSaveMessage("0x" + "1".repeat(40), 1);
  for (const [file, words] of Object.entries(USES)) for (const w of words) assert.ok(text.includes(w), `${file}: the message doesn't say "${w}"`);
});
