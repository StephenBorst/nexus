// ── Is the wallet's v2 key still signing for something? (auth v2 step 3b follow-up) ─────────────────
// /v2/key/remove (routes-key.mjs) must not pull the key out from under a live agent position or a
// running TWAP that signs with it through a pointer (agentAuth.mjs v2KeyPointer): Orderly would refuse
// the close, and the position would be left with nothing able to manage it.
// Reads only the pointers and the two states. → null (free to remove) | { error, hint } for a 409.
import { KEY_POINTER_REF } from "./agentAuth.mjs";

const isPointer = (rec) => !!rec && rec.v === 2 && rec.ref === KEY_POINTER_REF;

export async function keyInUse(kv, address) {
  const a = String(address).toLowerCase();
  const read = async (k) => { try { return JSON.parse((await kv.get(k)) || "null"); } catch { return null; } };
  const [agentKey, state, twapKey, twap] = await Promise.all([read(`agent:key:${a}`), read(`agent:state:${a}`), read(`twap:key:${a}`), read(`twap:${a}`)]);
  if (isPointer(agentKey) && state?.current_position && !state.current_position.paper) {
    return { error: "agent_position_open", hint: "The agent holds a live position on this key. Kill the agent (it closes first) or close the position, then remove the key." };
  }
  if (isPointer(twapKey) && twap?.status === "ACTIVE") {
    return { error: "twap_active", hint: "A TWAP is running on this key. Cancel it first, then remove the key." };
  }
  return null;
}
