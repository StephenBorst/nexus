// ── The one way to write a wallet's Lab record ───────────────────────────────────────────────
// Every writer that puts calls into `lab:{address}` (the owner's signed save, the Bankr thesis
// route, the house-call generators) goes through prepareSeal → commit, so a published call is
// rebuilt from the server's registry whoever writes (callLock.mjs). The hourly grader and the
// copy counter only touch server fields on existing calls and write their own way.
import { sealTheses, publishCandidates, REGISTRY_KEY, OWNER_KEY } from "./callLock.mjs";

export const MAX_NEW_PUBLISHES_PER_SAVE = 25;
// Owner-index claims for a wallet's LEGACY public calls, made once when its registry is first
// built. Best-effort and capped: each is a KV read + write, and one request can only make so many.
export const MAX_LEGACY_CLAIMS = 150;

/** Claim `callowner:{id}` for legacy ids no wallet has claimed yet (capped; see above). */
export async function claimLegacyOwners(kv, ids, address) {
  await Promise.all(ids.slice(0, MAX_LEGACY_CLAIMS).map(async (id) => {
    if (!(await kv.get(OWNER_KEY(id)))) await kv.put(OWNER_KEY(id), address);
  }));
}

/**
 * Seal one save. Returns { error } when the save can't be taken, else { sealed, commit }:
 * sealed = sealTheses' result (use sealed.theses as the record's calls); commit(record) writes the
 * registry, the owner index and then the record, in that order (a record never holds a published
 * call its registry doesn't).
 */
export async function prepareSeal(env, address, prevTheses, incomingTheses, nowMs) {
  const kv = env.LAB_STORE;
  const regRaw = await kv.get(REGISTRY_KEY(address));
  const candidates = publishCandidates(incomingTheses, regRaw, prevTheses);
  if (candidates.length > MAX_NEW_PUBLISHES_PER_SAVE) return { error: "too_many_new_publishes" };
  const owners = await Promise.all(candidates.map((id) => kv.get(OWNER_KEY(id))));
  const ownedElsewhere = new Set(candidates.filter((id, i) => owners[i] && owners[i] !== address));
  const sealed = sealTheses({ prev: prevTheses, incoming: incomingTheses, registry: regRaw, now: nowMs, ownedElsewhere });

  async function commit(record) {
    if (sealed.registryChanged) await kv.put(REGISTRY_KEY(address), JSON.stringify(sealed.registry));
    await Promise.all(sealed.newlyPublished.map((t) => kv.put(OWNER_KEY(t.id), address)));
    // Legacy calls claim their id only if no wallet has: the Lab's old shared cache put the same
    // call in several wallets, and which one it belongs to is the double-count fix's call. The
    // claim only stops a THIRD wallet publishing it anew.
    await claimLegacyOwners(kv, sealed.bootstrapped, address);
    await kv.put(`lab:${address}`, JSON.stringify({ ...record, theses: sealed.theses }));
  }
  return { sealed, commit };
}
