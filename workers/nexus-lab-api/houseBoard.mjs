// Where the house caller gets its board, and how each run reports itself.
//
// Before (found Oct 4): generateHouseCalls read `intel:mispriced:v1`, a cache only page visitors
// keep warm. Cold, it fell back to ONE live all-markets fetch inside the busy hourly cron; that
// failed, and the `{error}` it returned was never logged, so the caller went quiet for days
// without a trace. Now:
//   1. a cached board is used only while it's fresh (≤ HOUSE_BOARD_MAX_AGE_MS): a house call's
//      ENTRY is the board's mark, so an old board would post a price the market left long ago;
//   2. otherwise the caller builds its own board from a live fetch, with a retry when the cron
//      allows one (never in a request path), so it no longer depends on anyone visiting;
//   3. every run, posted or not, produces one plain log line (houseRunSummary).
// Pure + injectable; houseBoard.test.mjs covers it without the network.
export const HOUSE_BOARD_MAX_AGE_MS = 10 * 60 * 1000;

export async function pickHouseBoard({ cachedRaw, now = Date.now(), fetchDetailed, buildBoard, attempts = 1, waitMs = 20000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), maxAgeMs = HOUSE_BOARD_MAX_AGE_MS }) {
  let cacheNote = "cold";
  if (cachedRaw) {
    try {
      const c = JSON.parse(cachedRaw);
      const age = now - Number(c?.asOfMs);
      if (Array.isArray(c?.markets) && Number.isFinite(age) && age >= 0 && age <= maxAgeMs) return { markets: c.markets, source: "cache", ageMs: age };
      cacheNote = Number.isFinite(age) ? `${Math.round(age / 60000)} min old` : "unreadable";
    } catch { cacheNote = "unreadable"; }
  }
  const whys = [];
  for (let i = 0; i < Math.max(1, attempts); i++) {
    if (i > 0) await sleep(waitMs);
    try {
      const { rows, why } = await fetchDetailed();
      if (Array.isArray(rows) && rows.length) return { markets: buildBoard(rows).markets, source: "live", tries: i + 1 };
      whys.push(why || "no rows");
    } catch (e) { whys.push(String(e?.message || e).slice(0, 80)); }
  }
  return { error: `no fresh board (cache ${cacheNote}; live: ${whys.join(" | ")})` };
}

// One line per run for the Worker log + the stored last-run note.
export function houseRunSummary(r) {
  if (!r || typeof r !== "object") return "no post: no result";
  if (Array.isArray(r.posted) && r.posted.length)
    return `posted ${r.posted.length}: ${r.posted.map((p) => `${p.symbol} ${p.direction}`).join(", ")}${r.boardSource ? ` (board: ${r.boardSource})` : ""}`;
  const why = r.error || r.skipped || r.note || "nothing to post";
  return `no post: ${why}${r.boardSource ? ` (board: ${r.boardSource})` : ""}`;
}
