// ◆ WATCHING — the coins this device watches (☆ in the market drawer), on Lab home under Calls (2026-11-14, borst:
// "watchlist home"). Each row: price, 24h, the move since you last looked, and what changed since then, in the
// alerts' own words (app/lib/watchlist.mjs → marketAlerts.mjs). One request: GET /intel/markets?coins=. Tapping a
// row opens its drawer and marks it seen. Inputs, never a verdict. With nothing watched it's one quiet line.
import { useCallback, useEffect, useState } from "react";
import { C, MONO, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import { watchRow, markSeen, WATCH_EVENT } from "@/lib/watchlist.mjs";
import { readWatch, writeWatch, type WatchState } from "@/lib/watchStore";
import { agoShort } from "@/lib/callPulse.mjs";
import { pressKey } from "@/utils/a11y";

const AGENT_API = "https://og.nexustradinglabs.com";
const REFRESH_MS = 60_000;
type Live = { coin: string; price: number | null; change24hPct: number | null; snap: Record<string, unknown> };
type Row = { coin: string; price: number | null; change24hPct: number | null; sincePct: number | null; sinceAt: number | null; changes: string[]; first: boolean; unread?: boolean };

const fmtPrice = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: n >= 1 ? 2 : 4, maximumFractionDigits: n >= 1 ? 2 : 6 })}`;
const signed = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;

export function WatchlistPanel() {
  const isMobile = useIsMobile();
  const [watch, setWatch] = useState<WatchState>(() => readWatch());
  const [live, setLive] = useState<Record<string, Live>>({});
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const on = () => setWatch(readWatch());
    window.addEventListener(WATCH_EVENT, on);
    window.addEventListener("storage", on);
    return () => { window.removeEventListener(WATCH_EVENT, on); window.removeEventListener("storage", on); };
  }, []);

  const key = watch.coins.join(",");
  useEffect(() => {
    if (!key) { setLive({}); return; }
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`${AGENT_API}/intel/markets?coins=${encodeURIComponent(key)}`);
        const j = r.ok ? await r.json() : null;
        if (!alive) return;
        if (!j?.coins) { setFailed(true); return; }
        setFailed(false);
        const m: Record<string, Live> = {};
        for (const c of j.coins as Live[]) m[c.coin] = c;
        setLive(m);
        // A coin never looked at gets its baseline now ("watching from now"); nothing replays old moves.
        const cur = readWatch();
        let next = cur;
        for (const c of cur.coins) if (!cur.seen[c] && m[c]?.price != null) next = markSeen(next, c, m[c], Date.now()) as WatchState;
        if (next !== cur) writeWatch(next);
      } catch { if (alive) setFailed(true); }
    };
    load();
    const t = setInterval(() => { if (document.visibilityState === "visible") load(); }, REFRESH_MS);
    return () => { alive = false; clearInterval(t); };
  }, [key]);

  const open = useCallback((coin: string) => {
    const l = live[coin];
    if (l) writeWatch(markSeen(readWatch(), coin, l, Date.now()) as WatchState);
    openMarket(coin);
  }, [live]);

  const label = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase" as const, color: C.text.muted };
  const box = { border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt, padding: isMobile ? "12px 14px" : "14px 18px", marginBottom: 8 };

  if (!watch.coins.length) {
    return (
      <section aria-label="Watching" style={{ ...box, display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <span style={label}>Watching</span>
        <span style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, lineHeight: 1.5 }}>Tap any coin name, then ☆ Watch. What changes on it since you last looked shows up here.</span>
      </section>
    );
  }

  const now = Date.now();
  const rows: Row[] = watch.coins.map((c) => watchRow(c, live[c] ?? null, watch.seen[c]) as Row);
  const changed = rows.filter((r) => r.changes.length).length;
  return (
    <section aria-label="Watching" style={box}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span style={label}>Watching</span>
        <span style={{ fontFamily: UI, fontSize: 12, color: C.text.muted }}>{failed ? "Unread right now." : changed ? `${changed} changed since you last looked` : "Nothing changed since you last looked"}</span>
      </div>
      <div style={{ marginTop: 6 }}>
        {rows.map((r) => (
          <div key={r.coin} role="button" tabIndex={0} onClick={() => open(r.coin)} onKeyDown={pressKey(() => open(r.coin))} className="nx-press"
            style={{ padding: "10px 0", borderTop: `1px solid ${C.border}`, cursor: "pointer" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
              <b style={{ fontFamily: UI, fontSize: 14, fontWeight: 700, color: C.text.bright }}>{r.coin}</b>
              {r.price != null && <span style={{ fontFamily: MONO, fontSize: 13, color: C.text.fog }}>{fmtPrice(r.price)}</span>}
              {r.change24hPct != null && <span style={{ fontFamily: MONO, fontSize: 12, color: r.change24hPct >= 0 ? C.pos : C.neg }}>{signed(r.change24hPct)} <span style={{ color: C.text.muted }}>24h</span></span>}
              <span aria-hidden style={{ marginLeft: "auto", color: C.text.faint }}>→</span>
            </div>
            <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.muted, marginTop: 3, lineHeight: 1.5 }}>
              {r.unread ? "Unread right now."
                : r.first ? "Watching from now."
                : <>Since you looked {r.sinceAt ? `${agoShort(r.sinceAt, now)} ago` : ""}{r.sincePct != null && (Math.abs(r.sincePct) < 0.005 ? ": price flat" : <>: price <span style={{ fontFamily: MONO, color: r.sincePct >= 0 ? C.pos : C.neg }}>{signed(r.sincePct)}</span></>)}{r.changes.length ? "" : ". Nothing else changed."}</>}
            </div>
            {r.changes.map((c, i) => (
              <div key={i} style={{ fontFamily: UI, fontSize: 13, color: C.text.bright, marginTop: 3, lineHeight: 1.45 }}>· {c}</div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

export default WatchlistPanel;
