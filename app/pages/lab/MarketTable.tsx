// THE MARKET TABLE (Lab home, under the Wire; borst 2026-11-20, terminal step 4): one row per coin, each input in its own
// column, sortable by any of them. GET /intel/table (lab-api routes-table.mjs, rules app/lib/marketTable.mjs). No
// combined score; the default order is open interest, and a cell past a stated line is marked, never summed. Tapping a
// row opens the coin's drawer. Phone: the coin column stays put while the rest scrolls sideways.
// YOUR COINS FIRST (borst 2026-11-20): coins on this device's watchlist (the drawer's ☆, or the ☆ on a row) stay on top
// whatever the table sorts by; they sort among themselves by the same column, everything else sorts underneath.
import { Fragment, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAccount, usePositionStream } from "@orderly.network/hooks";
import { handOffCall } from "@/lib/callHandoff";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { pressKey } from "@/utils/a11y";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import { boardsAt, boardForColumn } from "@/lib/intelLenses.mjs";
import {
  TABLE_COLUMNS, DEFAULT_SORT, nextSort, usdShort, fundingCell, oiVolCell, gapCell, smartCell, forecastCell,
  newsCell, readsCell, yourCoinsFirst, yourMarks, openCallCoins, sinceLook, sinceLookCell,
} from "@/lib/marketTable.mjs";
import { readWatch, toggleWatchCoin } from "@/lib/watchStore";
import { WATCH_EVENT, WATCH_MAX } from "@/lib/watchlist.mjs";
import { wireWhen } from "@/lib/wire.mjs";
import { readLastCopy, writeLastCopy } from "@/lib/lastCopy.mjs";

const TABLE_URL = "https://og.nexustradinglabs.com/intel/table";
const LAST_KEY = "nx_table_last_v1"; // the last table this device read: drawn at once on the next visit, with its own age
const tableOk = (b: { rows?: unknown[] }) => Array.isArray(b?.rows) && b.rows.length > 0;
const REFRESH_MS = 60_000;
const FIRST = 15;
const UNREAD_WORDS: Record<string, string> = { markets: "Orderly markets", venues: "other venues' funding", smart: "smart money", forecasts: "forecasts", news: "news", reads: "paper runs" };

type Row = {
  coin: string; price: number; change24hPct: number | null; oiUsd: number; volUsd: number | null;
  funding8hPct: number | null; fundingPast: "LONGS" | "SHORTS" | null; oiVol: number | null; oiVolPast: boolean;
  gap: number | null; smart: { long: number; short: number; side: string } | null;
  forecast: { divergent: number; total: number } | null; news: number | null; reads: Array<{ axis: string; side: string }> | null;
  pinned?: boolean; thin?: boolean;
};
type Table = { rows: Row[]; others?: Row[]; leftOut: number; unread: string[]; builtAt: number };

const price = (p: number) => (p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(3));

export function MarketTable({ onOpenBoard }: { onOpenBoard?: (id: string) => void }) {
  const isMobile = useIsMobile();
  const [table, setTable] = useState<Table | null>(() => readLastCopy(LAST_KEY, { valid: tableOk }) as Table | null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<{ col: string; dir: string }>({ ...DEFAULT_SORT });
  const [all, setAll] = useState(false);
  const [help, setHelp] = useState(false);
  const [watched, setWatched] = useState<string[]>(() => readWatch().coins);
  // the Watching panel's baselines (price + time of your last look), READ only here: the table never moves them
  const [seen, setSeen] = useState<Record<string, { price?: number; at?: number }>>(() => readWatch().seen as Record<string, { price?: number; at?: number }>);
  const [full, setFull] = useState(false);
  // Table → call (2026-11-21): "Call" on a row asks the side right under it; the trader picks, never the table.
  const [callFor, setCallFor] = useState<string | null>(null);
  const navigate = useNavigate();
  // Activity dots on your coins (2026-11-21): YOUR open public call (the Spot chips' source) and YOUR open Orderly position.
  const { state: acct } = useAccount();
  const wallet = (acct as { address?: string })?.address ?? null;
  const [{ rows: positionRows }] = usePositionStream();
  const [openCalls, setOpenCalls] = useState<Set<string> | null>(null);
  useEffect(() => {
    if (!wallet) { setOpenCalls(null); return; }
    let alive = true;
    sharedJson(`https://og.nexustradinglabs.com/theses/status/${encodeURIComponent(wallet)}`)
      .then((j) => { if (alive) setOpenCalls(openCallCoins(j) as Set<string> | null); })
      .catch(() => { if (alive) setOpenCalls(null); });
    return () => { alive = false; };
  }, [wallet]);
  const marks = useMemo(() => yourMarks(watched, { openCalls, positions: (positionRows ?? null) as Array<{ symbol: string; position_qty?: number }> | null }) as Record<string, { call: boolean; position: boolean }>,
    [watched, openCalls, positionRows]);
  const [now, setNow] = useState(() => Date.now());

  // the device watchlist: the drawer's ☆, the Watching panel and this table stay in step (WATCH_EVENT)
  useEffect(() => {
    const sync = () => { const w = readWatch(); setWatched(w.coins); setSeen(w.seen as Record<string, { price?: number; at?: number }>); };
    window.addEventListener(WATCH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(WATCH_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const star = (coin: string) => { const r = toggleWatchCoin(coin); setFull(r.full); };

  useEffect(() => {
    let alive = true;
    const load = () => sharedJson(TABLE_URL)
      .then((j) => { if (!alive) return; if (Array.isArray(j?.rows)) { setTable(j as Table); setFailed(false); writeLastCopy(LAST_KEY, j, { valid: tableOk }); } else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const iv = setInterval(() => { load(); setNow(Date.now()); }, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const view = useMemo(() => (table ? yourCoinsFirst(table, watched, sort.col, sort.dir) as { pinned: Row[]; rest: Row[]; missing: string[] } : { pinned: [], rest: [], missing: [] }), [table, watched, sort]);
  const sorted = view.rest;
  const shown = all ? sorted : sorted.slice(0, FIRST);
  const group = (label: string) => (
    <tr aria-hidden="true">
      <td colSpan={TABLE_COLUMNS.length} style={{ padding: 0, borderTop: `1px solid ${C.borderStrong}` }}>
        <div style={{ position: "sticky", left: 0, display: "inline-block", padding: "6px 10px", fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: C.text.muted }}>{label}</div>
      </td>
    </tr>
  );
  const renderRow = (r: Row) => {
    const on = watched.includes(r.coin);
    const asking = callFor === r.coin;
    const callOn = (side: "LONG" | "SHORT") => handOffCall(r.coin, side, navigate, "market-table");
    const sideBtn = (side: "LONG" | "SHORT"): React.CSSProperties => ({
      fontFamily: UI, fontSize: 13, fontWeight: 600, padding: "7px 12px", borderRadius: 8, cursor: "pointer", background: "transparent",
      color: side === "LONG" ? C.pos : C.neg, border: `1px solid ${side === "LONG" ? C.pos : C.neg}`,
    });
    return (
      <Fragment key={r.coin}>
      <tr role="button" tabIndex={0} aria-label={`Open ${r.coin}`} onClick={() => openMarket(r.coin)} onKeyDown={pressKey(() => openMarket(r.coin))}
        style={{ cursor: "pointer", borderTop: `1px solid ${C.border}` }}>
        <td style={{ position: "sticky", left: 0, zIndex: 1, background: C.canvas, padding: "8px 10px 8px 4px", borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <button type="button" aria-pressed={on} aria-label={on ? `Unpin ${r.coin}` : `Pin ${r.coin} to the top`} title={on ? "Watching: pinned to the top" : "Watch: pin to the top"}
              onClick={(e) => { e.stopPropagation(); star(r.coin); }} onKeyDown={(e) => e.stopPropagation()}
              style={{ fontFamily: UI, fontSize: 15, lineHeight: 1, padding: "4px", background: "none", border: "none", cursor: "pointer", color: on ? C.text.bright : C.text.faint }}>{on ? "★" : "☆"}</button>
            <div style={{ minWidth: 88 }}>
              <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: C.text.bright }}>
                {r.coin}
                {marks[r.coin]?.call && <span title="You have an open public call on it" aria-label="your open call" style={{ marginLeft: 5, fontSize: 9, color: C.text.bright, verticalAlign: "2px" }}>●</span>}
                {marks[r.coin]?.position && <span title="You hold an open position in it on Orderly" aria-label="your open position" style={{ marginLeft: 3, fontSize: 9, color: C.text.fog, verticalAlign: "2px" }}>○</span>}
              </div>
              <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.muted }}>
                {price(r.price)}{" "}
                {r.change24hPct != null && <span style={{ color: r.change24hPct > 0 ? C.pos : r.change24hPct < 0 ? C.neg : C.text.muted }}>{r.change24hPct > 0 ? "+" : r.change24hPct < 0 ? "−" : ""}{Math.abs(r.change24hPct).toFixed(1)}%</span>}
                {r.thin && <span> · thin</span>}
              </div>
              {on && (() => {
                const sl = sinceLookCell(sinceLook(r, seen[r.coin]), now) as { move: string; ago: string; dir: number } | null;
                return sl ? (
                  <div title="The price move since you last opened this coin in the Watching panel (this device)" style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.muted }}>
                    <span style={{ color: sl.dir > 0 ? C.pos : sl.dir < 0 ? C.neg : C.text.muted }}>{sl.move}</span> since your look {sl.ago}
                  </div>
                ) : null;
              })()}
            </div>
            <button type="button" aria-expanded={asking} aria-label={`Post a call on ${r.coin}`} title={`Post a call on ${r.coin}: you pick the side, levels build from live price`}
              onClick={(e) => { e.stopPropagation(); setCallFor(asking ? null : r.coin); }} onKeyDown={(e) => e.stopPropagation()}
              style={{ marginLeft: 6, fontFamily: UI, fontSize: 12, fontWeight: 600, padding: "4px 9px", borderRadius: 7, cursor: "pointer", background: asking ? C.accent : "transparent", color: asking ? C.canvas : C.text.fog, border: `1px solid ${asking ? C.accent : C.borderStrong}` }}>Call</button>
          </div>
        </td>
        {td(fundingCell(r), { past: !!r.fundingPast })}
        {td(oiVolCell(r), { past: r.oiVolPast })}
        {td(gapCell(r), { dim: r.gap == null })}
        {td(smartCell(r), { dim: !r.smart || r.smart.side === "NONE" })}
        {td(forecastCell(r), { dim: !r.forecast || r.forecast.divergent === 0 })}
        {td(newsCell(r), { dim: !r.news })}
        <td title={r.reads && r.reads.length ? r.reads.map((x) => `${x.axis} (${x.side.toLowerCase()})`).join(", ") : undefined}
          style={{ padding: "10px", textAlign: "right", fontFamily: MONO, fontSize: 12, color: r.reads && r.reads.length ? C.text.bright : C.text.muted }}>{readsCell(r)}</td>
        {td(usdShort(r.oiUsd), { dim: true })}
      </tr>
      {asking && (
        <tr>
          <td colSpan={TABLE_COLUMNS.length} style={{ padding: 0, background: C.surfaceAlt }}>
            <div className="nx-fade-in" style={{ position: "sticky", left: 0, display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "10px 10px 12px", maxWidth: "min(100vw - 32px, 640px)" }}>
              <span style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, flexBasis: "100%" }}>Your call on {r.coin}. Which way? Levels build from live price; you post it, and it’s graded from public price.</span>
              <button type="button" style={sideBtn("LONG")} onClick={() => callOn("LONG")}>↑ Long {r.coin}</button>
              <button type="button" style={sideBtn("SHORT")} onClick={() => callOn("SHORT")}>↓ Short {r.coin}</button>
              <button type="button" className="nx-text-action" onClick={() => setCallFor(null)} style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, background: "none", border: "none", padding: "0 4px", cursor: "pointer" }}>Cancel</button>
            </div>
          </td>
        </tr>
      )}
      </Fragment>
    );
  };

  const th = (col: string, label: string, align: "left" | "right" = "right") => {
    const on = sort.col === col;
    return (
      <th key={col} scope="col" aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        style={{ position: col === "coin" ? "sticky" : undefined, left: col === "coin" ? 0 : undefined, zIndex: col === "coin" ? 2 : 1, background: C.canvas, padding: 0, textAlign: align, borderBottom: `1px solid ${C.borderStrong}`, whiteSpace: "nowrap" }}>
        <button type="button" onClick={() => setSort(nextSort(sort, col))}
          style={{ fontFamily: UI, fontSize: 12, fontWeight: on ? 700 : 500, color: on ? C.text.bright : C.text.muted, background: "none", border: "none", cursor: "pointer", padding: "8px 10px", width: "100%", textAlign: align }}>
          {label}{on ? (sort.dir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  };
  const td = (content: React.ReactNode, { past = false, dim = false } = {}): React.ReactNode => (
    <td style={{ padding: "10px", textAlign: "right", whiteSpace: "nowrap", fontFamily: MONO, fontSize: 12, color: past ? SIGNAL.watch : dim ? C.text.muted : C.text.fog, fontWeight: past ? 600 : 400 }}>{content}</td>
  );

  return (
    <section aria-label="Every market" style={{ marginBottom: isMobile ? 24 : 32 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 12px", flexWrap: "wrap" }}>
        <div style={{ fontFamily: UI, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: C.text.bright }}>Every market</div>
        <button type="button" onClick={() => setHelp(!help)} aria-expanded={help} className="nx-text-action"
          style={{ fontFamily: UI, fontSize: 12, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
          {help ? "Hide" : "About the columns"}
        </button>
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, marginTop: 4, lineHeight: 1.45 }}>
        One row per coin, each input in its own column. Tap a header to sort, a row to open the coin, ☆ to keep a coin on top. A marked cell is past its stated line. Nothing here adds up into a call.
      </div>
      {help && (
        <dl style={{ margin: "10px 0 0", fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: C.text.fog }}>
          {TABLE_COLUMNS.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 8, marginTop: 4 }}>
              <dt style={{ flexShrink: 0, width: 84, color: C.text.bright }}>{c.label}</dt>
              <dd style={{ margin: 0 }}>
                {c.help}
                {onOpenBoard && boardForColumn(c.id) && (
                  <> <button type="button" className="nx-text-action" onClick={() => onOpenBoard(boardForColumn(c.id)!.id)}
                    style={{ fontFamily: UI, fontSize: 12, color: C.text.bright, background: "none", border: "none", padding: 0, cursor: "pointer" }}>Full board →</button></>
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {failed && !table && <div style={{ marginTop: 12, fontFamily: UI, fontSize: 13, color: C.text.muted }}>The market table is unread right now.</div>}
      {failed && table && <div style={{ marginTop: 10, fontFamily: UI, fontSize: 12, color: C.text.muted }}>Couldn’t refresh: this is the copy from {wireWhen(table.builtAt, now)} ago.</div>}
      {!table && !failed && <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.text.faint }}>Reading every market…</div>}

      {table && table.rows.length > 0 && (
        <div style={{ marginTop: 10, overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 760 }}>
            <thead>
              <tr>{TABLE_COLUMNS.map((c) => th(c.id, c.label, c.id === "coin" ? "left" : "right"))}</tr>
            </thead>
            <tbody>
              {view.pinned.length > 0 && group("YOUR COINS")}
              {view.pinned.map(renderRow)}
              {view.pinned.length > 0 && group("EVERY MARKET")}
              {shown.map(renderRow)}
            </tbody>
          </table>
        </div>
      )}

      {table && (
        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", fontFamily: UI, fontSize: 12, color: C.text.muted }}>
          {sorted.length > FIRST && (
            <button type="button" onClick={() => setAll(!all)} className="nx-text-action"
              style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              {all ? "Show fewer" : `Show all ${sorted.length}`}
            </button>
          )}
          {table.leftOut > 0 && <span>{table.leftOut} thinner markets (under $30k open interest) left out unless you watch one.</span>}
          {view.missing.length > 0 && <span>Watching {view.missing.join(", ")}: not listed on Orderly right now.</span>}
          {full && <span>Your watchlist holds {WATCH_MAX} coins. Unpin one first.</span>}
          {Object.keys(marks).length > 0 && <span>● your open call · ○ your open position</span>}
          <span>Orderly markets, venues, smart money, forecasts, news and paper runs · updated {wireWhen(table.builtAt, now)}{wireWhen(table.builtAt, now) === "now" ? "" : " ago"}.</span>
          {table.unread.length > 0 && <span>Unread right now: {table.unread.map((u) => UNREAD_WORDS[u] ?? u).join(", ")}.</span>}
        </div>
      )}
      {onOpenBoard && (
        <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "baseline" }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: C.text.muted }}>FULL BOARDS</span>
          {boardsAt("table").map((b) => (
            <button key={b.id} type="button" className="nx-text-action" onClick={() => onOpenBoard(b.id)}
              style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" }}>{b.label} →</button>
          ))}
        </div>
      )}
    </section>
  );
}

export default MarketTable;
