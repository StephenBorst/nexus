#!/usr/bin/env node
// The watcher's second command (docs/routines/pipeline-watch.md, step 5): copy lab-api's signed pipeline records
// (paper wallets registered on /ops, judgment pages signed there) into git. Rules: app/lib/pipelineRecordsWrite.mjs.
//
//   node tools/pipeline/records.mjs [--write]
//
// Reads GET /pipeline/paper-wallets and GET /pipeline/judgment/:axis with curl (cloud sessions: Node's fetch ignores
// HTTPS_PROXY). Prints { ok, changed, changes, issues, writes, pr }. --write writes app/lib/pipelineRecords.mjs, the
// judgment pages and public/sitemap.xml. Exit 0 whether or not anything changed; exit 2 when lab-api can't be read.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { recoverMessageAddress } from "viem";
import { PAPER_WALLET_RECORDS, JUDGMENT_RECORDS } from "../../app/lib/pipelineRecords.mjs";
import { PAPER_JUDGMENTS } from "../../app/lib/paperJudge.mjs";
import { nextRecords, recordsModuleSource, recordsReport } from "../../app/lib/pipelineRecordsWrite.mjs";
import { judgmentDocPath } from "../../app/lib/paperJudgePage.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const API = "https://og.nexustradinglabs.com";
const write = process.argv.includes("--write");
const fail = (why) => { console.log(JSON.stringify({ ok: false, error: why }, null, 2)); process.exit(2); };

const curlJson = (url, { allow404 = false } = {}) => {
  const out = execFileSync("curl", ["-s", "-m", "60", "-w", "\n%{http_code}", url], { encoding: "utf8" });
  const cut = out.lastIndexOf("\n");
  const status = Number(out.slice(cut + 1));
  if (allow404 && status === 404) return null;
  if (status !== 200) throw new Error(`${url} answered ${status}`);
  return JSON.parse(out.slice(0, cut));
};

let claims;
try { claims = curlJson(`${API}/pipeline/paper-wallets`).claims; } catch (e) { fail(`paper wallets unreadable: ${String(e?.message || e).slice(0, 160)}`); }
if (!Array.isArray(claims)) fail("paper wallets reply has no claims list");

// The hand-written judgments (the merged PAPER_JUDGMENTS minus what the pipeline recorded).
const coded = Object.fromEntries(Object.entries(PAPER_JUDGMENTS).filter(([a]) => !JUDGMENT_RECORDS[a]));
const drafts = {};
const docs = {};
try {
  for (const c of claims) {
    if (coded[c.axis]) continue;
    drafts[c.axis] = curlJson(`${API}/pipeline/judgment/${encodeURIComponent(c.axis)}`, { allow404: true });
    const path = judgmentDocPath(c.axis);
    docs[path] = existsSync(resolve(ROOT, path)) ? readFileSync(resolve(ROOT, path), "utf8") : null;
  }
} catch (e) { fail(`judgment pages unreadable: ${String(e?.message || e).slice(0, 160)}`); }
for (const k of Object.keys(drafts)) if (!drafts[k]) delete drafts[k];

const out = await nextRecords({
  walletRecords: PAPER_WALLET_RECORDS, judgmentRecords: JUDGMENT_RECORDS, codedJudgments: coded, claims, drafts, docs,
  recover: (message, signature) => recoverMessageAddress({ message, signature }),
  sha256: (t) => createHash("sha256").update(t).digest("hex"),
});
const moduleSrc = recordsModuleSource(out.walletRecords, out.judgmentRecords);
const modulePath = resolve(ROOT, "app/lib/pipelineRecords.mjs");
const moduleChanged = readFileSync(modulePath, "utf8") !== moduleSrc;
const changed = moduleChanged || Object.keys(out.writes).length > 0;

if (write && changed) {
  writeFileSync(modulePath, moduleSrc);
  for (const [p, text] of Object.entries(out.writes)) writeFileSync(resolve(ROOT, p), text);
  // The sitemap lists every paper run page (routeMeta.mjs paperRunPaths): regenerate it in a fresh process,
  // so it reads the records just written.
  execFileSync(process.execPath, ["--input-type=module", "-e",
    `import { sitemapXml } from "./app/lib/routeMeta.mjs"; import { writeFileSync } from "node:fs"; writeFileSync("public/sitemap.xml", sitemapXml());`,
  ], { cwd: ROOT, stdio: "inherit" });
}
console.log(JSON.stringify({
  ok: true, changed, changes: out.changes, issues: out.issues,
  writes: [...(moduleChanged ? ["app/lib/pipelineRecords.mjs", "public/sitemap.xml"] : []), ...Object.keys(out.writes)],
  pr: changed ? recordsReport(out.changes, out.issues) : null,
}, null, 2));
