// ENGINE HEARTBEAT (borst 2026-11-16): a stopped engine caller must read as stopped. Engine A ran out of Bankr
// executions mid-October 2026 and nobody noticed for weeks: its row just sat there. Now every engine row carries its
// last call (`lastPostedAt`, GET /calls/pulse engineRecords), /proof says when one is quiet, and the owner's digest
// alerts the hour one goes quiet (and again when it posts again). Display + alert only: it stops and starts nothing.
//
// QUIET = an engine that has posted before and has posted nothing for ENGINE_QUIET_H. An engine that never posted is
// "not started", never quiet (a first rollout isn't an outage). Pure: no fetch, no KV.

export const ENGINE_QUIET_H = 48;
const H = 3600000;

const ago = (ms) => (ms < 90 * 60000 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 48 * H ? `${Math.round(ms / H)}h` : `${Math.round(ms / (24 * H))}d`);

/** One engine's beat from its pulse row ({ wallet, caller, posted, lastPostedAt }). */
export function engineBeat(row, now = Date.now()) {
  const last = Number(row?.lastPostedAt) || null;
  const ageMs = last ? Math.max(0, now - last) : null;
  return {
    wallet: String(row?.wallet || "").toLowerCase(), caller: row?.caller || null, posted: Number(row?.posted) || 0,
    lastPostedAt: last, ageMs, state: !last ? "NOT_STARTED" : ageMs > ENGINE_QUIET_H * H ? "QUIET" : "POSTING",
  };
}

/** Every engine row's beat. Null when the pulse couldn't be read (never "all quiet"). */
export function engineBeats(engineRecords, now = Date.now()) {
  if (!Array.isArray(engineRecords)) return null;
  return engineRecords.map((r) => engineBeat(r, now));
}

const name = (b) => b.caller || `${b.wallet.slice(0, 6)}…${b.wallet.slice(-4)}`;

/** The digest's lines, one per engine. */
export function enginesLines(beats) {
  if (!beats) return ["Engine calls unread right now."];
  if (!beats.length) return ["No engine wallet has a Lab record yet."];
  return beats.map((b) => b.state === "NOT_STARTED" ? `${name(b)} · no call posted yet`
    : b.state === "QUIET" ? `${name(b)} · QUIET: last call ${ago(b.ageMs)} ago (none in ${ENGINE_QUIET_H}h). Check its automation.`
    : `${name(b)} · last call ${ago(b.ageMs)} ago · ${b.posted} posted`);
}

/** Alerts for engines that went quiet or posted again since the last run. No previous run = no alert (never a burst). */
export function engineAlerts(prevQuiet, beats) {
  if (!beats || !Array.isArray(prevQuiet)) return [];
  const was = new Set(prevQuiet), out = [];
  for (const b of beats) {
    if (b.state === "QUIET" && !was.has(b.wallet)) out.push({ key: `engine:${b.wallet}:QUIET`, text: `${name(b)} has posted no call in ${ENGINE_QUIET_H}h (last ${ago(b.ageMs)} ago). Check its automation: Engine A stopped this way.` });
    if (b.state === "POSTING" && was.has(b.wallet)) out.push({ key: `engine:${b.wallet}:POSTING`, text: `${name(b)} is posting again (last call ${ago(b.ageMs)} ago).` });
  }
  return out;
}

export const quietWallets = (beats) => (beats || []).filter((b) => b.state === "QUIET").map((b) => b.wallet);
