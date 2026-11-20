// THE MARKET TABLE (Lab home, under the Wire; borst 2026-11-20, terminal step 4): one row per coin, each input in its own
// column, sortable by any of them. GET /intel/table (lab-api routes-table.mjs, rules app/lib/marketTable.mjs). No
// combined score; the default order is open interest, and a cell past a stated line is marked, never summed. Tapping a
// row opens the coin's drawer. Phone: the coin column stays put while the rest scrolls sideways.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { pressKey } from "@/utils/a11y";
import { openMarket } from "@/lib/marketDrawerEvent.mjs";
import { boardsAt, boardForColumn } from "@/lib/intelLenses.mjs";
import {
  TABLE_COLUMNS, DEFAULT_SORT, sortTable, nextSort, usdShort, fundingCell, oiVolCell, gapCell, smartCell, forecastCell,
  newsCell, readsCell,
} from "@/lib/marketTable.mjs";

const TABLE_URL = "https://og.nexustradinglabs.com/intel/table";
const REFRESH_MS = 60_000;
const FIRST = 15;
const UNREAD_WORDS: Record<string, string> = { markets: "Orderly markets", venues: "other venues' funding", smart: "smart money", forecasts: "forecasts", news: "news", reads: "paper runs" };

type Row = {
  coin: string; price: number; change24hPct: number | null; oiUsd: number; volUsd: number | null;
  funding8hPct: number | null; fundingPast: "LONGS" | "SHORTS" | null; oiVol: number | null; oiVolPast: boolean;
  gap: number | null; smart: { long: number; short: number; side: string } | null;
  forecast: { divergent: number; total: number } | null; news: number | null; reads: Array<{ axis: string; side: string }> | null;
};
type Table = { rows: Row[]; leftOut: number; unread: string[]; builtAt: number };

const price = (p: number) => (p >= 1000 ? p.toLocaleString("en-US", { maximumFractionDigits: 0 }) : p >= 1 ? p.toFixed(2) : p.toPrecision(3));

export function MarketTable({ onOpenBoard }: { onOpenBoard?: (id: string) => void }) {
  const isMobile = useIsMobile();
  const [table, setTable] = useState<Table | null>(null);
  const [failed, setFailed] = useState(false);
  const [sort, setSort] = useState<{ col: string; dir: string }>({ ...DEFAULT_SORT });
  const [all, setAll] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () => sharedJson(TABLE_URL)
      .then((j) => { if (!alive) return; if (Array.isArray(j?.rows)) { setTable(j as Table); setFailed(false); } else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const iv = setInterval(load, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const sorted = useMemo(() => (table ? (sortTable(table.rows, sort.col, sort.dir) as Row[]) : []), [table, sort]);
  const shown = all ? sorted : sorted.slice(0, FIRST);

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
        One row per coin, each input in its own column. Tap a header to sort, a row to open the coin. A marked cell is past its stated line. Nothing here adds up into a call.
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
      {!table && !failed && <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.text.faint }}>Reading every market…</div>}

      {table && table.rows.length > 0 && (
        <div style={{ marginTop: 10, overflowX: "auto", WebkitOverflowScrolling: "touch", border: `1px solid ${C.border}`, borderRadius: 8 }}>
          <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%", minWidth: 760 }}>
            <thead>
              <tr>{TABLE_COLUMNS.map((c) => th(c.id, c.label, c.id === "coin" ? "left" : "right"))}</tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.coin} role="button" tabIndex={0} aria-label={`Open ${r.coin}`} onClick={() => openMarket(r.coin)} onKeyDown={pressKey(() => openMarket(r.coin))}
                  style={{ cursor: "pointer", borderTop: `1px solid ${C.border}` }}>
                  <td style={{ position: "sticky", left: 0, zIndex: 1, background: C.canvas, padding: "8px 10px", borderTop: `1px solid ${C.border}`, whiteSpace: "nowrap" }}>
                    <div style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, color: C.text.bright }}>{r.coin}</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.muted }}>
                      {price(r.price)}{" "}
                      {r.change24hPct != null && <span style={{ color: r.change24hPct > 0 ? C.pos : r.change24hPct < 0 ? C.neg : C.text.muted }}>{r.change24hPct > 0 ? "+" : r.change24hPct < 0 ? "−" : ""}{Math.abs(r.change24hPct).toFixed(1)}%</span>}
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
              ))}
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
          {table.leftOut > 0 && <span>{table.leftOut} thinner markets (under $30k open interest) left out.</span>}
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
