// ── The 30-trade paper judgment, run and recorded (rules: app/lib/paperJudge.mjs) ────────────────────────
// borst, 2026-11-13: lock the pass/fail rules before trade 30. Signed page:
// docs/research/paper-judgment-level-reclaim.md.
//
// Hourly at :47 (after the :41 tape check) on lab-api's minute cron. For each judged run it READS the paper
// wallet's state + config (NEXUS_AGENT), its tape checks (LAB_STORE ptape:*), the recorded hourly funding
// (oi:hist) and the graded events (parityEvents.mjs, the same ones GET /agent/:a/parity uses). It writes ONE key,
// `pjudge:{axis}` in LAB_STORE, once, when the verdict is FINAL (PASS / FAIL / RESET): the 30 trades as judged,
// the parity report and the rule numbers. Never rewritten, so the answer outlives exec's 50-row window.
//
// GET /signals/paper-judge/:axis serves the recorded verdict, else the live one (ACCRUING / PENDING / HELD).
import { PAPER_JUDGMENTS, FINAL_VERDICTS, judgePaperRun, judgeWindow, judgmentLine, runRows } from "../../app/lib/paperJudge.mjs";
import { paperParity } from "../../app/lib/paperParity.mjs";
import { readTape } from "./paperTape.mjs";
import { parityEvents } from "./parityEvents.mjs";

export const PJUDGE_KEY = (axis) => `pjudge:${axis}`;

const readJson = async (kv, key) => { try { const r = await kv.get(key); return r ? JSON.parse(r) : null; } catch { return null; } };

export async function readRecordedJudgment(env, axis) {
  return readJson(env.LAB_STORE, PJUDGE_KEY(axis));
}

/** The judgment as of now, from the live inputs (never the recorded copy). */
export async function liveJudgment(env, axis, { nowMs = Date.now(), eventsFor = parityEvents } = {}) {
  const rule = PAPER_JUDGMENTS[axis];
  if (!rule) return null;
  const wallet = rule.wallet.toLowerCase();
  const agentKv = env.NEXUS_AGENT || env.LAB_STORE;
  const state = await readJson(agentKv, `agent:state:${wallet}`);
  const win = judgeWindow(axis, state);
  // Before 30 closed trades the answer is a count: nothing else is read.
  if (!win) return judgePaperRun(axis, { state, nowMs });

  let tape = null;
  try { tape = await readTape(env.LAB_STORE, wallet); } catch { tape = null; }
  const judged = runRows(state).slice(0, rule.trades);
  const oiHistBySymbol = {};
  for (const sym of [...new Set(judged.map((t) => String(t.symbol || "")))].filter((s) => /^PERP_[A-Z0-9]+_USDC$/.test(s))) {
    oiHistBySymbol[sym] = (await readJson(agentKv, `oi:hist:${sym}`)) || [];
  }
  let parity = null;
  if (nowMs >= win.readableAt) {
    const config = await readJson(agentKv, `agent:config:${wallet}`);
    if (config) {
      const events = await eventsFor(agentKv, config, axis);
      const openPosition = state.current_position?.paper ? state.current_position : null;
      parity = paperParity({ trades: state.paper_trades || [], events, config, since: win.since, until: win.parityUntil, openPosition, lastReset: state.last_reset ?? null });
    }
  }
  const j = judgePaperRun(axis, { state, tape, oiHistBySymbol, parity, nowMs });
  return parity ? { ...j, parityReport: { verdict: parity.verdict, window: parity.window, counts: parity.counts, unmatchedTrades: parity.unmatchedTrades, missedUnexplained: parity.missed?.unexplained || [] } } : j;
}

/** The hourly job: record each FINAL verdict once. */
export async function runPaperJudge(env, { nowMs = () => Date.now(), eventsFor = parityEvents } = {}) {
  const out = {};
  for (const axis of Object.keys(PAPER_JUDGMENTS)) {
    const recorded = await readRecordedJudgment(env, axis);
    if (recorded) { out[axis] = { verdict: recorded.verdict, recorded: true }; continue; }
    const j = await liveJudgment(env, axis, { nowMs: nowMs(), eventsFor });
    if (j && FINAL_VERDICTS.includes(j.verdict)) {
      await env.LAB_STORE.put(PJUDGE_KEY(axis), JSON.stringify({ ...j, judgedAt: new Date(nowMs()).toISOString() }));
      out[axis] = { verdict: j.verdict, recorded: true, now: true };
    } else out[axis] = { verdict: j?.verdict ?? null, count: j?.count ?? null };
  }
  return out;
}

const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "Content-Type": "application/json",
    "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
    "Access-Control-Allow-Origin": "*",
  },
});

/** GET /signals/paper-judge/:axis — public, read-only. */
export async function handlePaperJudge(parts, request, env, { nowMs = Date.now(), eventsFor = parityEvents } = {}) {
  if (!(parts[0] === "signals" && parts[1] === "paper-judge" && parts.length === 3)) return null;
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const axis = String(parts[2] || "").slice(0, 64);
  if (!PAPER_JUDGMENTS[axis]) return reply({ ok: false, error: "no_judgment", axis }, 404);
  const recorded = await readRecordedJudgment(env, axis);
  const j = recorded || (await liveJudgment(env, axis, { nowMs, eventsFor }));
  return reply({ ok: true, asOf: new Date(nowMs).toISOString(), recorded: !!recorded, ...j, line: judgmentLine(j) });
}
