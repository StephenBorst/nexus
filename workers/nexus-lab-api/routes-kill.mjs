// ── POST /agent/:address/kill — the kill switch, the route half ──────────────────────────────────
// Sets the dedicated agent:kill:{addr} flag and nothing else that exec needs: the KEY and the
// agent:users entry stay, because exec closes the open position WITH that key and only reads wallets
// on that list (nexus-agent-exec/killSwitch.mjs then deletes the key and stops the agent).
// Before 2026-11-06 this route deleted both, so exec never saw the flag and a killed live position
// was left open with nothing managing it. A wallet missing from the list (an earlier kill) is put
// back on it, so a second press reaches exec too.
//
// Call it only after the owner check (requireOwner) passed.
export async function handleAgentKill({ kv, address }) {
  await kv.put(`agent:kill:${address}`, "1");
  let users = [];
  try { users = JSON.parse((await kv.get("agent:users")) || "[]"); } catch { users = []; }
  if (!Array.isArray(users)) users = [];
  if (!users.includes(address)) { users.push(address); await kv.put("agent:users", JSON.stringify(users)); }
  return {
    body: {
      ok: true,
      message: "Kill switch set. Within about a minute the agent closes its open position, stops, and deletes its key.",
    },
  };
}
