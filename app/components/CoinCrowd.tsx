// Who's on this coin, inside the coin panel (the drawer on a phone, the dock on desktop; borst 2026-11-20). The Spot
// page's "Callers on X · N positioned" strip and its takes, brought to every coin: callers with an open position or an
// active public call, each with the record the grader gave them, and the recent takes naming the coin (ungraded
// discussion). A plain count, no lean. Rules app/lib/coinCrowd.mjs (tested).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { C, MONO, UI } from "@/config/theme";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { takesForCoin, crowdLine, callerRow, CROWD_ROWS } from "@/lib/coinCrowd.mjs";

const API = "https://og.nexustradinglabs.com";
type Caller = { wallet: string; displayName: string | null; direction: string; meritRank: { glyph: string; title: string } | null; record: { calls: number; winRate: number; avgR: number } | null };
type Callers = { participants: number; callCount?: number; callers: Caller[] };
type Take = { id: string; wallet: string; direction: "BULL" | "BEAR"; text: string; sym?: string; displayName?: string | null; createdAt: number; chain?: string; ca?: string };

const ago = (t: number) => { const m = Math.max(0, Math.round((Date.now() - t) / 60_000)); return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`; };

export function CoinCrowd({ coin }: { coin: string }) {
  const [callers, setCallers] = useState<Callers | null | undefined>(undefined); // undefined = reading, null = unread
  const [takes, setTakes] = useState<Take[] | null | undefined>(undefined);
  const [all, setAll] = useState(false);

  useEffect(() => {
    let alive = true;
    setCallers(undefined); setTakes(undefined); setAll(false);
    sharedJson(`${API}/theses/symbol/${encodeURIComponent(coin)}`)
      .then((j) => { if (alive) setCallers(Array.isArray(j?.callers) ? (j as Callers) : null); })
      .catch(() => { if (alive) setCallers(null); });
    sharedJson(`${API}/takes/hot`)
      .then((j) => { if (alive) setTakes(Array.isArray(j?.takes) ? (takesForCoin(j.takes, coin) as Take[]) : null); })
      .catch(() => { if (alive) setTakes(null); });
    return () => { alive = false; };
  }, [coin]);

  if (callers === undefined || takes === undefined) {
    return <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.faint, padding: "4px 0" }}>Reading who’s on {coin}…</div>;
  }
  const rows = (callers?.callers ?? []).map(callerRow);
  const shown = all ? rows : rows.slice(0, CROWD_ROWS);
  const label: React.CSSProperties = { fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", color: C.text.muted };

  return (
    <div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.fog, margin: "2px 0 8px" }}>{crowdLine(callers, takes)}</div>
      {shown.map((r) => (
        <Link key={r.wallet} to={`/feed/trader/${r.wallet}`} style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "6px 0", textDecoration: "none", borderTop: `1px solid ${C.border}` }}>
          <span style={{ fontFamily: UI, fontSize: 13, fontWeight: 600, color: C.text.bright, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 120 }}>{r.who}</span>
          {r.glyph && <span title={`${r.title} caller`} style={{ ...label, color: C.text.fog, fontWeight: 700 }}>{r.glyph}</span>}
          <span title="Graded from public price: closed public calls, win rate, average R" style={{ ...label, whiteSpace: "nowrap" }}>{r.record}</span>
          <span style={{ ...label, marginLeft: "auto", color: C.text.fog, fontWeight: 700 }}>{r.side}</span>
        </Link>
      ))}
      {rows.length > CROWD_ROWS && (
        <button type="button" onClick={() => setAll(!all)} className="nx-text-action"
          style={{ fontFamily: UI, fontSize: 12, color: C.text.fog, background: "none", border: "none", padding: "4px 0", cursor: "pointer" }}>
          {all ? "Show fewer" : `+${rows.length - CROWD_ROWS} more`}
        </button>
      )}
      {takes && takes.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ ...label, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 2 }}>Takes · ungraded discussion</div>
          {takes.slice(0, 3).map((t) => (
            <div key={t.id} style={{ padding: "6px 0", borderTop: `1px solid ${C.border}` }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span style={{ ...label, color: C.text.fog, fontWeight: 700 }}>{t.direction}</span>
                <span style={label}>{t.displayName || `${t.wallet.slice(0, 6)}…${t.wallet.slice(-4)}`}</span>
                <span style={{ ...label, marginLeft: "auto" }}>{ago(t.createdAt)}</span>
              </div>
              <div style={{ fontFamily: UI, fontSize: 13, lineHeight: 1.45, color: C.text.bright, marginTop: 2, wordBreak: "break-word" }}>{t.text}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontFamily: UI, fontSize: 11.5, color: C.text.muted, marginTop: 6, lineHeight: 1.45 }}>
        Open positions and active public calls, each caller’s record graded from public price. Takes are ungraded. No crowd side is added up.
      </div>
    </div>
  );
}

export default CoinCrowd;
