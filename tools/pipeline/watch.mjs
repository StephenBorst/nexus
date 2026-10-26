#!/usr/bin/env node
// The daily pipeline watcher's one command. Compares the served scoreboard with the recorded stages
// (docs/research/pipeline-stages.json) and prints what changed, as JSON. Rules: app/lib/pipelineWatch.mjs.
//
//   node tools/pipeline/watch.mjs [--from scorecard.json] [--write]
//
//   --from   read a saved GET /intel/axis-backtest instead of fetching it (cloud sessions: Node's fetch
//            ignores HTTPS_PROXY, so curl it to a file first, or run with NODE_USE_ENV_PROXY=1)
//   --write  record the served stages in the snapshot (the watcher PR does this; nothing else does)
//
// Prints { ok, asOf, changed, changes, issues, pr:{title,body} }. Exit 0 whether or not anything
// changed; exit 2 when the scoreboard can't be read (that is never a change).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { stateFromScorecard, diffPipeline, changeReport, SNAPSHOT_PATH } from "../../app/lib/pipelineWatch.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const URL_ = "https://og.nexustradinglabs.com/intel/axis-backtest";
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const fail = (why) => { console.log(JSON.stringify({ ok: false, error: why }, null, 2)); process.exit(2); };

let sc;
try {
  const from = opt("--from");
  sc = from ? JSON.parse(readFileSync(from, "utf8")) : await (await fetch(URL_, { signal: AbortSignal.timeout(60000) })).json();
} catch (e) { fail(`scoreboard unreadable: ${String(e?.message || e).slice(0, 120)}`); }

const cur = stateFromScorecard(sc);
if (!cur) fail("scoreboard has no pipeline block");

const snapFile = resolve(ROOT, SNAPSHOT_PATH);
const snap = JSON.parse(readFileSync(snapFile, "utf8"));
const { changes, issues, next } = diffPipeline(snap, cur);
const pr = changes.length ? changeReport(changes, issues, cur.asOf) : null;

if (flag("--write") && changes.length) {
  writeFileSync(snapFile, JSON.stringify({ note: snap.note, recordedAt: new Date().toISOString(), ...next }, null, 2) + "\n");
}
console.log(JSON.stringify({ ok: true, asOf: cur.asOf, changed: changes.length > 0, changes, issues, pr }, null, 2));
