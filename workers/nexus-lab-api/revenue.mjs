// ── Revenue at a glance — where Nexus's money sits, for the owner only ─────────────────────────
// Money lands in several places: the subscription receiver (PRO + sim credits), the Bankr wallet
// (x402 data sales, paid in $NEXUS), borst.eth (broker + spot fees) and a NEAR Intents balance owned
// by borst.eth (the cross-chain fee). Sweeps go to the treasury Safe. This reads what each holds,
// prices it, and keeps one snapshot a day so the page can say what changed. It moves nothing.
//
// Everything here is public onchain data; the gate (POST /ops/revenue) only keeps the page from
// advertising it: a wallet-signed request from a Safe owner or an OPS_WALLETS address.
// Pure where it can be; the network is injected (`fetchImpl`). Tested in revenue.test.mjs.

const NEXUS = "0x3D958634ab725B627919EF8F2Ed59227309fDba3";
const USDC_ARB = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const WETH_BASE = "0x4200000000000000000000000000000000000006";
export const TREASURY_SAFE = "0x4Fe2c01bbeFaFFa35706C994646a3F8493B1C733";
const BORST_ETH = "0x34dfc08eb3b7ed60d00e5b2cb611ac27c152b45c";

/** One holding to read: [asset key, chain, token address or null for the native coin]. */
const A = {
  usdcArb: { sym: "USDC", chain: "arb", token: USDC_ARB, decimals: 6, price: "USD" },
  usdcBase: { sym: "USDC", chain: "base", token: USDC_BASE, decimals: 6, price: "USD" },
  nexusBase: { sym: "$NEXUS", chain: "base", token: NEXUS, decimals: 18, price: "NEXUS" },
  wethBase: { sym: "WETH", chain: "base", token: WETH_BASE, decimals: 18, price: "ETH" },
  ethArb: { sym: "ETH", chain: "arb", token: null, decimals: 18, price: "ETH" },
  ethBase: { sym: "ETH", chain: "base", token: null, decimals: 18, price: "ETH" },
};

/** The wallets, what lands in each, and what to read there. */
export const REVENUE_WALLETS = [
  { id: "subs", label: "Subscriptions + sim credits", note: "PRO and sim-credit payments land here.",
    address: "0x06cD9c281E6ab09906B46a10e059F2770EfdE49A", assets: ["usdcArb", "usdcBase", "nexusBase"] },
  { id: "x402", label: "x402 data sales (Bankr wallet)", note: "95% of each paid request, in $NEXUS. Also funds the AI credits.",
    address: "0xd9f7b3273b504e1473c3faba6341299d0ec9b449", assets: ["nexusBase", "usdcBase", "ethBase"] },
  { id: "fees", label: "borst.eth (broker + spot fees)", note: "Spot fees arrive in each trade's output token; only majors are read.",
    address: BORST_ETH, assets: ["usdcArb", "usdcBase", "wethBase", "ethArb", "ethBase", "nexusBase"] },
  { id: "treasury", label: "Treasury Safe", note: "Where sweeps go.",
    address: TREASURY_SAFE, assets: ["usdcArb", "usdcBase", "nexusBase", "ethArb", "ethBase"] },
];

/** The cross-chain fee accrues inside intents.near, owned by borst.eth: one balance per token. */
export const NEAR_INTENTS = {
  id: "near", label: "NEAR Intents (cross-chain fees)", note: "Owned by borst.eth inside intents.near; withdraw in the NEAR Intents app.",
  account: BORST_ETH,
  tokens: [
    { sym: "USDC", chain: "arb", id: "nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near", decimals: 6, price: "USD" },
    { sym: "USDC", chain: "base", id: "nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near", decimals: 6, price: "USD" },
    { sym: "USDC", chain: "eth", id: "nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near", decimals: 6, price: "USD" },
    { sym: "USDC", chain: "sol", id: "nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near", decimals: 6, price: "USD" },
    { sym: "ETH", chain: "arb", id: "nep141:arb.omft.near", decimals: 18, price: "ETH" },
    { sym: "ETH", chain: "base", id: "nep141:base.omft.near", decimals: 18, price: "ETH" },
    { sym: "ETH", chain: "eth", id: "nep141:eth.omft.near", decimals: 18, price: "ETH" },
    { sym: "SOL", chain: "sol", id: "nep141:sol.omft.near", decimals: 9, price: "SOL" },
    { sym: "BTC", chain: "btc", id: "nep141:btc.omft.near", decimals: 8, price: "BTC" },
  ],
};

/** Places this page can't read; it links to them instead. */
export const ELSEWHERE = [
  { label: "Flash fees (Definitive)", where: "app.definitive.fi → Flash Portfolio", url: "https://app.definitive.fi" },
  { label: "Orderly broker fees", where: "Orderly broker dashboard (paid to borst.eth)", url: "https://dex.orderly.network" },
];

export const RPC = {
  base: ["https://base-rpc.publicnode.com", "https://mainnet.base.org", "https://base.llamarpc.com"],
  arb: ["https://arbitrum-one-rpc.publicnode.com", "https://arb1.arbitrum.io/rpc"],
};
const NEAR_RPC = ["https://rpc.mainnet.near.org", "https://near.lava.build"];

// ── decoding ──────────────────────────────────────────────────────────────────────────────────
/** A uint256 hex word → BigInt (0n on anything malformed). */
export function hexToBig(hex) {
  try { return typeof hex === "string" && /^0x[0-9a-fA-F]*$/.test(hex) ? BigInt(hex === "0x" ? "0x0" : hex) : 0n; } catch { return 0n; }
}

/** ABI-decoded `address[]` (the Safe's getOwners()), lowercased; [] on anything malformed. */
export function decodeAddressArray(hex) {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]*$/.test(hex)) return [];
  const body = hex.slice(2);
  const word = (i) => body.slice(i * 64, i * 64 + 64);
  if (body.length < 128) return [];
  const offset = Number(BigInt("0x" + word(0))) / 32;
  const n = Number(BigInt("0x" + word(offset)));
  if (!Number.isInteger(n) || n < 0 || n > 50 || body.length < (offset + 1 + n) * 64) return [];
  const out = [];
  for (let i = 0; i < n; i++) out.push("0x" + word(offset + 1 + i).slice(24).toLowerCase());
  return out;
}

/** A raw integer amount → a decimal number (display only; never used to move money). */
export function toUnits(raw, decimals) {
  const b = typeof raw === "bigint" ? raw : BigInt(raw || 0);
  const scale = 10n ** BigInt(decimals);
  return Number(b / scale) + Number(b % scale) / Number(scale);
}

// ── reading ───────────────────────────────────────────────────────────────────────────────────
async function rpcCall(urls, body, fetchImpl) {
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (j && j.result !== undefined && !j.error) return j.result;
    } catch { /* next */ }
  }
  return undefined;
}

const balanceOfData = (addr) => "0x70a08231" + "0".repeat(24) + addr.slice(2).toLowerCase();

/** One holding's raw balance (BigInt), or null when every RPC failed. */
async function readHolding(asset, address, fetchImpl, rpc) {
  const urls = rpc[asset.chain];
  const result = asset.token
    ? await rpcCall(urls, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: asset.token, data: balanceOfData(address) }, "latest"] }, fetchImpl)
    : await rpcCall(urls, { jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"] }, fetchImpl);
  return typeof result === "string" ? hexToBig(result) : null;
}

/** intents.near balances for the fee account: { [tokenId]: BigInt } or null when NEAR failed. */
export async function readNearIntents(fetchImpl, account = NEAR_INTENTS.account, tokens = NEAR_INTENTS.tokens) {
  const args = JSON.stringify({ account_id: account, token_ids: tokens.map((t) => t.id) });
  const argsB64 = typeof btoa === "function" ? btoa(args) : Buffer.from(args).toString("base64");
  const result = await rpcCall(NEAR_RPC, {
    jsonrpc: "2.0", id: 1, method: "query",
    params: { request_type: "call_function", finality: "final", account_id: "intents.near", method_name: "mt_batch_balance_of", args_base64: argsB64 },
  }, fetchImpl);
  const bytes = result && Array.isArray(result.result) ? result.result : null;
  if (!bytes) return null;
  try {
    const list = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes)));
    if (!Array.isArray(list) || list.length !== tokens.length) return null;
    return Object.fromEntries(tokens.map((t, i) => [t.id, BigInt(String(list[i] || "0"))]));
  } catch { return null; }
}

/** The treasury Safe's owners on Arbitrum (lowercased), [] when unreadable. */
export async function readSafeOwners(fetchImpl, rpc = RPC) {
  const result = await rpcCall(rpc.arb, { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: TREASURY_SAFE, data: "0xa0e67e2b" }, "latest"] }, fetchImpl);
  return decodeAddressArray(result);
}

/** Who may open the page: a Safe owner, or an address in OPS_WALLETS (comma-separated). */
export function isRevenueViewer(address, owners, opsWallets = "") {
  const a = String(address || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(a)) return false;
  const extra = String(opsWallets || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return owners.includes(a) || extra.includes(a);
}

/**
 * Read every wallet and the NEAR balance, price them, and return the page's rows.
 * `prices`: { USD:1, ETH, SOL, BTC, NEXUS } (a missing price leaves usd null, never 0).
 */
export async function readRevenue({ fetchImpl = globalThis.fetch, prices = {}, now = Date.now(), rpc = RPC } = {}) {
  const px = { USD: 1, ...prices };
  const usdOf = (amount, kind) => (Number.isFinite(px[kind]) && px[kind] > 0 ? amount * px[kind] : null);
  const groups = await Promise.all(REVENUE_WALLETS.map(async (w) => {
    const rows = await Promise.all(w.assets.map(async (k) => {
      const a = A[k];
      const raw = await readHolding(a, w.address, fetchImpl, rpc);
      const amount = raw == null ? null : toUnits(raw, a.decimals);
      return { key: `${w.id}:${k}`, sym: a.sym, chain: a.chain, amount, usd: amount == null ? null : usdOf(amount, a.price) };
    }));
    return { id: w.id, label: w.label, note: w.note, address: w.address, rows };
  }));
  const near = await readNearIntents(fetchImpl);
  groups.push({
    id: NEAR_INTENTS.id, label: NEAR_INTENTS.label, note: NEAR_INTENTS.note, address: NEAR_INTENTS.account,
    rows: NEAR_INTENTS.tokens.map((t) => {
      const amount = near ? toUnits(near[t.id] ?? 0n, t.decimals) : null;
      return { key: `near:${t.id}`, sym: t.sym, chain: t.chain, amount, usd: amount == null ? null : usdOf(amount, t.price) };
    }),
  });
  for (const g of groups) {
    g.usd = g.rows.reduce((s, r) => s + (r.usd ?? 0), 0);
    g.unread = g.rows.filter((r) => r.amount == null).length;
  }
  const earning = groups.filter((g) => g.id !== "treasury");
  return {
    at: now, prices: px, groups, elsewhere: ELSEWHERE,
    totals: { notSwept: earning.reduce((s, g) => s + g.usd, 0), treasury: groups.find((g) => g.id === "treasury")?.usd ?? 0 },
  };
}

// ── history (one snapshot a day) ──────────────────────────────────────────────────────────────
export const SNAP_KEY = (day) => `ops:rev:snap:${day}`;
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/** The compact form stored per day: { at, rows: { [key]: amount }, usd: { [groupId]: usd } }. */
export function toSnapshot(rev) {
  const rows = {}, usd = {};
  for (const g of rev.groups) {
    usd[g.id] = g.usd;
    for (const r of g.rows) if (r.amount != null) rows[r.key] = r.amount;
  }
  return { at: rev.at, rows, usd };
}

/** The stored day to compare against for "N days ago": the newest one at or before it, or null. */
export function compareDay(allDays, at, days) {
  const target = dayOf(at - days * 86400e3);
  const keys = allDays.filter((d) => d <= target).sort();
  return keys.length ? keys[keys.length - 1] : null;
}

/**
 * Attach "change since" to each row and group: vs the snapshot `days` ago (the newest one at or
 * before that day). A sweep shows as a drop in the wallet it left and a rise in the Safe.
 */
export function withChanges(rev, snapsByDay, daysList = [7, 30], allDays = Object.keys(snapsByDay)) {
  const refs = Object.fromEntries(daysList.map((d) => {
    const day = compareDay(allDays, rev.at, d);
    return [d, day && snapsByDay[day] ? { day, snap: snapsByDay[day] } : null];
  }));
  for (const g of rev.groups) {
    g.change = {};
    for (const d of daysList) g.change[d] = refs[d] && refs[d].snap.usd?.[g.id] != null ? g.usd - refs[d].snap.usd[g.id] : null;
    for (const r of g.rows) {
      r.change = {};
      for (const d of daysList) {
        const past = refs[d]?.snap.rows?.[r.key];
        r.change[d] = r.amount != null && past != null ? r.amount - past : null;
      }
    }
  }
  const days = [...allDays].sort();
  rev.history = { since: days[0] || null, compareDays: Object.fromEntries(daysList.map((d) => [d, refs[d]?.day || null])) };
  return rev;
}
