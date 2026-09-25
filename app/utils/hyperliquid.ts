// Public Hyperliquid reads for Wallet X-Ray — shared by the /analyze page and
// the xray_wallet agent tool so both grade the SAME record.
//
// Two gotchas this module exists to fix:
//  1. `userFills` with no time window returns a capped, recent-biased slice
//     (~2,000 fills). Grading only that slice mislabels whales — the page calls
//     the number "all-time realized" while grading a partial tape. fetchHLFillsPaged
//     walks userFillsByTime forward from genesis and reports when the tape is still cut.
//  2. Hyperliquid's leaderboard ranks TOTAL PnL. A wallet can show $445M there with
//     $0 of it from perps (vault/spot). fetchHLPortfolio splits allTime vs
//     perpAllTime so an empty perp tape reads as "no perp tape — non-perp record"
//     instead of the misleading "no trading history".

import { mergeFills, tapeStatus, HL_SERVED_MAX } from "@/lib/hlTape.mjs";

export type HLFill = {
  coin: string; px: string; sz: string; side: string; time: number;
  dir: string; closedPnl: string; fee: string; tid?: number | string;
};

export type HLPortfolio = { allTime: number; perpAllTime: number };

// Hyperliquid's serving cap: only a wallet's 10,000 most recent fills are public.
// Holding this many means older history exists that no public endpoint returns.
export const HL_FILLS_MAX = HL_SERVED_MAX;

const HL_INFO = "https://api.hyperliquid.xyz/info";

async function postInfo(body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(HL_INFO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Hyperliquid API ${res.status}`);
  return res.json();
}

// Total vs perp-only lifetime PnL, from the portfolio endpoint's pnlHistory tails.
export async function fetchHLPortfolio(address: string): Promise<HLPortfolio> {
  const data = await postInfo({ type: "portfolio", user: address.trim().toLowerCase() });
  const last = (name: string): number => {
    if (!Array.isArray(data)) return 0;
    const rows = data as Array<[string, { pnlHistory?: Array<[number, string]> }]>;
    const hist = rows.find(([n]) => n === name)?.[1]?.pnlHistory;
    if (!hist || hist.length === 0) return 0;
    return parseFloat(hist[hist.length - 1][1] || "0") || 0;
  };
  return { allTime: last("allTime"), perpAllTime: last("perpAllTime") };
}

// The fill tape, oldest → newest. Hyperliquid serves only a wallet's 10,000 MOST RECENT
// fills — nothing public pages further back (see @/lib/hlTape.mjs). We read all of it:
//  1. userFillsByTime FORWARD from genesis (≤2,000/page, earliest-first inside the
//     served window), advancing startTime to each page's newest fill;
//  2. userFills (the newest ~2,000) — catches fills that landed while we paged.
// Every slice is MERGED (deduped by tid), never swapped: the old code threw away the
// 10k it had paged for the newest ~2k whenever a busy wallet traded mid-read.
// `truncated` = we hold HL's serving cap, so older history exists that we can't read.
//
// Pages advance with startTime = newest (not newest + 1): a boundary can land
// mid-millisecond for HFT wallets; the tid dedupe drops the repeats.
export async function fetchHLFillsPaged(address: string): Promise<{ fills: HLFill[]; truncated: boolean; oldestTs: number | null }> {
  const user = address.trim().toLowerCase();
  const now = Date.now();
  let paged: HLFill[] = [];
  let startTime = 0;
  // 5 pages cover the 10k cap; the slack absorbs fills that arrive during the read.
  for (let page = 0; page < 8; page++) {
    const data = (await postInfo({ type: "userFillsByTime", user, startTime, endTime: now })) as HLFill[];
    if (!Array.isArray(data) || data.length === 0) break;
    const before = paged.length;
    paged = mergeFills(paged, data) as HLFill[];
    const newest = data.reduce((m, f) => Math.max(m, f.time), startTime);
    if (paged.length === before || newest <= startTime) break; // no progress — never loop forever
    startTime = newest;
  }
  // The newest slice rides along even if paging broke early; a failure here is non-fatal.
  let recent: HLFill[] = [];
  try {
    const r = (await postInfo({ type: "userFills", user })) as HLFill[];
    if (Array.isArray(r)) recent = r;
  } catch { /* the paged tape stands */ }
  const all = mergeFills(paged, recent) as HLFill[];
  // Hold at most HL's cap — the newest, since that's the window HL itself serves.
  const fills = all.length > HL_FILLS_MAX ? all.slice(all.length - HL_FILLS_MAX) : all;
  const st = tapeStatus(fills);
  return { fills, truncated: st.truncated, oldestTs: st.oldestTs };
}

// Live open perp positions from `clearinghouseState`, across EVERY perp dex.
// Hyperliquid runs the main dex plus builder-deployed (HIP-3) dexes — equities like
// NVDA/AMD/MSFT live on those ("xyz:INTC"). Each dex is its own clearinghouse, and a
// clearinghouseState call WITHOUT `dex` only returns the main one — that's why the
// panel showed BTC and missed the stocks. So: list the dexes (`perpDexs`), read each.
//
// Everything is what Hyperliquid REPORTS — leverage (+ cross/isolated), entry, uPnL,
// liquidationPx (null when none is reported). Mark = positionValue/|size|, which HL
// computes at the mark price. Nothing is estimated.
export type HLPosition = {
  coin: string; dex: string; side: "LONG" | "SHORT"; size: number; entry: number; mark: number | null;
  valueUsd: number; unrealizedPnl: number; leverage: number | null; leverageType: string | null;
  liquidationPx: number | null;
};

type HLAssetPosition = { position?: {
  coin: string; szi: string; entryPx: string | null; positionValue: string; unrealizedPnl: string;
  liquidationPx: string | null; leverage?: { type?: string; value?: number };
} };

// Bound the fan-out: HL lists a growing set of builder dexes; each is one call.
const MAX_DEXES = 24;

function parsePositions(data: { assetPositions?: HLAssetPosition[] } | null, dex: string): HLPosition[] {
  const num = (s: unknown) => { const n = parseFloat(String(s ?? "")); return Number.isFinite(n) ? n : null; };
  const out: HLPosition[] = [];
  for (const ap of data?.assetPositions ?? []) {
    const p = ap?.position;
    const szi = num(p?.szi);
    if (!p || !szi) continue;
    const value = Math.abs(num(p.positionValue) ?? 0);
    const liq = num(p.liquidationPx);
    // Builder-dex coins normally arrive prefixed ("xyz:INTC"); prefix defensively if not.
    const coin = dex && !p.coin.includes(":") ? `${dex}:${p.coin}` : p.coin;
    out.push({
      coin, dex,
      side: szi > 0 ? "LONG" : "SHORT",
      size: Math.abs(szi),
      entry: num(p.entryPx) ?? 0,
      mark: value > 0 ? value / Math.abs(szi) : null,
      valueUsd: value,
      unrealizedPnl: num(p.unrealizedPnl) ?? 0,
      leverage: num(p.leverage?.value),
      leverageType: p.leverage?.type ?? null,
      liquidationPx: liq && liq > 0 ? liq : null,
    });
  }
  return out;
}

// `failedDexes` names every dex we couldn't read, so a partial panel says so instead
// of passing itself off as the whole book. Throws only if the MAIN dex read fails.
export async function fetchHLPositions(address: string): Promise<{ positions: HLPosition[]; failedDexes: string[] }> {
  const user = address.trim().toLowerCase();
  let dexes: string[] = [];
  let listFailed = false;
  try {
    const list = (await postInfo({ type: "perpDexs" })) as Array<{ name?: string } | null>;
    if (Array.isArray(list)) {
      dexes = list.map((d) => (d && typeof d.name === "string" ? d.name : "")).filter(Boolean).slice(0, MAX_DEXES);
    }
  } catch { listFailed = true; }
  const reads = await Promise.allSettled([
    postInfo({ type: "clearinghouseState", user }),                       // main dex
    ...dexes.map((dex) => postInfo({ type: "clearinghouseState", user, dex })),
  ]);
  if (reads[0].status === "rejected") throw reads[0].reason;
  const positions: HLPosition[] = [];
  const failedDexes: string[] = listFailed ? ["builder dexes (list unavailable)"] : [];
  reads.forEach((r, i) => {
    const dex = i === 0 ? "" : dexes[i - 1];
    if (r.status === "fulfilled") positions.push(...parsePositions(r.value as { assetPositions?: HLAssetPosition[] }, dex));
    else failedDexes.push(dex);
  });
  // A dex can echo main-dex rows; keep one row per coin.
  const seen = new Set<string>();
  const unique = positions.filter((p) => (seen.has(p.coin) ? false : (seen.add(p.coin), true)));
  return { positions: unique.sort((a, b) => b.valueUsd - a.valueUsd), failedDexes };
}
