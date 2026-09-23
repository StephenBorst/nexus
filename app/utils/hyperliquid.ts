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

export type HLFill = {
  coin: string; px: string; sz: string; side: string; time: number;
  dir: string; closedPnl: string; fee: string; tid?: number | string;
};

export type HLPortfolio = { allTime: number; perpAllTime: number };

// Stop paging here; beyond this the tape is disclosed as partial rather than
// fetched forever (a 100k-fill HFT wallet would take dozens of sequential calls).
export const HL_FILLS_MAX = 10_000;

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

// Full fill history, oldest → newest, via userFillsByTime FORWARD pagination —
// the endpoint returns earliest-first within the window (~2,000 fills/page), so
// we advance startTime past each page's newest fill. Mega-whales (more fills than
// the page budget) fall back to the most recent slice with truncated=true:
// grading the oldest 10k would mislead the other way.
//
// Dedupe is by fill tid, not timestamp: a page boundary can land mid-millisecond
// for HFT wallets, so we advance with startTime = newest (not newest + 1) and
// skip already-seen tids instead of silently dropping boundary fills.
export async function fetchHLFillsPaged(address: string): Promise<{ fills: HLFill[]; truncated: boolean }> {
  const user = address.trim().toLowerCase();
  const now = Date.now();
  const fills: HLFill[] = [];
  const seen = new Set<number | string>();
  let startTime = 0;
  let exhausted = false;
  for (let page = 0; page < 5 && fills.length < HL_FILLS_MAX; page++) {
    const data = (await postInfo({ type: "userFillsByTime", user, startTime, endTime: now })) as HLFill[];
    if (!Array.isArray(data) || data.length === 0) { exhausted = true; break; }
    let newest = startTime;
    for (const f of data) {
      if (f.tid !== undefined && seen.has(f.tid)) continue; // boundary dupe from startTime = newest
      if (f.tid !== undefined) seen.add(f.tid);
      fills.push(f);
      if (f.time > newest) newest = f.time;
    }
    if (newest <= startTime) { exhausted = true; break; } // no progress — never loop forever
    startTime = newest;
  }
  let truncated = false;
  if (!exhausted) {
    // Page budget hit with history still coming — but first probe: a wallet with
    // exactly HL_FILLS_MAX fills ends on a full page, and that IS the full tape.
    // The probe reuses startTime (= newest fetched); genuinely new fills are the
    // ones whose tid we haven't seen.
    const probe = (await postInfo({ type: "userFillsByTime", user, startTime, endTime: now })) as HLFill[];
    const probeOk = Array.isArray(probe);
    const fresh = probeOk ? probe.filter((f) => f.tid === undefined || !seen.has(f.tid)) : [];
    if (!probeOk || fresh.length > 0) {
      // More history is proven (or at least not disproven) to exist — from here
      // on the tape is partial no matter which slice we grade.
      truncated = true;
      // Genuine mega-whale: plain userFills returns the most recent ~2,000 fills.
      const recent = (await postInfo({ type: "userFills", user })) as HLFill[];
      if (Array.isArray(recent) && recent.length > 0) {
        const newestRecent = recent.reduce((m, f) => Math.max(m, f.time), 0);
        // userFills must extend BEYOND what we forward-paged; otherwise it's a
        // stale slice and grading it as "most recent" would mislead.
        if (newestRecent > startTime) return { fills: recent.slice(0, HL_FILLS_MAX), truncated: true };
      }
      // Fallback: grade the oldest 10k we already hold, but STILL flagged partial.
      return { fills: fills.slice(0, HL_FILLS_MAX), truncated: true };
    }
  }
  return { fills: fills.slice(0, HL_FILLS_MAX), truncated };
}
