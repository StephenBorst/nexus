// ⚔ CONTESTED — coins where public callers hold opposite sides right now (open positions + active public calls,
// GET /theses/contested, fail-soft, 30s poll). Honesty pass (borst 2026-11-28): who is on each side and each side's
// own graded record, as facts. No weighted split bar, no "% split", no weights, and no "◆ LONGS have the record here ·
// edge" line: neither side's record is a grade of THIS trade, and a tally of who's where is not a signal. Sides in ink
// (green/red is money). Pinned by app/lib/feedHonesty.test.mjs.
import { StripHead } from "@/components/ui/StripHead";
import { useEffect, useState } from "react";

const API_BASE = "https://og.nexustradinglabs.com";

type MeritRank = { tier: string; title: string; glyph: string } | null;
type PartyRecord = { calls: number; winRate: number; avgR: number } | null;
type SideRecord = { calls: number; wins: number; rSum: number; winRate: number | null; avgR: number | null };
type Edge = { side: "LONG" | "SHORT" | null; gapR: number; reason: string | null };
type Party = { wallet: string; displayName: string | null; pfp: string | null; meritRank: MeritRank; weight: number; sources: string[]; record?: PartyRecord };
type Row = {
  symbol: string;
  longs: Party[]; shorts: Party[];
  longCount: number; shortCount: number;
  longWeight: number; shortWeight: number;
  longRecord?: SideRecord; shortRecord?: SideRecord; edge?: Edge;
  balance: number; tension: number;
};

const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;
const name = (p: Party) => p.displayName || short(p.wallet);
const rStr = (n: number) => `${n >= 0 ? "+" : ""}${n}R`;

function Camp({ side, parties, count, record }: { side: "LONG" | "SHORT"; parties: Party[]; count: number; record?: SideRecord }) {
  const tone = "#ededf0";
  return (
    <div style={{ flex: "1 1 0", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginBottom: 2 }}>
        <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, fontWeight: 700, color: tone, letterSpacing: "0.08em" }}>{side}</span>
        <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a" }}>{count}</span>
      </div>
      {/* This side's combined graded record — who's actually been right */}
      <div title="combined graded call record of this side's callers" style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: record && record.calls ? "#a1a1aa" : "#52525b", marginBottom: 6 }}>
        {record && record.calls ? `${record.wins}-${record.calls - record.wins} · ${rStr(record.avgR ?? 0)}` : "no graded calls yet"}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        {parties.slice(0, 4).map((p) => (
          <div key={p.wallet} style={{ display: "flex", alignItems: "center", gap: 5, minWidth: 0 }}>
            {p.meritRank && <span title={p.meritRank.title} style={{ fontSize: 9, color: "#ededf0", flexShrink: 0 }}>{p.meritRank.glyph}</span>}
            <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name(p)}</span>
            {p.record && <span title={`${p.record.calls} graded calls`} style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b", flexShrink: 0 }}>{rStr(p.record.avgR)}</span>}
            {p.sources.includes("position") && <span title="holds an open position" style={{ fontSize: 8, color: "#a1a1aa", flexShrink: 0 }}>●</span>}
          </div>
        ))}
        {parties.length > 4 && <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b" }}>+{parties.length - 4} more</span>}
      </div>
    </div>
  );
}

export default function Contested() {
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = () => fetch(`${API_BASE}/theses/contested`)
      .then((r) => r.json())
      .then((d) => { if (!cancel) setRows(Array.isArray(d?.contested) ? d.contested : []); })
      .catch(() => { if (!cancel) setRows([]); }); // fail-soft
    load();
    const id = setInterval(load, 30000);
    return () => { cancel = true; clearInterval(id); };
  }, []);

  // Fail-soft + cold-start: render nothing until there's a real standoff (a
  // one-sided book has no disagreement to show — that's correct, not broken).
  if (!rows || rows.length === 0) return null;

  return (
    <div style={{ marginBottom: 24 }}>
      <StripHead title="Contested" sub="callers on opposite sides of one coin · each side's own graded record, not a grade of this trade" />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 8 }}>
        {rows.map((row) => {
          return (
            <div key={row.symbol} style={{ background: "#0f0f11", border: "1px solid #232327", borderRadius: 6, padding: "12px 14px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.03)" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 8 }}>
                <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 14, fontWeight: 700, color: "#f4f4f5" }}>{row.symbol}</span>
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <Camp side="LONG" parties={row.longs} count={row.longCount} record={row.longRecord} />
                <div style={{ width: 1, background: "#232327", flexShrink: 0 }} />
                <Camp side="SHORT" parties={row.shorts} count={row.shortCount} record={row.shortRecord} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
