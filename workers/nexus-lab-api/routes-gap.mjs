// ── GET /agent/:address/gap — your paper run of a read vs the read's own reference run (public, read-only) ─────────
// Rule: app/lib/executionGap.mjs. The reference = the read's own paper wallet (code, then a signed claim), else its
// keyless house run, resolved exactly as /signals/paper-run does (paperRun). Reads agent config + state of both
// wallets; writes nothing. A config with no registered read = 400 `no_registered_read`; the reference wallet itself
// = `self: true` (it IS the reference).
import { executionGap, gapLine, GAP_LINE_PAPER } from "../../app/lib/executionGap.mjs";
import { axisForConfig } from "../../app/lib/paperParity.mjs";
import { paperRun } from "../../app/lib/paperRun.mjs";
import { readPaperClaims } from "./routes-paperclaim.mjs";

/** @returns {Promise<{ status: number, body: object }>} */
export async function gapFor(address, env, now = Date.now()) {
  const kv = env.NEXUS_AGENT || env.LAB_STORE;
  const addr = String(address || "").toLowerCase();
  const readJson = async (k) => { try { const raw = await kv.get(k); return raw ? JSON.parse(raw) : null; } catch { return undefined; } };
  const config = await readJson(`agent:config:${addr}`);
  const read = axisForConfig(config || null);
  if (!read || !(config?.mode === "PAPER")) return { status: 400, body: { ok: false, error: "no_registered_read", note: "The gap compares a PAPER run of a registered read with that read's own run." } };
  let claimed = null;
  try { claimed = (await readPaperClaims(env))[read]?.wallet || null; } catch { claimed = null; }
  const probe = paperRun(read, null, null, { wallet: claimed });
  if (!probe) return { status: 404, body: { ok: false, error: "no_reference_run", read } };
  const refWallet = String(probe.wallet).toLowerCase();
  if (refWallet === addr) return { status: 200, body: { ok: true, read, refWallet, self: true } };
  const [state, refState] = await Promise.all([readJson(`agent:state:${addr}`), readJson(`agent:state:${refWallet}`)]);
  const g = executionGap({ read, config, state: state || null, refWallet, refState: refState || null, now });
  return { status: 200, body: { ok: true, ...g, house: probe.house, line: gapLine(g), note: GAP_LINE_PAPER } };
}
