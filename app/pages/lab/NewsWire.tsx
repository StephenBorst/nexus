// NEWS (Lab home's first lens + Market Intel's NEWS tab, 2026-11-20): headlines read by OUR server (GET /intel/news, rules
// app/lib/newsWire.mjs), each tagged with the coins it names. A coin tag opens that coin's drawer; the coin row filters.
// No third party sees the reader. A feed that failed is named under the list, never shown as "no news". Headlines are
// inputs, never a direction: nothing here reads tone or adds stories up.
import { useEffect, useMemo, useState } from "react";
import { C, MONO, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { newsAge, NEWS_CATEGORIES } from "@/lib/newsWire.mjs";
import { CoinLink } from "@/components/CoinLink";

const AGENT_API = "https://og.nexustradinglabs.com";
const REFRESH_MS = 5 * 60_000;
const CAT_WORDS: Record<string, string> = { ALL: "All", CRYPTO: "Crypto", MACRO: "Macro", DEFI: "DeFi", MARKETS: "Markets", GEOPOLITICS: "World" };

type Story = { id: string; title: string; summary: string; link: string; source: string; category: string; coins: string[]; publishedAt: number | null; firstSeenAt: number };
type Wire = { at: number; items: Story[]; sources: Array<{ id: string; name: string; ok: boolean }>; unread: string[] };

export function NewsWire({ coin = null, limit = 60, compact = false }: { coin?: string | null; limit?: number; compact?: boolean }) {
  const isMobile = useIsMobile();
  const [wire, setWire] = useState<Wire | null>(null);
  const [failed, setFailed] = useState(false);
  const [cat, setCat] = useState("ALL");
  const [coinFilter, setCoinFilter] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const url = `${AGENT_API}/intel/news${coin ? `?coin=${encodeURIComponent(coin)}` : ""}`;
    const load = () => sharedJson(url)
      .then((j) => { if (!alive) return; if (Array.isArray(j?.items)) { setWire(j as Wire); setFailed(false); } else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const iv = setInterval(() => { load(); setNow(Date.now()); }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(iv); clearInterval(tick); };
  }, [coin]);

  // the coins in the news right now, most-named first: a tap filters the list to that coin
  const coinsInNews = useMemo(() => {
    const n = new Map<string, number>();
    for (const s of wire?.items ?? []) for (const c of s.coins ?? []) n.set(c, (n.get(c) || 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [wire]);

  if (failed && !wire) return <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "8px 0" }}>The news wire is unread right now.</div>;
  if (!wire) return <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.faint, padding: "8px 0" }}>Reading the wire…</div>;

  const shown = wire.items
    .filter((s) => cat === "ALL" || s.category === cat)
    .filter((s) => !coinFilter || (s.coins ?? []).includes(coinFilter))
    .slice(0, limit);
  const read = wire.sources.filter((s) => s.ok).map((s) => s.name);
  const chip = (on: boolean): React.CSSProperties => ({
    flexShrink: 0, fontFamily: UI, fontSize: 12, fontWeight: on ? 600 : 500, cursor: "pointer", padding: "4px 10px",
    borderRadius: 999, background: on ? C.accent : "transparent", color: on ? C.canvas : C.text.fog,
    border: `1px solid ${on ? C.accent : C.borderStrong}`,
  });
  const row: React.CSSProperties = { display: "flex", gap: 6, overflowX: isMobile ? "auto" : "visible", flexWrap: isMobile ? "nowrap" : "wrap", paddingBottom: 2, WebkitOverflowScrolling: "touch" };

  return (
    <div>
      {!coin && (
        <>
          <div role="group" aria-label="Topic" style={row}>
            {["ALL", ...NEWS_CATEGORIES].map((c) => (
              <button key={c} type="button" aria-pressed={cat === c} onClick={() => setCat(c)} style={chip(cat === c)}>
                {CAT_WORDS[c] ?? c}
              </button>
            ))}
          </div>
          {coinsInNews.length > 0 && (
            <div role="group" aria-label="Coins in the news" style={{ ...row, marginTop: 8, alignItems: "center" }}>
              <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: C.text.muted }}>IN THE NEWS</span>
              {coinsInNews.map(([c, n]) => (
                <button key={c} type="button" aria-pressed={coinFilter === c} onClick={() => setCoinFilter(coinFilter === c ? null : c)} style={chip(coinFilter === c)}>
                  {c} {n}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", flexDirection: "column", marginTop: coin ? 0 : 10 }}>
        {shown.map((s) => (
          <article key={s.id} style={{ padding: "12px 0", borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap", fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", color: C.text.muted }}>
              <span style={{ color: C.text.fog }}>{s.source}</span>
              <span>{newsAge(s, now)}</span>
              {(s.coins ?? []).map((c) => (
                <span key={c} style={{ color: C.text.bright }}><CoinLink coin={c} /></span>
              ))}
            </div>
            {s.link ? (
              <a href={s.link} target="_blank" rel="noopener noreferrer nofollow" style={{ display: "block", textDecoration: "none", marginTop: 4, fontFamily: UI, fontSize: isMobile ? 15 : 14, fontWeight: 600, lineHeight: 1.35, color: C.text.bright }}>
                {s.title}
              </a>
            ) : (
              <div style={{ marginTop: 4, fontFamily: UI, fontSize: isMobile ? 15 : 14, fontWeight: 600, lineHeight: 1.35, color: C.text.bright }}>{s.title}</div>
            )}
            {s.summary && !isMobile && !compact && (
              <div style={{ marginTop: 4, fontFamily: UI, fontSize: 13, lineHeight: 1.5, color: C.text.fog }}>{s.summary}</div>
            )}
          </article>
        ))}
        {shown.length === 0 && (
          <div style={{ padding: "12px 0", borderTop: `1px solid ${C.border}`, fontFamily: UI, fontSize: 13, color: C.text.muted }}>
            {wire.items.length === 0 ? "No stories read yet." : coin ? `No story names ${coin} in the last 48 hours.` : "No story matches this filter."}
          </div>
        )}
      </div>

      {!compact && <div style={{ marginTop: 10, fontFamily: UI, fontSize: 12, lineHeight: 1.5, color: C.text.muted }}>
        Read by our server from {read.length ? read.join(", ") : "no source right now"}. Headlines, not a call.
        {wire.unread.length > 0 && <> Unread: {wire.unread.join(", ")}.</>}
      </div>}
    </div>
  );
}

export default NewsWire;
