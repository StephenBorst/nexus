// ── One-at-a-time leases for the paid paths (a Durable Object) ─────────────────────────────────
// KV has no compare-and-set: two requests that read the same value at the same instant both act on
// it. On the paid paths that meant one payment tx could be redeemed twice (claim check, then claim),
// one sim credit could buy two paid runs (read, then write), and one thesis registration could be
// sent to Bankr twice from two isolates. A Durable Object instance runs one request at a time, so a
// lease held there is a real lock: NexusLock = one instance per lock key, holding at most one lease.
//
// withLock(env, key, fn) takes the lease, runs fn, gives it back. The lease expires on its own after
// ttlMs, so a request that dies mid-way can't block the key forever. If the lease is held, it retries
// for up to waitMs, then throws LockBusy. A lock that can't be reached throws too: the paid paths
// treat both as "stop before any money moves".
//
// No NEXUS_LOCK binding (tests, local dev) = fn runs unlocked, exactly the old behaviour.

export const LOCK_KEYS = {
  redeem: (txHash) => `redeem:${String(txHash).toLowerCase()}`,
  simCredits: (wallet) => `simcredits:${String(wallet).toLowerCase()}`,
  simCap: (dayKey) => `simcap:${dayKey}`,
  thesisReg: (pendingKey) => `thesisreg:${pendingKey}`,
  // Not a paid path: the Arena operator map is one KV value, and a lost write would silently
  // un-group a wallet (the survivorship hole the groups exist to close).
  arenaOperators: () => "arena:operators",
  // Hosted AI's per-wallet, per-model daily counter (ai:usage:…): our spend. Two calls at once
  // could both read N, both pass the cap, and both write N+1.
  aiUsage: (usageKey) => `aiusage:${usageKey}`,
  // Spot ledger (spotLedger.mjs): one day's totals, and one reported fill (book it once).
  spotDay: (day) => `spotday:${day}`,
  spotFill: (route, id) => `spotfill:${route}:${id}`,
};

const MAX_TTL_MS = 10 * 60 * 1000;

/**
 * The lease rule, pure. `cur` = the stored lease or null.
 * acquire: free, expired, or already ours → take it for ttlMs. Held by someone else → refuse.
 * release: only the owner's release clears it.
 * @returns {{ ok: boolean, next: {owner:string, until:number} | null | undefined }} next=undefined → leave storage as is
 */
export function leaseDecision(cur, op, owner, now, ttlMs) {
  if (op === "acquire") {
    if (cur && cur.until > now && cur.owner !== owner) return { ok: false, until: cur.until, next: undefined };
    const ttl = Math.min(Math.max(Number(ttlMs) || 0, 1000), MAX_TTL_MS);
    return { ok: true, next: { owner, until: now + ttl } };
  }
  if (op === "release") {
    return { ok: true, next: cur && cur.owner === owner ? null : undefined };
  }
  return { ok: false, next: undefined };
}

export class NexusLock {
  constructor(state) { this.storage = state.storage; }

  async fetch(request) {
    const u = new URL(request.url);
    const op = u.pathname.replace(/^\//, "");
    const owner = u.searchParams.get("owner") || "";
    if (!owner || (op !== "acquire" && op !== "release")) return Response.json({ ok: false, error: "bad lock request" }, { status: 400 });
    // Only storage awaits between the read and the write: the object's input gate keeps a second
    // request from running in between, so the read-decide-write is atomic.
    const cur = (await this.storage.get("lease")) || null;
    const d = leaseDecision(cur, op, owner, Date.now(), Number(u.searchParams.get("ttl")));
    if (d.next === null) await this.storage.delete("lease");
    else if (d.next) await this.storage.put("lease", d.next);
    return Response.json({ ok: d.ok, until: d.until ?? null });
  }
}

export class LockBusy extends Error {
  constructor(key) { super(`busy: ${key}`); this.name = "LockBusy"; this.key = key; }
}

/** The lock couldn't be reached or answered badly. Thrown before fn runs, so nothing has happened. */
export class LockError extends Error {
  constructor(msg) { super(msg); this.name = "LockError"; }
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run fn holding the lease on `key`.
 * @param {{ NEXUS_LOCK?: any }} env
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number, waitMs?: number, stepMs?: number, sleep?: (ms:number)=>Promise<void>, clock?: ()=>number }} [o]
 * @returns {Promise<T>}
 * @template T
 */
export async function withLock(env, key, fn, { ttlMs = 30_000, waitMs = 3_000, stepMs = 100, sleep = realSleep, clock = Date.now } = {}) {
  const ns = env && env.NEXUS_LOCK;
  if (!ns) return fn();
  const stub = ns.get(ns.idFromName(key));
  const owner = crypto.randomUUID();
  const call = async (op) => {
    const res = await stub.fetch(`https://lock/${op}?owner=${owner}&ttl=${ttlMs}`);
    const j = await res.json().catch(() => null);
    if (!res.ok || !j) throw new LockError(`lock ${op} failed (${res.status})`);
    return j;
  };
  const deadline = clock() + waitMs;
  for (;;) {
    let got;
    try { got = await call("acquire"); } catch (e) { throw e instanceof LockError ? e : new LockError(String(e?.message || e)); }
    if (got.ok) break;
    if (clock() >= deadline) throw new LockBusy(key);
    await sleep(stepMs);
  }
  try {
    return await fn();
  } finally {
    // The lease runs out on its own; a failed release only delays the next caller until then.
    try { await call("release"); } catch { console.error("[lock] release failed", key); }
  }
}

/** A `lock(key, fn)` for the payGuards helpers, bound to this env. */
export const lockFor = (env, opts) => (key, fn) => withLock(env, key, fn, opts);
