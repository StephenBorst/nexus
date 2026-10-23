// ── Nexus Arena routes — the open proving ground for AI trading agents ──
// Any external agent (a Bankr bot, a LangChain script, someone's Claude loop)
// registers with a wallet and drives trades through the webhook rail. PAPER tier
// is zero-capital: fills are simulated by the exec engine at public mark price,
// so the record is graded by US, never self-reported. Graduating to a funded
// account moves the record onto the real Orderly-order ledger (hash-chained ledger).
//
// Registration is walletSig-authed (same personal_sign('nexus-trading-key-v1')
// proof every agent mutation uses) — possession of the sig proves wallet
// ownership, so nobody can squat a roster slot for someone else's address.
// Arena-minted webhook tokens are FREE but scoped to signalMode EXTERNAL (the
// hook route enforces it) so they can't become a ride around the PRO webhook gate.
import { json, normalizeAddress, recoverEthAddress } from "./shared.mjs";
import { validateArenaRegistration, arenaAgentConfig, aggregateAgentTrades, agentScore, agentStanding, ARENA } from "./logic.mjs";
import { verifyPaperLog, paperRoot, paperSeqKey, GENESIS_HEAD } from "../../app/lib/paperLedger.mjs";
import { operatorJoinMessage, operatorOf, groupWallets, planJoin, JOIN_ERRORS } from "../../app/lib/arenaOperator.mjs";
import { withLock, LockBusy, LOCK_KEYS } from "./lock.mjs";

const sigFrom = (message, sig) => {
  try { return typeof sig === "string" ? recoverEthAddress(message, sig) : null; } catch { return null; }
};

// URL-safe random token — same shape as the PRO webhook mint in index.js.
function randToken(bytes = 24) {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// Shrink a trade-row aggregate into the public stat block the roster ships.
function statBlock(rows) {
  if (!rows || !rows.length) return null;
  const agg = aggregateAgentTrades(rows);
  const { winRate, profitFactor, score } = agentScore(agg);
  return {
    trades: agg.trades,
    wins: agg.wins,
    winRate: Math.round(winRate * 1000) / 10,
    netPnl: Math.round(agg.net * 100) / 100,
    profitFactor: Math.round(Math.min(profitFactor, 99) * 100) / 100,
    score,
    daysActive: agg.daysActive,
  };
}

// One wallet's PAPER counters. `paper_trades` is a rolling last-50 window (exec pops
// past 50), so ranking on it lets losing trades roll off. The lifetime aggregate
// `paper_agg` is accrued once per close and never truncated; use it whenever it
// exists. Agents that predate the aggregate fall back to the window, flagged.
function paperTotals(state) {
  const agg = state?.paper_agg;
  if (agg && Number(agg.trades) > 0) {
    return {
      lifetime: true,
      trades: Number(agg.trades),
      wins: Number(agg.wins) || 0,
      grossWin: Number(agg.grossWin) || 0,
      grossLoss: Number(agg.grossLoss) || 0,
      net: Number(agg.net) || 0,
      first: Number(agg.firstTradeAt) || 0,
      last: Number(agg.lastTradeAt) || 0,
    };
  }
  const rows = state?.paper_trades;
  if (!rows || !rows.length) return null;
  const a = aggregateAgentTrades(rows);
  let last = 0;
  for (const r of rows) last = Math.max(last, new Date(r.closed_at).getTime() || 0);
  return { lifetime: false, trades: a.trades, wins: a.wins, grossWin: a.grossWin, grossLoss: a.grossLoss, net: a.net, first: a.firstTradeAt || 0, last };
}

// The PAPER block for one wallet or for an operator's whole group (every wallet
// summed, losers included). A block built partly from 50-trade windows is labelled
// as a window and gets no qualify verdict, so no one reads a slice as the record.
// Resets are counted on each state (`paper_resets`) so a wiped record is visible.
export function combinePaper(states) {
  const list = (states || []).map(paperTotals).filter(Boolean);
  const resets = (states || []).reduce((s, st) => s + (Number(st?.paper_resets) || 0), 0);
  if (!list.length) return null;
  const t = { trades: 0, wins: 0, grossWin: 0, grossLoss: 0, net: 0 };
  let first = 0, last = 0;
  for (const x of list) {
    t.trades += x.trades; t.wins += x.wins; t.grossWin += x.grossWin; t.grossLoss += x.grossLoss; t.net += x.net;
    if (x.first) first = first ? Math.min(first, x.first) : x.first;
    last = Math.max(last, x.last);
  }
  const daysActive = first && last ? Math.max(1, Math.round((last - first) / 86400000)) : 0;
  const a = { ...t, daysActive };
  const { winRate, profitFactor, score } = agentScore(a);
  const stats = {
    trades: t.trades,
    wins: t.wins,
    winRate: Math.round(winRate * 1000) / 10,
    netPnl: Math.round(t.net * 100) / 100,
    profitFactor: Math.round(Math.min(profitFactor, 99) * 100) / 100,
    score,
    daysActive,
    resets,
  };
  if (list.every((x) => x.lifetime)) {
    // Same qualifying rule as the Lab's agent board (AGENT_BOARD), one place.
    return { lifetime: true, ...stats, qualify: agentStanding(a) };
  }
  return { ...stats, lifetime: false, window: list.length > 1 ? "last 50 trades per wallet" : "last 50 trades", qualify: null };
}

export function arenaPaperBlock(state) {
  return combinePaper([state]);
}

// The stored operator map (see app/lib/arenaOperator.mjs). Unreadable = no groups.
async function readOperators(kv) {
  try { return JSON.parse((await kv.get("arena:operators")) || "null") || {}; } catch { return {}; }
}

// Fold an operator's member rows into its own row: ONE slot, every wallet's record
// summed. `rows` = [{ entry, state, liveRows }] per roster wallet. A member whose
// operator has no row (no profile) stays on the board under its own name.
export function foldOperators(rows, groups) {
  const byWallet = new Map(rows.map((r) => [r.entry.wallet, r]));
  const out = [];
  for (const r of rows) {
    const w = r.entry.wallet;
    const op = operatorOf(groups, w);
    if (op && op !== w && byWallet.has(op)) continue; // counted in the operator's slot
    if (op !== w) { out.push(r.entry); continue; }
    const members = groupWallets(groups, op).map((x) => byWallet.get(x)).filter(Boolean);
    const open = members.filter((m) => m.entry.currentPosition);
    out.push({
      ...r.entry,
      currentPosition: open[0]?.entry.currentPosition || null,
      openPositions: open.length,
      paper: combinePaper(members.map((m) => m.state)),
      live: statBlock(members.flatMap((m) => m.liveRows || [])),
      operator: {
        walletCount: members.length,
        members: members.map((m) => ({
          wallet: m.entry.wallet,
          name: m.entry.name,
          paperTrades: m.entry.paper?.trades || 0,
          paperNet: m.entry.paper?.netPnl ?? 0,
          liveTrades: m.entry.live?.trades || 0,
        })),
      },
    });
  }
  return out;
}

export async function handleArena(parts, request, env) {
  if (parts[0] !== "arena") return null;
  const AGENT_KV = env.NEXUS_AGENT || env.LAB_STORE;

  // ── POST /arena/register — open registration for external agents ──────────
  // {name, description?, builder?, config?, walletAddress, walletSig, rotate?}
  if (parts[1] === "register" && !parts[2] && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
    const address = normalizeAddress(String(body.walletAddress || ""));
    if (!/^0x[0-9a-f]{40}$/.test(address)) return json({ error: "walletAddress required" }, request, 400);
    if (!(typeof body.walletSig === "string" && recoverEthAddress("nexus-trading-key-v1", body.walletSig) === address)) {
      return json({ error: "walletSig_required", hint: "walletSig = personal_sign('nexus-trading-key-v1') from the registering wallet." }, request, 401);
    }
    const v = validateArenaRegistration(body);
    if (!v.ok) return json({ error: v.error }, request, 400);

    const profileKey = `arena:profile:${address}`;
    const existingRaw = await AGENT_KV.get(profileKey);
    if (existingRaw && body.rotate !== true) {
      return json({ error: "already_registered", hint: "This wallet already has an Arena agent. Pass rotate:true to update the profile and mint a fresh webhook token (the old one is revoked)." }, request, 409);
    }

    // Registration spam guard. A valid walletSig is cheap to mass-produce (generate
    // wallets), so ownership proof alone doesn't stop roster flooding — rate-limit
    // registrations per IP on top of it. Sliding hourly window via KV TTL.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const rlKey = `arena:rl:${ip}`;
    const rlCount = parseInt((await AGENT_KV.get(rlKey)) || "0", 10);
    if (rlCount >= 5) {
      return json({ error: "rate_limited", hint: "Max 5 Arena registrations per hour per IP. Try again later." }, request, 429);
    }
    await AGENT_KV.put(rlKey, String(rlCount + 1), { expirationTtl: 3600 });

    // Capacity check BEFORE any write. Never evict: shifting the roster would let
    // a flood of junk wallets push legitimate agents (and their records) off the board.
    const rosterRaw = await AGENT_KV.get("arena:roster");
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    if (!roster.includes(address) && roster.length >= ARENA.rosterCap) {
      return json({ error: "arena_full", hint: `The Arena roster is at capacity (${ARENA.rosterCap}).` }, request, 409);
    }

    // Agent config + state — mirrors PUT /agent/:address for PAPER (no key, no
    // funds). signalMode EXTERNAL keeps the house brain silent for this agent.
    const config = arenaAgentConfig(body.config || {});
    await AGENT_KV.put(`agent:config:${address}`, JSON.stringify(config));
    const stateRaw = await AGENT_KV.get(`agent:state:${address}`);
    const state = stateRaw ? JSON.parse(stateRaw) : { active: true, daily_pnl: 0, trades_today: 0, last_reset: Date.now(), current_position: null, last_signal: null };
    state.active = true;
    await AGENT_KV.put(`agent:state:${address}`, JSON.stringify(state));
    const usersRaw = await AGENT_KV.get("agent:users");
    const users = usersRaw ? JSON.parse(usersRaw) : [];
    if (!users.includes(address)) { users.push(address); await AGENT_KV.put("agent:users", JSON.stringify(users)); }

    // Mint the webhook (revoking any previous token for this wallet first).
    const prevMetaRaw = await AGENT_KV.get(`agent:webhook_meta:${address}`);
    if (prevMetaRaw) {
      try {
        const pm = JSON.parse(prevMetaRaw);
        if (pm.token) await AGENT_KV.delete(`agent:webhook:${pm.token}`);
      } catch { /* ignore */ }
    }
    const token = randToken(24);
    const passphrase = randToken(9);
    await AGENT_KV.put(`agent:webhook:${token}`, JSON.stringify({ address, passphrase, enabled: true, arena: true, createdAt: Date.now() }));
    await AGENT_KV.put(`agent:webhook_meta:${address}`, JSON.stringify({ token, passphrase, enabled: true, arena: true, createdAt: Date.now() }));

    let createdAt = Date.now();
    if (existingRaw) { try { createdAt = JSON.parse(existingRaw).createdAt || createdAt; } catch { /* ignore */ } }
    await AGENT_KV.put(profileKey, JSON.stringify({ name: v.name, description: v.description, builder: v.builder, wallet: address, createdAt }));
    if (!roster.includes(address)) {
      roster.push(address);
      await AGENT_KV.put("arena:roster", JSON.stringify(roster));
    }
    // A new/updated agent should show on the board promptly — drop the 30s cache.
    await AGENT_KV.delete("arena:cache:board");

    const base = new URL(request.url).origin;
    return json({
      ok: true,
      wallet: address,
      name: v.name,
      mode: "PAPER",
      signalMode: "EXTERNAL",
      webhook: {
        url: `${base}/agent/hook/${token}`,
        passphrase,
        method: "POST",
        body: { action: "BUY | SELL | CLOSE", symbol: "BTC", passphrase: "<passphrase>" },
      },
      grading: "PAPER fills are simulated by the exec engine at public mark price — never self-reported. Fund the wallet and activate a live mode to move onto the real Orderly-order ledger (hash-chained ledger).",
      note: "SAVE the webhook url + passphrase now — they are never returned again (re-register with rotate:true to mint fresh ones).",
      docs: `${base.includes("nexustradinglabs") ? "https://trade.nexustradinglabs.com" : base}/arena`,
    }, request);
  }

  // ── GET /arena/operator/message?operator=&wallet= — the text both wallets sign ──
  if (parts[1] === "operator" && parts[2] === "message" && !parts[3] && request.method === "GET") {
    const u = new URL(request.url);
    const operator = normalizeAddress(u.searchParams.get("operator") || "");
    const wallet = normalizeAddress(u.searchParams.get("wallet") || "");
    if (!/^0x[0-9a-f]{40}$/.test(operator) || !/^0x[0-9a-f]{40}$/.test(wallet)) {
      return json({ error: "operator and wallet required" }, request, 400);
    }
    return json({ operator, wallet, message: operatorJoinMessage(operator, wallet), sign: "personal_sign, once from each wallet" }, request);
  }

  // ── POST /arena/operator/join — put a wallet in an operator's one board slot ──
  // {operator, wallet, operatorSig, walletSig}: both sign operatorJoinMessage. Permanent.
  if (parts[1] === "operator" && parts[2] === "join" && !parts[3] && request.method === "POST") {
    let body;
    try { body = await request.json(); } catch { return json({ error: "invalid json" }, request, 400); }
    const operator = normalizeAddress(String(body.operator || ""));
    const wallet = normalizeAddress(String(body.wallet || ""));
    if (!/^0x[0-9a-f]{40}$/.test(operator) || !/^0x[0-9a-f]{40}$/.test(wallet)) {
      return json({ error: "bad_address", hint: JOIN_ERRORS.bad_address }, request, 400);
    }
    const message = operatorJoinMessage(operator, wallet);
    if (sigFrom(message, body.operatorSig) !== operator || sigFrom(message, body.walletSig) !== wallet) {
      return json({ error: "signatures_required", hint: "Both wallets sign the text from GET /arena/operator/message.", message }, request, 401);
    }
    const [opProfile, wProfile] = await Promise.all([
      AGENT_KV.get(`arena:profile:${operator}`),
      AGENT_KV.get(`arena:profile:${wallet}`),
    ]);
    if (!opProfile || !wProfile) {
      return json({ error: "not_registered", hint: "Register both wallets in the Arena first." }, request, 404);
    }
    let result;
    try {
      result = await withLock(env, LOCK_KEYS.arenaOperators(), async () => {
        const groups = await readOperators(AGENT_KV);
        const plan = planJoin(groups, operator, wallet);
        if (plan.ok && plan.next) await AGENT_KV.put("arena:operators", JSON.stringify(plan.next));
        return { plan, groups: plan.next || groups };
      });
    } catch (e) {
      if (e instanceof LockBusy) return json({ error: "busy", hint: "Another operator change is in flight. Try again." }, request, 409);
      return json({ error: "lock_unavailable", hint: "Nothing was changed. Try again." }, request, 503);
    }
    const { plan, groups } = result;
    if (!plan.ok) return json({ error: plan.error, hint: JOIN_ERRORS[plan.error] || null }, request, 409);
    await AGENT_KV.delete("arena:cache:board");
    return json({ ok: true, already: plan.already, operator, wallets: groupWallets(groups, operator), permanent: true }, request);
  }

  // ── GET /arena/operators — every declared group (public) ─────────────────────
  if (parts[1] === "operators" && !parts[2] && request.method === "GET") {
    const groups = await readOperators(AGENT_KV);
    const list = Object.keys(groups).map((op) => ({ operator: op, wallets: groupWallets(groups, op), joined: groups[op].joined || {} }));
    return json({ operators: list, count: list.length, rule: "Declared by both wallets' signatures. Permanent. Grouping is never inferred." }, request);
  }

  // ── GET /arena/agents/:address/paper-log — the agent's paper ledger, verified ──
  // Every paper close, in order, each with its chain head. `chainOk` = the rows
  // recompute to the stored head (catches an edited/deleted row). The ANCHORED root
  // (GET /arena/paper/root → Arbitrum) is what stops the whole chain being rewritten.
  if (parts[1] === "agents" && parts[2] && parts[3] === "paper-log" && !parts[4] && request.method === "GET") {
    const address = normalizeAddress(parts[2]);
    const stateRaw = await AGENT_KV.get(`agent:state:${address}`);
    let state = null;
    try { state = stateRaw ? JSON.parse(stateRaw) : null; } catch { /* ignore */ }
    const seqTop = Number(state?.paper_seq) || 0;
    const head = state?.paper_head ?? null;
    if (!seqTop) return json({ wallet: address, count: 0, head: null, chainOk: true, rows: [] }, request);
    if (seqTop > 500) {
      return json({ wallet: address, count: seqTop, head, chainOk: null, reason: "too_long_for_one_read", rows: [] }, request);
    }
    const got = await Promise.all(Array.from({ length: seqTop }, (_, i) =>
      AGENT_KV.get(paperSeqKey(address, i + 1)).then((v) => (v ? JSON.parse(v) : null)).catch(() => null)));
    const entries = got.filter(Boolean);
    const v = await verifyPaperLog(entries);
    const chainOk = v.ok && v.count === seqTop && v.head === head;
    return json({
      wallet: address, count: seqTop, head, chainOk,
      ...(chainOk ? {} : { reason: v.reason || "head_mismatch", atSeq: v.atSeq ?? null }),
      rows: entries.map((e) => ({ seq: e.seq, head: e.head, ...e.row })),
    }, request);
  }

  // ── GET /arena/paper/root — one commitment over every agent's paper head ──────
  // Hourly anchor reads this and commits it on Arbitrum alongside the live ledger.
  if (parts[1] === "paper" && parts[2] === "root" && !parts[3] && request.method === "GET") {
    const rosterRaw = await AGENT_KV.get("arena:roster");
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    const agents = await Promise.all(roster.map(async (addr) => {
      const raw = await AGENT_KV.get(`agent:state:${addr}`);
      let st = null;
      try { st = raw ? JSON.parse(raw) : null; } catch { /* ignore */ }
      return { wallet: addr, head: st?.paper_head ?? null, count: Number(st?.paper_seq) || 0 };
    }));
    const root = await paperRoot(agents);
    // Is the root we computed the one committed on Arbitrum? (written by the hourly anchor)
    // On-chain anchoring is PAUSED for every ledger (ONCHAIN_ANCHOR_LIVE, mirrored in
    // nexus-ledger-anchor/wrangler.toml). While paused, the last commit is shown as what
    // it is: a past root with its record count, never a live proof.
    const anchoring = env.ONCHAIN_ANCHOR_LIVE === "true" ? "live" : "paused";
    let onChain = null;
    try {
      const oc = JSON.parse((await AGENT_KV.get("arena:paper:onchain")) || "null");
      if (oc?.root) {
        const matches = oc.root.toLowerCase() === `0x${root.ledgerHash}`.toLowerCase();
        onChain = {
          ...oc,
          anchoring,
          verified: matches,
          current: matches && anchoring === "live",
          ...(anchoring === "paused" ? {
            note: `Anchoring paused. Last commit covers ${Number(oc.recordCount) || 0} paper record(s); it is not updated while paused.`,
          } : {}),
        };
      }
    } catch { /* no anchor yet */ }
    return json({ ...root, genesis: GENESIS_HEAD, agents: root.count, anchoring, onChain }, request);
  }

  // ── GET /arena/agents — public roster + graded records ─────────────────────
  // Hot public endpoint (board UI polls it, other agents read it) — a 30s KV cache
  // keeps the per-agent KV fan-out + Supabase query off every request.
  if (parts[1] === "agents" && !parts[2] && request.method === "GET") {
    const cacheRaw = await AGENT_KV.get("arena:cache:board");
    if (cacheRaw) {
      try {
        const c = JSON.parse(cacheRaw);
        if (Date.now() - c.ts < 30000) return json(c.payload, request);
      } catch { /* recompute */ }
    }
    const rosterRaw = await AGENT_KV.get("arena:roster");
    const roster = rosterRaw ? JSON.parse(rosterRaw) : [];
    if (!roster.length) return json({ agents: [], count: 0 }, request);

    // One Supabase query for every live record on the roster (not N queries).
    const liveByWallet = new Map();
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        const r = await fetch(
          `${env.SUPABASE_URL}/rest/v1/agent_trades?wallet_address=in.(${roster.join(",")})&order=closed_at.desc&limit=1000`,
          { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
        );
        if (r.ok) {
          for (const row of await r.json()) {
            const w = String(row.wallet_address || "").toLowerCase();
            if (!liveByWallet.has(w)) liveByWallet.set(w, []);
            liveByWallet.get(w).push(row);
          }
        }
      } catch (e) { console.error("[arena] supabase fetch error:", e); }
    }

    const groups = await readOperators(AGENT_KV);
    const rows = (await Promise.all(roster.map(async (w) => {
      const [profileRaw, configRaw, stateRaw] = await Promise.all([
        AGENT_KV.get(`arena:profile:${w}`),
        AGENT_KV.get(`agent:config:${w}`),
        AGENT_KV.get(`agent:state:${w}`),
      ]);
      if (!profileRaw) return null;
      let profile, config = null, state = null;
      try { profile = JSON.parse(profileRaw); } catch { return null; }
      try { config = configRaw ? JSON.parse(configRaw) : null; } catch { /* ignore */ }
      try { state = stateRaw ? JSON.parse(stateRaw) : null; } catch { /* ignore */ }
      const pos = state?.current_position || null;
      const liveRows = liveByWallet.get(w) || [];
      return {
        state,
        liveRows,
        entry: {
          wallet: w,
          name: profile.name,
          description: profile.description || "",
          builder: profile.builder || "",
          createdAt: profile.createdAt || 0,
          active: !!state?.active,
          mode: config?.mode || "PAPER",
          currentPosition: pos ? { symbol: pos.symbol, direction: pos.direction, paper: !!pos.paper } : null,
          paper: arenaPaperBlock(state),
          live: statBlock(liveRows),
        },
      };
    }))).filter(Boolean);
    // One slot per operator: a declared group's wallets are summed into the operator's row.
    const agents = foldOperators(rows, groups);

    // Live records outrank paper; within a tier, engine score decides.
    agents.sort((a, b) =>
      (b.live ? 1 : 0) - (a.live ? 1 : 0) ||
      (b.live?.score ?? 0) - (a.live?.score ?? 0) ||
      (b.paper?.score ?? 0) - (a.paper?.score ?? 0) ||
      b.createdAt - a.createdAt
    );
    const payload = { agents, count: agents.length };
    await AGENT_KV.put("arena:cache:board", JSON.stringify({ ts: Date.now(), payload }), { expirationTtl: 120 });
    return json(payload, request);
  }

  // ── GET /arena/agents/:address — one agent's public detail ─────────────────
  // Profile + risk-config summary + recent graded trades (paper and live) + last
  // activity. Powers the board's expandable rows and per-agent permalinks. Public
  // read; no secrets (webhook token/passphrase never appear here).
  if (parts[1] === "agents" && parts[2] && !parts[3] && request.method === "GET") {
    const address = normalizeAddress(parts[2]);
    const [profileRaw, configRaw, stateRaw] = await Promise.all([
      AGENT_KV.get(`arena:profile:${address}`),
      AGENT_KV.get(`agent:config:${address}`),
      AGENT_KV.get(`agent:state:${address}`),
    ]);
    if (!profileRaw) return json({ error: "not_found" }, request, 404);
    let profile, config = null, state = null;
    try { profile = JSON.parse(profileRaw); } catch { return json({ error: "not_found" }, request, 404); }
    try { config = configRaw ? JSON.parse(configRaw) : null; } catch { /* ignore */ }
    try { state = stateRaw ? JSON.parse(stateRaw) : null; } catch { /* ignore */ }

    let liveRows = [];
    if (env.SUPABASE_URL && env.SUPABASE_ANON_KEY) {
      try {
        const r = await fetch(
          `${env.SUPABASE_URL}/rest/v1/agent_trades?wallet_address=eq.${address}&order=closed_at.desc&limit=20`,
          { headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` } }
        );
        if (r.ok) liveRows = await r.json();
      } catch (e) { console.error("[arena] supabase detail error:", e); }
    }

    const paperRows = (state?.paper_trades || []).slice(0, 20);
    const trimTrade = (t) => ({
      symbol: t.symbol, direction: t.direction, pnl: Number(t.pnl) || 0,
      reason: t.reason || null, opened_at: t.opened_at || null, closed_at: t.closed_at || null,
    });
    const pos = state?.current_position || null;
    const lastCloseMs = (rows) => rows.length ? (new Date(rows[0].closed_at).getTime() || 0) : 0;
    const lastActivity = Math.max(
      lastCloseMs(paperRows), lastCloseMs(liveRows),
      pos?.opened_at ? (new Date(pos.opened_at).getTime() || 0) : 0,
    ) || null;

    const groups = await readOperators(AGENT_KV);
    const op = operatorOf(groups, address);

    return json({
      wallet: address,
      name: profile.name,
      description: profile.description || "",
      builder: profile.builder || "",
      createdAt: profile.createdAt || 0,
      active: !!state?.active,
      mode: config?.mode || "PAPER",
      signalMode: config?.signalMode || null,
      // This wallet's own record below; the board slot is the operator's (every wallet summed).
      operator: op ? { operator: op, wallets: groupWallets(groups, op) } : null,
      currentPosition: pos ? { symbol: pos.symbol, direction: pos.direction, paper: !!pos.paper, entry_price: Number(pos.entry_price) || null, opened_at: pos.opened_at || null } : null,
      riskConfig: config ? {
        leverage: config.leverage, capitalPerTrade: config.capitalPerTrade,
        tpPercent: config.tpPercent, slPercent: config.slPercent,
        maxHoldHours: config.maxHoldHours, maxTradesPerDay: config.maxTradesPerDay,
      } : null,
      paper: { ...(arenaPaperBlock(state) || {}), recent: paperRows.map(trimTrade), resetLog: (state?.paper_reset_log || []).slice(-10) },
      live: { ...(statBlock(liveRows) || {}), recent: liveRows.map(trimTrade) },
      lastActivity,
    }, request);
  }

  return null;
}

// The OG card's data: profile + the PAPER block. null = no graded close yet (the
// route answers 404; a card with no record would look like an empty promise).
export async function loadArenaCard(env, wallet) {
  const w = normalizeAddress(wallet);
  const kv = env.NEXUS_AGENT || env.LAB_STORE;
  const [profileRaw, stateRaw] = await Promise.all([
    kv.get(`arena:profile:${w}`),
    kv.get(`agent:state:${w}`),
  ]);
  if (!profileRaw) return null;
  let profile, state = null;
  try { profile = JSON.parse(profileRaw); } catch { return null; }
  try { state = stateRaw ? JSON.parse(stateRaw) : null; } catch { /* ignore */ }
  const paper = arenaPaperBlock(state);
  if (!paper || !paper.trades) return null;
  // A grouped wallet's card also carries its operator's whole record, so one winning
  // wallet can't be shared as if it were the operator's only one.
  let operator = null;
  const groups = await readOperators(kv);
  const op = operatorOf(groups, w);
  if (op) {
    const wallets = groupWallets(groups, op);
    const states = await Promise.all(wallets.map(async (x) => {
      try { return JSON.parse((await kv.get(`agent:state:${x}`)) || "null"); } catch { return null; }
    }));
    operator = { walletCount: wallets.length, paper: combinePaper(states) };
  }
  return { wallet: w, name: profile.name, builder: profile.builder || "", paper, operator };
}
