// CALENDAR (Lab home lens, 2026-11-15): what is scheduled to move the tape, by day, in the viewer's time zone. US macro
// releases (ForexFactory's public calendar) and dated world-event markets (Polymarket, via the Catalysts board) from
// GET /intel/events (5-min cache); rules app/lib/eventsCalendar.mjs (tested). Scheduled facts, never a direction.
import { useEffect, useState } from "react";
import { C, MONO, UI, SIGNAL } from "@/config/theme";
import { useIsMobile } from "./useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { untilWords, eventDetail, dayLabel, CALENDAR_NOTE } from "@/lib/eventsCalendar.mjs";

const AGENT_API = "https://og.nexustradinglabs.com";
type Ev = { kind: "MACRO" | "MARKET"; at: number; title: string; impact?: string; forecast?: string | null; previous?: string | null; yesPct?: number | null; coins?: string[] };
type Board = { events: Ev[]; unread: string[]; macroStale?: boolean };
const UNREAD_WORDS: Record<string, string> = { macro: "US macro releases", markets: "world-event markets" };

export function EventsCalendar() {
  const isMobile = useIsMobile();
  const [board, setBoard] = useState<Board | null>(null);
  const [failed, setFailed] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    sharedJson(`${AGENT_API}/intel/events`)
      .then((j) => { if (alive) { if (Array.isArray(j?.events)) setBoard(j as Board); else setFailed(true); } })
      .catch(() => { if (alive) setFailed(true); });
    const iv = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(iv); };
  }, []);

  if (failed) return <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "8px 0" }}>The calendar is unread right now.</div>;
  if (!board) return <div style={{ fontFamily: MONO, fontSize: 11, color: C.text.faint, padding: "8px 0" }}>Reading the calendar…</div>;

  const days: Array<{ label: string; rows: Ev[] }> = [];
  for (const e of board.events) {
    const label = dayLabel(e.at, now);
    const last = days[days.length - 1];
    if (last && last.label === label) last.rows.push(e); else days.push({ label, rows: [e] });
  }
  const unread = board.unread.map((u) => UNREAD_WORDS[u] ?? u);
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

  return (
    <div>
      {(unread.length > 0 || board.macroStale) && (
        <div style={{ fontFamily: UI, fontSize: 12.5, color: SIGNAL.watch, marginBottom: 8, lineHeight: 1.5 }}>
          {unread.length ? `Unread right now: ${unread.join(", ")}. ` : ""}{board.macroStale ? "Macro times are from the last good read (under a day old)." : ""}
        </div>
      )}
      {days.length === 0 && <div style={{ fontFamily: UI, fontSize: 13, color: C.text.muted, padding: "8px 0" }}>Nothing scheduled in the sources read.</div>}
      {days.map((d) => (
        <div key={d.label} style={{ marginBottom: 6 }}>
          <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: C.text.muted, padding: "8px 0 4px" }}>{d.label}</div>
          {d.rows.map((e, i) => {
            const past = e.at < now;
            const high = e.kind === "MACRO" && e.impact === "High";
            return (
              <div key={`${e.at}-${i}`} style={{ display: "grid", gridTemplateColumns: isMobile ? "52px minmax(0, 1fr)" : "64px minmax(0, 1fr) 110px", gap: isMobile ? 8 : 12, padding: "8px 0", borderTop: `1px solid ${C.border}`, opacity: past ? 0.6 : 1 }}>
                <span style={{ fontFamily: MONO, fontSize: 12.5, color: C.text.fog }}>{e.kind === "MARKET" ? "close" : time(e.at)}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: UI, fontSize: 13.5, fontWeight: high ? 700 : 500, color: C.text.bright, lineHeight: 1.4 }}>
                    {e.kind === "MACRO" ? <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.1em", color: high ? C.text.bright : C.text.muted, marginRight: 6 }}>US</span> : null}
                    {e.title}
                  </div>
                  <div style={{ fontFamily: UI, fontSize: 12, color: C.text.muted, marginTop: 2, lineHeight: 1.45 }}>
                    {eventDetail(e)}{isMobile ? ` · ${untilWords(e.at, now)}` : ""}
                  </div>
                </div>
                {!isMobile && <span style={{ fontFamily: MONO, fontSize: 12, color: past ? C.text.muted : C.text.fog, textAlign: "right", whiteSpace: "nowrap" }}>{untilWords(e.at, now)}</span>}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ fontFamily: UI, fontSize: 12, color: C.text.muted, lineHeight: 1.5, marginTop: 8 }}>{CALENDAR_NOTE}</div>
    </div>
  );
}

export default EventsCalendar;
