// ── The owner's Telegram digest + instant alerts: gather, compare, send (rules: app/lib/opsDigest.mjs) ─────────
// Hourly at :49 on lab-api's minute cron. READS: the stored scoreboard (stages), each paper wallet's state + config +
// brain signal (NEXUS_AGENT), its tape checks and recorded judgment (LAB_STORE), the graded events for parity
// (parityEvents.mjs, as GET /agent/:a/parity), signed claims + judgment signatures, and once a day the revenue
// receivers' balances (revenue.mjs readRevenue, the RPCs /ops/revenue uses). WRITES only its own two keys:
// DIGEST_STATE_KEY (what this run saw) and DIGEST_DAY_KEY (the day's digest went out). Sends to the owner's chat
// (OPS_TELEGRAM_CHAT_ID) with TELEGRAM_TOKEN. Trades, signs and moves nothing.
//
// A send that fails leaves the state as it was, so the same alert goes out on the next run, never lost or doubled.
import { readsWithClaims, PAPER_SETUPS } from "../../app/lib/paperClaim.mjs";
import { PAPER_JUDGMENTS } from "../../app/lib/paperJudge.mjs";
import { paperRun } from "../../app/lib/paperRun.mjs";
import { paperParity, axisForConfig, parityWindowStart } from "../../app/lib/paperParity.mjs";
import { quietLine } from "../../app/lib/quietLine.mjs";
import {
  DIGEST_STATE_KEY, DIGEST_DAY_KEY, HELLO_TEXT, pendingItems, digestState, alertsFor, alertText, digestText, digestDue, receiversFrom,
} from "../../app/lib/opsDigest.mjs";
import { readPaperClaims } from "./routes-paperclaim.mjs";
import { readJudgmentSigs } from "./routes-judgesign.mjs";
import { readPlanSigs } from "./routes-plansign.mjs";
import { LIVE_PLAN_TEXT } from "../../app/lib/livePlanText.mjs";
import { parseLiveLift } from "../../app/lib/liveLift.mjs";
import { readTape } from "./paperTape.mjs";
import { parityEvents } from "./parityEvents.mjs";
import { readRecordedJudgment } from "./paperJudge.mjs";
import { readRevenue } from "./revenue.mjs";

const DAY_MS = 86_400_000;
const readJson = async (kv, key) => { try { const r = await kv.get(key); return r ? JSON.parse(r) : null; } catch { return null; } };

/** Everything the digest and the alerts read, from KV. `stages: null` = the board was unreadable. */
export async function gatherFacts(env, { scorecardKey, nowMs = Date.now(), eventsFor = parityEvents, withReceivers = false, revenue = readRevenue } = {}) {
  const agentKv = env.NEXUS_AGENT || env.LAB_STORE;
  let board = null;
  for (const key of [scorecardKey, `${scorecardKey}:lastgood`]) { board = await readJson(env.LAB_STORE, key); if (board?.pipeline?.reads) break; board = null; }
  const stages = board ? Object.fromEntries(board.pipeline.reads.filter((r) => r?.axis && r.stage).map((r) => [r.axis, r.stage])) : null;
  const claims = await readPaperClaims(env);
  const sigs = await readJudgmentSigs(env);
  const planSigs = await readPlanSigs(env);
  const lifts = parseLiveLift(env.GRADED_EXIT_LIVE_LIFT); // empty = disarmed (the house default)
  // After a PASS: the read's live plan (signed or not) and the wallet armed for its mode, if any. Display only.
  const afterVerdict = (axis) => {
    const plan = LIVE_PLAN_TEXT[axis] ? { doc: LIVE_PLAN_TEXT[axis].doc, signed: !!planSigs[axis]?.[LIVE_PLAN_TEXT[axis].sha256] } : null;
    const mode = PAPER_SETUPS[axis]?.config?.signalMode;
    let liftWallet = null;
    for (const [w, modes] of lifts) if (mode && modes.has(mode)) liftWallet = w;
    return { plan, liftWallet };
  };
  const reads = readsWithClaims(claims).map((r) => ({
    axis: r.axis, stage: stages?.[r.axis] ?? null, wallet: r.paperWallet || null, hasSetup: !!PAPER_SETUPS[r.axis],
    // A rules page is owed only for a wallet the pipeline registered (a claim) that the code doesn't judge yet.
    signed: r.paperWallet && claims[r.axis] && !PAPER_JUDGMENTS[r.axis] ? !!sigs[r.axis] : null,
  }));

  const paper = [];
  for (const r of reads.filter((x) => x.wallet)) {
    const w = r.wallet.toLowerCase();
    const [state, config, signal] = await Promise.all([
      readJson(agentKv, `agent:state:${w}`), readJson(agentKv, `agent:config:${w}`), readJson(agentKv, `agent:signal:${w}`),
    ]);
    if (!state) { paper.push({ axis: r.axis, unread: true }); continue; }
    let tape = null;
    try { tape = await readTape(env.LAB_STORE, w); } catch { tape = null; }
    const run = paperRun(r.axis, state, tape, { wallet: r.wallet });
    let parity = null, parityNote = null;
    try {
      const axis = axisForConfig(config);
      if (axis) {
        const [since] = parityWindowStart(state, nowMs);
        const events = await eventsFor(agentKv, config, axis);
        const openPosition = state.current_position?.paper ? state.current_position : null;
        const rep = paperParity({ trades: state.paper_trades || [], events, config, since, until: nowMs, openPosition, lastReset: state.last_reset ?? null });
        parity = rep.verdict || null;
        const c = rep.counts || {};
        if (parity === "DRIFT" || parity === "UNVERIFIABLE") parityNote = `${c.unmatchedTrades ?? 0} paper entr${c.unmatchedTrades === 1 ? "y" : "ies"} with no graded event, ${c.missedUnexplained ?? 0} graded event${c.missedUnexplained === 1 ? "" : "s"} missed unexplained`;
      }
    } catch { parity = null; }
    const recorded = await readRecordedJudgment(env, r.axis).catch(() => null);
    paper.push({
      axis: r.axis, wallet: w, count: run?.count ?? 0, target: run?.target ?? 30,
      closed24h: (run?.trades || []).filter((t) => nowMs - Date.parse(t.closedAt) <= DAY_MS),
      open: run?.open || null, quiet: state.current_position ? null : quietLine(signal, nowMs),
      parity, parityNote, verdict: recorded?.verdict || null,
      ...(recorded?.verdict ? afterVerdict(r.axis) : {}),
    });
  }

  let receivers = null;
  if (withReceivers) { try { receivers = receiversFrom(await revenue({})); } catch { receivers = null; } }
  return { asOf: nowMs, boardAsOf: board?.asOf || null, stages, reads, paper, pending: stages ? pendingItems(reads) : [], receivers };
}

/** Send one message to the owner's chat. Returns true only on Telegram's ok. */
export async function sendOwner(env, text, { fetchImpl = globalThis.fetch } = {}) {
  if (!text || !env.TELEGRAM_TOKEN || !env.OPS_TELEGRAM_CHAT_ID) return false;
  try {
    const r = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: env.OPS_TELEGRAM_CHAT_ID, text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) console.error(`[digest] telegram refused: ${j?.description || r.status}`);
    return !!j?.ok;
  } catch (e) { console.error("[digest] telegram send failed:", String(e?.message || e)); return false; }
}

/** One run: alerts for what changed, and the day's digest when due. */
export async function runOpsDigest(env, { scorecardKey, nowMs = () => Date.now(), fetchImpl = globalThis.fetch, eventsFor, revenue } = {}) {
  const now = nowMs();
  const day = new Date(now).toISOString().slice(0, 10);
  const sentToday = !!(await env.LAB_STORE.get(DIGEST_DAY_KEY(day)).catch(() => null));
  const due = digestDue(now, sentToday);
  const facts = await gatherFacts(env, { scorecardKey, nowMs: now, withReceivers: due, ...(eventsFor ? { eventsFor } : {}), ...(revenue ? { revenue } : {}) });
  const prev = await readJson(env.LAB_STORE, DIGEST_STATE_KEY);
  const alerts = alertsFor(prev, facts);
  const out = { alerts: alerts.length, digest: false, sent: true };
  // The very first run says hello, so a bot that can't reach the chat shows up today; until it lands, no state is
  // stored and the next run tries again.
  if (!prev) out.sent = await sendOwner(env, HELLO_TEXT, { fetchImpl });
  if (alerts.length && out.sent) out.sent = await sendOwner(env, alertText(alerts), { fetchImpl });
  // Remember what this run saw only once its alerts are out (or there were none) and the board was read.
  if (out.sent && facts.stages) await env.LAB_STORE.put(DIGEST_STATE_KEY, JSON.stringify(digestState(facts)));
  if (due) {
    out.digest = await sendOwner(env, digestText(facts), { fetchImpl });
    if (out.digest) await env.LAB_STORE.put(DIGEST_DAY_KEY(day), String(now), { expirationTtl: 3 * 86400 });
  }
  return out;
}

