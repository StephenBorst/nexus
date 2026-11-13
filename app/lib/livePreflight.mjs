// ── Live preflight: is this wallet ready for the $10 mechanics test? ────────────────────────────────────
// borst, 2026-11-13: "$10 live test readiness — a read-only page that confirms safety stop, pause switch, and
// one-wallet permission." The test is the house rules' step 0 (live-money-review.md, signed 2026-11-08): one ~$10
// live entry on the dedicated wallet; the backstop shows on Orderly at 1.5× the stop beyond the entry; KILL closes
// the position and the backstop disappears. It proves the plumbing, not an edge.
//
// Pure: the route (lab-api routes-preflight.mjs) reads the inputs, all of them already public or server-held
// flags (never a key, never a signature), and this turns each into one line with a status:
//   PASS   ready on this point
//   FAIL   not ready: the line says what to do
//   WAIT   not applicable yet (e.g. no live position, so no backstop to see), never a pass
//   INFO   context, not part of readiness
// `ready` = no FAIL among the required points and no WAIT on a point the current step needs.
//
// The backstop line can only show what exec RECORDED (the order id and trigger it placed). Reading the order on
// Orderly takes a key-signed request on the owner's account, which a public page must not make. So the test's
// own step stays: look at Orders → TP/SL on Orderly and see it there. The page says so.

import { parseLiveHalt } from "./liveHalt.mjs";
import { parseLiveLift, livePlanRefusal, LIVE_LIFT_VAR } from "./liveLift.mjs";
import { usesGradedExit } from "./gradedExit.mjs";
import { slippageSummary, slippageLine } from "./slippage.mjs";
import { liveLegs, liveTapeLine, tapeSummary } from "./paperTape.mjs";

export const EXEC_STALE_MS = 3 * 60_000;      // exec ticks every minute; 3 missed = down
export const BACKSTOP_MULT = 1.5;             // nexus-agent-exec/backstop.mjs, pinned by test
export const TRIGGER_TOL = 0.002;             // the recorded trigger may sit a tick past 1.5× (snapped AWAY from the entry)

const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const lc = (a) => String(a || "").toLowerCase();
const coin = (s) => String(s || "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const ago = (ms) => (ms < 90_000 ? `${Math.round(ms / 1000)}s` : ms < 5_400_000 ? `${Math.round(ms / 60_000)} min` : `${Math.round(ms / 3_600_000)}h`);

/** The trigger exec should have placed, unsnapped: 1.5× the stop distance beyond the entry. */
export function expectedBackstop(pos) {
  const e = num(pos?.entry_price), sl = num(pos?.slPercent);
  if (!(e > 0) || !(sl > 0) || (pos.direction !== "LONG" && pos.direction !== "SHORT")) return null;
  const d = (sl * BACKSTOP_MULT) / 100;
  return pos.direction === "LONG" ? e * (1 - d) : e * (1 + d);
}

/** Is a recorded trigger the one exec should place: never tighter than 1.5×, and at most a tick beyond it? */
export function triggerFits(pos, trigger) {
  const want = expectedBackstop(pos), got = num(trigger);
  if (want == null || !(got > 0)) return false;
  const beyond = pos.direction === "LONG" ? (want - got) / want : (got - want) / want;
  return beyond >= -1e-9 && beyond <= TRIGGER_TOL;
}

/**
 * @param {{ wallet: string, config: object|null, state: object|null, haltRaw: string|null, liftVar: string,
 *   killRaw: string|null, hasKey: boolean, heartbeatMs: number|null, tape?: {checks?: object}|null, nowMs?: number }} o
 */
export function preflight({ wallet, config, state, haltRaw, liftVar, killRaw, hasKey, heartbeatMs, tape = null, nowMs = Date.now() }) {
  const checks = [];
  const add = (id, status, line, extra = {}) => checks.push({ id, status, line, ...extra });
  const cfg = config || null;
  const live = !!cfg && cfg.mode && cfg.mode !== "PAPER";

  // 1. exec is running (it opens, manages and closes)
  const age = Number.isFinite(heartbeatMs) ? nowMs - heartbeatMs : null;
  if (age == null) add("exec", "FAIL", "Agent worker heartbeat unread. Check exec’s /health before trading.");
  else if (age > EXEC_STALE_MS) add("exec", "FAIL", `Agent worker last ticked ${ago(age)} ago. It should tick every minute: don’t trade until it does.`, { ageMs: age });
  else add("exec", "PASS", `Agent worker ticked ${ago(age)} ago.`, { ageMs: age });

  // 2. the owner's live-entry pause (ops:halt:live)
  const halt = parseLiveHalt(haltRaw);
  if (halt.on) add("halt", "FAIL", `Live entries are paused platform-wide${halt.reason ? ` (“${halt.reason}”)` : ""}. Switch it off on /ops/revenue for the test, and back on after if you want.`, { since: halt.at ?? null });
  else add("halt", "PASS", "Live-entry pause is off: a live agent may open a position.");

  // 3. no kill pending (a pending kill closes and deletes the key on the next tick)
  if (killRaw) add("kill", "FAIL", "A kill is pending on this wallet: exec will close and remove the key on its next tick.");
  else add("kill", "PASS", "No kill pending. KILL is armed: one tap in the Lab closes the position, then the key is deleted.");

  // 4. the agent itself
  if (!cfg) add("config", "FAIL", "No agent on this wallet. Activate it in the Lab first.");
  else if (!live) add("config", "FAIL", `The agent is on ${cfg.mode || "PAPER"}. The test needs AUTONOMOUS (real orders) on the dedicated wallet.`, { mode: cfg.mode || "PAPER" });
  else add("config", "PASS", `The agent is ${cfg.mode}${cfg.signalMode ? ` · ${cfg.signalMode}` : ""}${Array.isArray(cfg.symbols) ? ` · ${cfg.symbols.length} market${cfg.symbols.length === 1 ? "" : "s"}` : ""}.`, { mode: cfg.mode });
  if (cfg && live) {
    if (hasKey) add("key", "PASS", "A trading key is stored for this wallet (encrypted; it can trade, not withdraw).");
    else add("key", "FAIL", "No trading key stored: the agent can’t place an order.");
  }

  // 5. the one-wallet lift (GRADED_EXIT_LIVE_LIFT). Needed only for a graded-exit config; the $10 test doesn't need it.
  const lifts = parseLiveLift(liftVar);
  const listed = lifts.get(lc(wallet));
  if (cfg && usesGradedExit(cfg) && live) {
    const why = livePlanRefusal(cfg);
    if (!listed?.has(cfg.signalMode)) add("lift", "FAIL", `This config uses the graded exit, which stays paper-only unless the wallet is listed in ${LIVE_LIFT_VAR} (empty = disarmed). Every entry would be refused.`, { listed: false });
    else if (why) add("lift", "FAIL", `Listed for live, but the config isn’t the plan’s: ${why}.`, { listed: true });
    else add("lift", "PASS", "Listed for live, and the config is exactly the live plan’s.", { listed: true });
  } else {
    add("lift", "INFO", listed
      ? `Listed in ${LIVE_LIFT_VAR} for ${[...listed].join(", ")}. Not used by this config (no graded exit).`
      : `${LIVE_LIFT_VAR} doesn’t list this wallet (the plan’s lift is disarmed). Not needed for the $10 test: it only matters for the graded exit.`, { listed: !!listed });
  }

  // 6. the exchange-side backstop on the live position
  const pos = state?.current_position && !state.current_position.paper ? state.current_position : null;
  if (!pos) {
    add("backstop", "WAIT", "No live position yet. After the $10 entry, exec places a reduce-only stop on Orderly at 1.5× the stop beyond the entry: this line turns PASS, then check Orders → TP/SL on Orderly.");
  } else if (pos.dca) {
    add("backstop", "INFO", `${coin(pos.symbol)} ${pos.direction} is a DCA position: it gets no backstop by design (exec’s own stop only). Use a single-entry position for the test.`);
  } else if (!pos.backstop?.id) {
    add("backstop", "FAIL", `${coin(pos.symbol)} ${pos.direction} is open with no backstop recorded. exec retries each tick and Telegrams after 5 tries. Check Orders → TP/SL on Orderly now.`);
  } else if (pos.backstop.foreign) {
    add("backstop", "INFO", `${coin(pos.symbol)} ${pos.direction}: a position stop you set yourself holds Orderly’s one TP/SL slot at ${pos.backstop.trigger}. exec won’t place a second or cancel yours: this isn’t the test’s backstop.`, { trigger: pos.backstop.trigger });
  } else {
    const fits = triggerFits(pos, pos.backstop.trigger);
    const want = expectedBackstop(pos);
    add("backstop", fits ? "PASS" : "FAIL",
      fits
        ? `${coin(pos.symbol)} ${pos.direction} from ${pos.entry_price}: exec placed its backstop at ${pos.backstop.trigger} (1.5× the ${pos.slPercent}% stop). Now see it on Orderly: Orders → TP/SL.`
        : `${coin(pos.symbol)} ${pos.direction}: the recorded backstop ${pos.backstop.trigger} isn’t 1.5× the ${pos.slPercent}% stop (≈ ${Math.round(want * 1e6) / 1e6}). Close by hand and look before going on.`,
      { orderId: String(pos.backstop.id), trigger: pos.backstop.trigger, expected: want == null ? null : Math.round(want * 1e8) / 1e8 });
  }

  // 7. stale backstop cancels (a queued one refuses the next live entry on that market)
  const queued = Array.isArray(state?.backstop_cleanup) ? state.backstop_cleanup : [];
  if (queued.length) add("cleanup", "FAIL", `${queued.length} backstop cancel${queued.length === 1 ? "" : "s"} still queued (${queued.map((q) => coin(q.symbol)).join(", ")}): after a close the backstop must disappear. Cancel it on Orderly if it’s still there.`, { queued: queued.length });
  else add("cleanup", "PASS", "No backstop left behind by a closed position.");
  if (state?.last_backstop_hit) {
    const h = state.last_backstop_hit;
    add("backstop_hit", "INFO", `The exchange stop last closed a position itself: ${coin(h.symbol)} ${h.direction} near ${h.trigger}${Number.isFinite(h.at) ? `, ${ago(nowMs - h.at)} ago` : ""}. That close isn’t on the agent’s ledger.`);
  }

  // 8. the record after the test: live fills on the public tape, and slippage
  const legs = liveLegs(state);
  if (legs.length) {
    const s = tapeSummary(legs, tape?.checks || {});
    if (s.off) add("live_tape", "FAIL", `${liveTapeLine(s)}. A live fill outside what traded: read the fill on Orderly before trusting the record.`, { summary: s });
    else if (s.judged) add("live_tape", "PASS", `${liveTapeLine(s)}.`, { summary: s });
    else add("live_tape", "WAIT", `${legs.length} live fill${legs.length === 1 ? "" : "s"} waiting for the hourly tape check.`, { summary: s });
    const slip = slippageSummary(state?.live_slip);
    const sl = slippageLine(slip);
    if (sl) add("slippage", "INFO", sl, { summary: slip });
  }

  const required = new Set(["exec", "halt", "kill", "config", "key", "lift", "backstop", "cleanup", "live_tape"]);
  const fails = checks.filter((c) => required.has(c.id) && c.status === "FAIL").length;
  const step = !pos ? "ENTRY" : "KILL";
  return {
    ok: true,
    wallet: lc(wallet),
    ready: fails === 0,
    // The next step of the $10 test, from what the record shows.
    step,
    next: fails ? `Fix the ${fails} line${fails === 1 ? "" : "s"} marked FAIL first.`
      : step === "ENTRY" ? "Ready for the $10 entry. Once it fills, reload: the backstop line should read PASS, then check it on Orderly."
      : "Position open with its backstop. Tap KILL in the Lab: the position should close and the backstop disappear (cleanup PASS, no queued cancel).",
    checks,
    note: "Read-only. Every line is read from the agent record, the pause flag and the lift list; nothing here places, moves or cancels an order. The backstop line shows what exec recorded: see the order itself on Orderly (Orders → TP/SL).",
  };
}
