// ── The kill switch, as exec runs it (POST /agent/:a/kill sets agent:kill:{addr}) ────────────────
// KILL = close the open position, then stop the agent and delete its key. In that order: the key is
// what places the close, so it is deleted only once the account is flat (or once we give up).
//
// Before 2026-11-06 the route deleted the key and dropped the wallet from agent:users itself, so exec
// never saw the flag and couldn't have closed anyway; and this branch read `config` before it was
// defined (a ReferenceError every tick). A killed live position sat open with no stop at all.
//
// A close Orderly doesn't confirm keeps the flag and retries next tick (the cron is 1 min). After
// KILL_MAX_ATTEMPTS the agent stops anyway, the record stays (it may be a real open position) and
// the owner is told to close it by hand. Pure orchestration: every side effect is an injected `io`.

export const KILL_MAX_ATTEMPTS = 10;

/**
 * @param {object} p
 * @param {object} p.state   the agent state (mutated: active, current_position, kill_* fields)
 * @param {object} p.io      { close(): Promise<void>  (closePosition with reason KILLED; clears
 *                             state.current_position only on a confirmed close),
 *                             saveState(state), clearFlag(), clearDirective(), deleteKey(),
 *                             notify(text), sweep?(): Promise<Array<{id, symbol}>>  (retries the
 *                             queued backstop cancels, state.backstop_cleanup, with the key;
 *                             returns what still rests) }
 * @returns {Promise<{ outcome: "DONE" | "RETRY" | "GAVE_UP", attempts: number }>}
 */
export async function runKill({ state, io }) {
  if (state.current_position) {
    try { await io.close(); } catch { /* an error is an unconfirmed close: retried below */ }
    if (state.current_position) {
      const attempts = (Number(state.kill_attempts) || 0) + 1;
      if (attempts < KILL_MAX_ATTEMPTS) {
        state.kill_attempts = attempts;
        await io.saveState(state);
        return { outcome: "RETRY", attempts };
      }
      // Give up: stop trading, keep the record (the position may still be live), tell the owner.
      state.kill_attempts = attempts;
      await sweepStale(state, io);
      await finish(state, io);
      const p = state.current_position;
      const tk = String(p.symbol || "").replace("PERP_", "").replace("_USDC", "");
      const rest = p.backstop?.trigger && !p.backstop.foreign ? ` Its exchange backstop stop is still resting at $${p.backstop.trigger}.` : "";
      await safe(() => io.notify(`⚠️ <b>Kill: couldn't close ${p.direction || ""} ${tk}</b>\nThe agent is stopped and its key removed, but the exchange didn't confirm the close after ${attempts} tries.${rest} Close it yourself on the Trade page.`));
      return { outcome: "GAVE_UP", attempts };
    }
  }
  const attempts = Number(state.kill_attempts) || 0;
  await sweepStale(state, io);
  await finish(state, io);
  return { outcome: "DONE", attempts };
}

// A backstop whose cancel didn't go through sits in state.backstop_cleanup, normally retried before
// the next entry. KILL deletes the key, so there is no next entry: retry now, with the key, and tell
// the owner about any still resting (a position stop left on a flat market closes their next
// position there).
async function sweepStale(state, io) {
  if (typeof io.sweep !== "function" || !(state.backstop_cleanup || []).length) return;
  let left;
  try { left = await io.sweep(); } catch { left = state.backstop_cleanup || []; }
  if (!Array.isArray(left) || !left.length) return;
  const where = [...new Set(left.map((it) => String(it.symbol || "").replace("PERP_", "").replace("_USDC", "")))].join(", ");
  await safe(() => io.notify(`⚠️ <b>Kill: an old backstop stop may still rest on ${where}</b>\nThe agent couldn't cancel it and its key is now removed. Cancel it on the Trade page (TP/SL orders) before you trade ${where} on this account.`));
}

async function finish(state, io) {
  state.active = false;
  state.kill_requested = false;
  delete state.kill_attempts;
  await io.saveState(state);   // first: a crash after this re-runs an idempotent finish next tick
  await io.clearFlag();
  await io.clearDirective();   // a kill cancels any armed directive
  await io.deleteKey();
}

async function safe(fn) { try { await fn(); } catch { /* best-effort */ } }
