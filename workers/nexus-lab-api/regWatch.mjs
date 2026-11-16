// On-chain → Lab watchdog (2026-11-16, borst: a call was registered on Arbitrum but never reached the Lab before the
// 6-hour index window closed, and nobody was told). A registration lands in the Lab only when something calls
// indexRegistration: the proxy right after it submits (/proxy/thesis-register), or the caller's own POST /theses/index
// after a raw submit. If neither happens, the call is lost for good once INDEX_MAX_AGE_MS passes.
//
// Every 5 minutes (lab-api's */5 cron) this reads the ThesisRegistry's new logs on a public Arbitrum RPC, and any
// registration still missing from its wallet's Lab record GRACE_MS after it was first seen is indexed here, through
// the same indexRegistration (same proof from the chain, same lock and seal, same follower alerts). The owner gets a
// Telegram line for each one indexed here (it means the publisher's path skipped the index) and for each one that
// can't be indexed (refused, too old, or still unconfirmed after MAX_TRIES runs). Alerts that fail to send are kept
// and retried next run. State: LAB_STORE `onchain:regwatch:v1`. Reads the chain, writes only the calls it proves.

import { registryEvents, THESIS_REGISTRY } from "../../app/lib/registryEvent.mjs";
import { isRangeError } from "./onchainWallets.mjs";

export const REGWATCH_KEY = "onchain:regwatch:v1";
export const GRACE_MS = 5 * 60_000;        // the publisher's own index gets this long first
export const LOOKBACK_BLOCKS = 110_000;    // first run: ~7.5h of Arbitrum (~0.25 s blocks), past the 6h index window
export const CHUNK = 50_000;
export const MIN_CHUNK = 1_000;
export const MAX_CHUNKS = 6;
export const MAX_INDEX_PER_RUN = 5;        // subrequest budget: each index is ~4 RPC reads + KV
export const MAX_TRIES = 12;               // a registration still unconfirmed after ~1h of runs is reported
export const DONE_KEEP = 300;
export const ALERTS_KEEP = 30;
export const SCAN_FAILS_ALERT = 6;         // ~30 min blind = the owner hears once (and again when it reads again)

const hex = (n) => "0x" + Math.max(0, Math.floor(n)).toString(16);
const short = (a) => `${String(a).slice(0, 6)}…${String(a).slice(-4)}`;
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Registrations in a getLogs result: { txHash, wallet, block }, layout-checked like every other reader. */
export function registrationsFromLogs(logs, registry = THESIS_REGISTRY) {
  const out = [];
  for (const l of Array.isArray(logs) ? logs : []) {
    const [ev] = registryEvents([l], registry);
    const tx = String(l?.transactionHash || "").toLowerCase();
    if (!ev || !/^0x[0-9a-f]{64}$/.test(tx)) continue;
    out.push({ txHash: tx, wallet: ev.trader, block: parseInt(l.blockNumber, 16) || null });
  }
  return out;
}

/** What one index answer means for the watchdog. */
export function judgeIndex(res) {
  const s = res?.status, b = res?.body || {};
  if (s === 200 && b.already) return { done: true, alert: null };
  if (s === 200 && b.ok) return { done: true, alert: "indexed" };
  if (s === 202 || s === 503 || s == null) return { done: false, alert: null };   // not mined / unreadable: next run
  return { done: true, alert: "failed" };
}

/** The owner's line for one outcome. */
export function alertLine(kind, { wallet, txHash, body = {}, minutesSeen = null }) {
  const who = `<code>${esc(short(wallet))}</code>`, tx = `tx <code>${esc(short(txHash))}</code>`;
  if (kind === "indexed") {
    const what = [b(body.symbol), b(body.direction)].filter(Boolean).join(" ");
    const late = minutesSeen != null ? `, ${minutesSeen} min after the watchdog first saw it` : "";
    return `Call on-chain but missing from the Lab, indexed now by the watchdog: ${who}${what ? ` ${esc(what)}` : ""} · ${tx}${late}. Graded from now. The publisher's path skipped /theses/index.`;
  }
  if (kind === "unconfirmed") return `Call on-chain still not in the Lab after ${MAX_TRIES} tries (receipt or chain unreadable): ${who} · ${tx}. Check it and POST /theses/index before the 6h window closes.`;
  const why = [body.error, body.reason || body.hint].filter(Boolean).join(": ");
  return `Call on-chain could NOT be added to the Lab: ${who} · ${tx} · ${esc(why || "unknown")}.`;
}
function b(v) { return typeof v === "string" ? v.replace(/^PERP_/, "").replace(/_USDC$/, "") : null; }

/** Scan forward from the stored cursor. Returns the new registrations and the cursor reached. */
export async function scanForward(rpc, state, { registry = THESIS_REGISTRY } = {}) {
  const latest = parseInt(await rpc("eth_blockNumber", []), 16);
  if (!Number.isFinite(latest)) throw new Error("latest block unreadable");
  let scannedTo = Number.isFinite(state?.scannedTo) ? state.scannedTo : Math.max(0, latest - LOOKBACK_BLOCKS);
  let chunk = Number.isFinite(state?.chunk) && state.chunk >= MIN_CHUNK ? state.chunk : CHUNK;
  const found = [];
  let calls = 0, error = null;
  while (calls < MAX_CHUNKS && scannedTo < latest) {
    const from = scannedTo + 1, to = Math.min(latest, from + chunk - 1);
    calls++;
    let logs;
    try { logs = await rpc("eth_getLogs", [{ address: registry, fromBlock: hex(from), toBlock: hex(to) }]); }
    catch (e) {
      const msg = String(e?.message || e);
      if (isRangeError(msg) && chunk > MIN_CHUNK) { chunk = Math.max(MIN_CHUNK, Math.floor(chunk / 2)); continue; }
      error = msg; break;
    }
    if (!Array.isArray(logs)) { error = "eth_getLogs returned no list"; break; }
    found.push(...registrationsFromLogs(logs, registry));
    scannedTo = to;
  }
  return { found, scannedTo, chunk, latest, error };
}

/**
 * One run. deps: logsRpc (public RPC for getLogs), index(txHash, wallet) → indexRegistration's { status, body },
 * send(text) → boolean, now().
 */
export async function runRegWatch(env, { logsRpc, index, send, now = Date.now }) {
  let state;
  try { state = JSON.parse((await env.LAB_STORE.get(REGWATCH_KEY)) || "null"); } catch { state = null; }
  const s = {
    scannedTo: state?.scannedTo, chunk: state?.chunk,
    open: state?.open && typeof state.open === "object" ? { ...state.open } : {},
    done: Array.isArray(state?.done) ? [...state.done] : [],
    alerts: Array.isArray(state?.alerts) ? [...state.alerts] : [],
    scanFails: Number(state?.scanFails) || 0,
  };
  const t = now();
  const doneSet = new Set(s.done);
  let scanError = null, foundN = 0;
  try {
    const r = await scanForward(logsRpc, s);
    s.scannedTo = r.scannedTo; s.chunk = r.chunk; scanError = r.error;
    for (const f of r.found) {
      if (doneSet.has(f.txHash) || s.open[f.txHash]) continue;
      s.open[f.txHash] = { wallet: f.wallet, block: f.block, seenAt: t, tries: 0 };
      foundN++;
    }
  } catch (e) { scanError = String(e?.message || e); }

  // A watchdog that can't read the chain is blind: say so once after ~30 min, and once when it reads again.
  if (scanError) {
    s.scanFails++;
    if (s.scanFails === SCAN_FAILS_ALERT) s.alerts.push(`On-chain → Lab watchdog can't read Arbitrum logs (${SCAN_FAILS_ALERT} runs in a row): ${esc(scanError.slice(0, 160))}. Calls registered meanwhile are checked once it reads again, if still inside the 6h window.`);
  } else {
    if (s.scanFails >= SCAN_FAILS_ALERT) s.alerts.push("On-chain → Lab watchdog reads Arbitrum again.");
    s.scanFails = 0;
  }

  let indexed = 0, attempted = 0;
  const finish = (tx) => { delete s.open[tx]; s.done.push(tx); doneSet.add(tx); };
  for (const [tx, o] of Object.entries(s.open).sort((a, b) => a[1].seenAt - b[1].seenAt)) {
    if (attempted >= MAX_INDEX_PER_RUN) break;
    if (t - o.seenAt < GRACE_MS) continue;
    attempted++;
    let res;
    try { res = await index(tx, o.wallet); } catch (e) { res = { status: 503, body: { error: String(e?.message || e) } }; }
    const j = judgeIndex(res);
    if (j.done) {
      finish(tx);
      if (j.alert === "indexed") { indexed++; s.alerts.push(alertLine("indexed", { wallet: o.wallet, txHash: tx, body: res.body, minutesSeen: Math.round((t - o.seenAt) / 60_000) })); }
      if (j.alert === "failed") s.alerts.push(alertLine("failed", { wallet: o.wallet, txHash: tx, body: res.body }));
    } else if (++o.tries >= MAX_TRIES) {
      finish(tx);
      s.alerts.push(alertLine("unconfirmed", { wallet: o.wallet, txHash: tx }));
    }
  }

  let sent = 0;
  if (s.alerts.length) {
    const ok = await send(s.alerts.join("\n\n"));
    if (ok) { sent = s.alerts.length; s.alerts = []; }
    else s.alerts = s.alerts.slice(-ALERTS_KEEP);   // kept: the next run tries again
  }
  s.done = s.done.slice(-DONE_KEEP);
  await env.LAB_STORE.put(REGWATCH_KEY, JSON.stringify(s));
  return { found: foundN, open: Object.keys(s.open).length, attempted, indexed, sent, held: s.alerts.length, scanError };
}
