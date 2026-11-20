// THE WIRE (top of Lab home, borst 2026-11-20, terminal step 2): what changed in the last day, from every board, on one
// clock. GET /intel/wire (lab-api routes-wire.mjs, rules app/lib/wire.mjs). Each row keeps its own source and its own
// grade line; nothing adds rows up into a call. A coin opens its drawer; a row with a page opens it. Phone first: the
// newest few, filter chips, "Show all". What's scheduled in the next 12h sits above the stream.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { C, MONO, UI } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { WIRE_FILTERS, WIRE_KINDS, filterWire, wireWhen } from "@/lib/wire.mjs";
import { CoinLink } from "@/components/CoinLink";
import { boardsAt } from "@/lib/intelLenses.mjs";

const WIRE_URL = "https://og.nexustradinglabs.com/intel/wire";
const REFRESH_MS = 60_000;
const FIRST = 8;

type Row = { id: string; kind: string; t: number; coin: string | null; title: string; detail?: string | null; source?: string; graded?: string | null; path?: string | null; link?: string | null };
type Soon = { id: string; kind: "MACRO" | "MARKET"; t: number; title: string; impact?: string | null; detail?: string | null; coins?: string[] };
type Wire = { rows: Row[]; upcoming: Soon[]; unread: string[]; builtAt: number };

export function TheWire({ onOpenBoard }: { onOpenBoard?: (id: string) => void }) {
  const isMobile = useIsMobile();
  const [wire, setWire] = useState<Wire | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("all");
  const [all, setAll] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    const load = () => sharedJson(WIRE_URL)
      .then((j) => { if (!alive) return; if (Array.isArray(j?.rows)) { setWire(j as Wire); setFailed(false); } else setFailed(true); })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const iv = setInterval(() => { load(); setNow(Date.now()); }, REFRESH_MS);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  const rows: Row[] = wire ? filterWire(wire.rows, filter) : [];
  const shown = all ? rows : rows.slice(0, FIRST);
  const chip = (on: boolean): React.CSSProperties => ({
    flexShrink: 0, fontFamily: UI, fontSize: 13, fontWeight: on ? 600 : 500, cursor: "pointer", padding: "6px 12px",
    borderRadius: 999, background: on ? C.accent : "transparent", color: on ? C.canvas : C.text.fog,
    border: `1px solid ${on ? C.accent : C.borderStrong}`,
  });
  const link: React.CSSProperties = { fontFamily: UI, fontSize: 13, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" };
  // The full boards behind the Wire's rows: every headline, the week ahead, world-event markets (app/lib/intelLenses.mjs).
  const WIRE_BOARD_WORDS: Record<string, string> = { news: "All headlines", calendar: "The week ahead", catalysts: "World events" };
  const titleStyle: React.CSSProperties = { display: "block", fontFamily: UI, fontSize: isMobile ? 15 : 14, fontWeight: 600, lineHeight: 1.35, color: C.text.bright, textDecoration: "none", marginTop: 3 };

  return (
    <section aria-label="The Wire" style={{ marginTop: isMobile ? 8 : 16, marginBottom: isMobile ? 24 : 32 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontFamily: UI, fontSize: 17, fontWeight: 600, letterSpacing: "-0.01em", color: C.text.bright }}>The Wire</div>
        {wire && <span style={{ fontFamily: MONO, fontSize: 10, color: C.text.muted }}>updated {wireWhen(wire.builtAt, now)}{wireWhen(wire.builtAt, now) === "now" ? "" : " ago"}</span>}
      </div>
      <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, marginTop: 4, lineHeight: 1.45 }}>
        What changed in the last day, from every board, on one clock. Each row keeps its own source and grade.
      </div>

      {wire && wire.upcoming.length > 0 && (
        <div style={{ marginTop: 12, padding: "10px 12px", border: `1px solid ${C.border}`, borderRadius: 8, background: C.surfaceAlt }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
            <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: C.text.muted }}>COMING UP · NEXT 12H</span>
            {onOpenBoard && <button type="button" className="nx-text-action" style={{ ...link, fontSize: 12 }} onClick={() => onOpenBoard("calendar")}>The week →</button>}
          </div>
          {wire.upcoming.map((s) => (
            <div key={s.id} style={{ display: "flex", gap: 10, marginTop: 6, alignItems: "baseline" }}>
              <span style={{ flexShrink: 0, width: 56, fontFamily: MONO, fontSize: 11, color: C.text.fog }}>{wireWhen(s.t, now)}</span>
              <span style={{ fontFamily: UI, fontSize: 13, lineHeight: 1.4, color: C.text.bright }}>
                {s.title}{s.impact ? <span style={{ color: C.text.muted }}> · {s.impact}</span> : null}
                {s.detail ? <span style={{ color: C.text.muted }}> · {s.detail}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}

      <div role="group" aria-label="Show" style={{ display: "flex", gap: 8, marginTop: 12, overflowX: isMobile ? "auto" : "visible", flexWrap: isMobile ? "nowrap" : "wrap", paddingBottom: 2, WebkitOverflowScrolling: "touch" }}>
        {WIRE_FILTERS.map((f) => (
          <button key={f.id} type="button" aria-pressed={filter === f.id} onClick={() => { setFilter(f.id); setAll(false); }} style={chip(filter === f.id)}>{f.label}</button>
        ))}
      </div>

      {failed && !wire && <div style={{ marginTop: 12, fontFamily: UI, fontSize: 13, color: C.text.muted }}>The wire is unread right now.</div>}
      {!wire && !failed && <div style={{ marginTop: 12, fontFamily: MONO, fontSize: 11, color: C.text.faint }}>Reading the wire…</div>}

      {wire && (
        <div style={{ marginTop: 10 }}>
          {shown.map((r) => (
            <article key={r.id} style={{ display: "flex", gap: 10, padding: "11px 0", borderTop: `1px solid ${C.border}` }}>
              <span style={{ flexShrink: 0, width: 32, fontFamily: MONO, fontSize: 11, color: C.text.muted, paddingTop: 1 }}>{wireWhen(r.t, now)}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline", fontFamily: MONO, fontSize: 10, letterSpacing: "0.06em", color: C.text.muted }}>
                  <span style={{ color: C.text.fog, textTransform: "uppercase" }}>{(WIRE_KINDS as Record<string, string>)[r.kind] ?? r.kind}</span>
                  {r.coin && <span style={{ color: C.text.bright }}><CoinLink coin={r.coin} /></span>}
                  {r.source && <span>{r.source}</span>}
                </div>
                {r.link ? (
                  <a href={r.link} target="_blank" rel="noopener noreferrer nofollow" style={titleStyle}>{r.title}</a>
                ) : r.path ? (
                  <Link to={r.path} style={titleStyle}>{r.title}</Link>
                ) : (
                  <div style={titleStyle}>{r.title}</div>
                )}
                {r.detail && !isMobile && <div style={{ marginTop: 3, fontFamily: UI, fontSize: 13, lineHeight: 1.45, color: C.text.fog }}>{r.detail}</div>}
                {r.graded && <div style={{ marginTop: 3, fontFamily: UI, fontSize: 12, lineHeight: 1.45, color: C.text.muted }}>{r.graded}</div>}
              </div>
            </article>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: "11px 0", borderTop: `1px solid ${C.border}`, fontFamily: UI, fontSize: 13, color: C.text.muted }}>Nothing on this filter in the last day.</div>
          )}
          {rows.length > FIRST && (
            <button type="button" onClick={() => setAll(!all)} className="nx-text-action" style={{ marginTop: 8, fontFamily: UI, fontSize: 13, color: C.text.fog, background: "none", border: "none", padding: 0, cursor: "pointer" }}>
              {all ? "Show fewer" : `Show all ${rows.length}`}
            </button>
          )}
          {wire.unread.length > 0 && (
            <div style={{ marginTop: 8, fontFamily: UI, fontSize: 12, color: C.text.muted }}>Unread right now: {wire.unread.join(", ")}.</div>
          )}
          {onOpenBoard && (
            <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: "6px 14px", alignItems: "baseline" }}>
              <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: C.text.muted }}>FULL BOARDS</span>
              {boardsAt("wire").map((b) => (
                <button key={b.id} type="button" className="nx-text-action" style={link} onClick={() => onOpenBoard(b.id)}>{WIRE_BOARD_WORDS[b.id] ?? b.label} →</button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default TheWire;
