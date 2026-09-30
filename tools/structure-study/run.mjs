// ── Structure × house fade: the one-shot replay (report only) ───────────────────────────────────
//   node tools/structure-study/run.mjs --stage 1 [--out structure-report]
//   node tools/structure-study/run.mjs --stage 2 [--out structure-report]   (not before the read date)
//
// Runs from the GitHub Action "Structure study (report only)" (.github/workflows/structure-study.yml);
// cloud sessions can't reach Orderly. It refuses to run if the registration's parameter block and
// study.mjs disagree, or if the frozen stage-1 population file changed. It writes report.json (every
// call, how it was classified) + report.md, and changes nothing anywhere else.
import { readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { classifyAgainstStructure, WEEK_MS, DAY_MS } from "../../app/lib/structure.mjs";
import {
  PREREG, VERDICTS, decideStage1, decideStage2, diagnostics, populationHash, isGradedHouseCall, pickCall, renderMarkdown,
} from "./study.mjs";
import { fetchTape } from "./tape.mjs";

export const DOC = "docs/research/structure-house-fade-prereg.md";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
/** Read a repo-relative path (DOC, PREREG.stage1.file) wherever the runner is started from. */
export const readRepoFile = (p) => readFileSync(join(ROOT, p), "utf8");
const API = "https://og.nexustradinglabs.com";
const iso = (ms) => new Date(ms).toISOString();

/** The ```json block that follows `<!-- prereg-params -->` in the registration. */
export function paramsFromDoc(text) {
  const at = text.indexOf("<!-- prereg-params -->");
  if (at < 0) throw new Error("the registration has no <!-- prereg-params --> block");
  const m = text.slice(at).match(/```json\r?\n([\s\S]*?)\r?\n```/);
  if (!m) throw new Error("the registration's parameter block is not a ```json fence");
  return JSON.parse(m[1]);
}

/** Key-order-independent JSON, for comparing the doc's block with PREREG. */
export function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(",")}]`;
  if (x && typeof x === "object") return `{${Object.keys(x).sort().map((k) => `${JSON.stringify(k)}:${canonical(x[k])}`).join(",")}}`;
  return JSON.stringify(x);
}

async function defaultFetchJson(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  return r.json();
}

function tally(rows) {
  const byReason = {};
  for (const x of rows) if (!x.classified) byReason[x.reason] = (byReason[x.reason] || 0) + 1;
  const unclassified = rows.filter((x) => !x.classified).length;
  return { classified: rows.length - unclassified, unclassified, byReason };
}

// VOID when too many calls sit on markets whose candles failed to load (a transient failure must
// not quietly shrink the sample); otherwise the registered decision on the classified calls.
function judge(rows, decide) {
  const failed = rows.filter((x) => x.reason === "candles_unavailable").length;
  const share = rows.length ? failed / rows.length : 0;
  if (share > PREREG.test.maxFetchFailureShare) {
    return { verdict: VERDICTS.VOID, reasons: [`${failed} of ${rows.length} calls sit on markets whose candles failed to load (> ${PREREG.test.maxFetchFailureShare * 100}%)`] };
  }
  return decide(rows.filter((x) => x.classified));
}

/**
 * Everything but the file writes, injectable for tests.
 * @param {{stage:1|2, now?:number, readText?:(p:string)=>string, fetchJson?:(u:string)=>Promise<any>,
 *          tape?:typeof fetchTape, commit?:string|null, log?:(s:string)=>void}} opts
 */
export async function runStudy({
  stage, now = Date.now(), readText = readRepoFile, fetchJson = defaultFetchJson,
  tape = fetchTape, commit = process.env.GITHUB_SHA || null, log = (s) => console.error(s),
}) {
  if (stage !== 1 && stage !== 2) throw new Error("--stage must be 1 or 2");

  const docText = readText(DOC);
  if (canonical(paramsFromDoc(docText)) !== canonical(PREREG)) {
    throw new Error(`the parameters registered in ${DOC} differ from tools/structure-study/study.mjs: refusing to run`);
  }
  const file = JSON.parse(readText(PREREG.stage1.file));
  const pop1 = file.calls || [];
  const h1 = populationHash(pop1);
  if (pop1.length !== PREREG.stage1.n || h1 !== PREREG.stage1.sha256) {
    throw new Error(`the stage-1 population changed (n ${pop1.length}, sha256 ${h1}): refusing to run`);
  }

  let pop2 = null;
  if (stage === 2) {
    const readAt = PREREG.cutoffMs + PREREG.stage2.readNotBeforeDays * DAY_MS;
    if (now < readAt) throw new Error(`stage 2 reads on or after ${iso(readAt)}; it is ${iso(now)}`);
    const end = PREREG.cutoffMs + PREREG.stage2.windowDays * DAY_MS;
    const rec = await fetchJson(`${API}/lab/${PREREG.population.wallet}`);
    const P = PREREG.population;
    const posted = ((rec && rec.theses) || []).filter((t) =>
      t && t.source === P.source && String(t.id || "").startsWith(P.idPrefix) && !t.duplicateOf &&
      Number(t.createdAt) >= PREREG.cutoffMs && Number(t.createdAt) < end);
    const calls = posted.filter((t) => isGradedHouseCall(t)).map((t) => pickCall(t)).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    pop2 = { calls, posted: posted.length, window: [iso(PREREG.cutoffMs), iso(end)] };
  }

  const allCalls = [...pop1, ...(pop2 ? pop2.calls : [])];
  const tapes = new Map();
  const markets = [];
  for (const symbol of [...new Set(allCalls.map((c) => c.symbol))].sort()) {
    const mine = allCalls.filter((c) => c.symbol === symbol);
    const from = Math.min(...mine.map((c) => c.createdAt)) - PREREG.candles.weeksBefore * WEEK_MS;
    const to = Math.max(...mine.map((c) => c.createdAt));
    const t = await tape(symbol, from, to, { pageDays: PREREG.candles.pageDays });
    tapes.set(symbol, t);
    markets.push({ symbol, orderly: t.orderly, bars: t.bars.length, firstBar: t.bars[0] ? iso(t.bars[0].t) : null, lastBar: t.bars.length ? iso(t.bars[t.bars.length - 1].t) : null, gaps: t.gaps, error: t.error || null });
    log(`[structure-study] ${symbol}: ${t.error ? `FAILED ${t.error}` : `${t.bars.length} bars, ${t.gaps} gaps`}`);
  }

  const classify = (calls) => calls.map((c) => {
    const t = tapes.get(c.symbol);
    const k = t.error
      ? { classified: false, reason: "candles_unavailable" }
      : classifyAgainstStructure({ direction: c.direction, entry: Number(c.entryPrice), asOfMs: Number(c.createdAt) }, t.bars, PREREG.structure);
    return { id: c.id, market: c.symbol, direction: c.direction, createdAt: c.createdAt, outcome: c.gradedOutcome, r: Number(c.gradedR), ...k };
  });

  const rows1 = classify(pop1);
  const stage1 = judge(rows1, (rows) => ({ ...decideStage1(rows), diagnostics: diagnostics(rows) }));
  const populations = { "stage 1": { n: pop1.length, sha256: h1, snapshotAt: file.snapshotAt, ...tally(rows1) } };
  let stage2 = null, rows2 = null;
  if (pop2) {
    rows2 = classify(pop2.calls);
    stage2 = judge(rows2, (rows) => decideStage2(rows, stage1.verdict));
    populations["stage 2"] = { n: pop2.calls.length, posted: pop2.posted, window: pop2.window, sha256: populationHash(pop2.calls), ...tally(rows2) };
  }

  return {
    study: PREREG.id,
    stage,
    registered: PREREG.registered,
    runAt: iso(now),
    commit,
    docSha256: createHash("sha256").update(docText).digest("hex"),
    populations,
    markets,
    stage1,
    stage2,
    calls: { stage1: rows1, ...(rows2 ? { stage2: rows2 } : {}) },
  };
}

async function main() {
  const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
  const stage = Number(arg("--stage") ?? "1");
  const out = arg("--out") || "structure-report";
  const rep = await runStudy({ stage });
  const md = renderMarkdown(rep);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "report.json"), JSON.stringify(rep, null, 1) + "\n");
  writeFileSync(join(out, "report.md"), md + "\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md + "\n");
  console.log(md);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`[structure-study] ${e.message || e}`); process.exit(1); });
}
