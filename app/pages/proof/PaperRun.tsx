// ── /proof/paper/:axis — a cleared read's paper run, every trade in R ─────────────────────────────
// borst, 2026-11-12: "show the trade count (n of 30), win/loss/be breakdown, and individual trade r. keep it
// purely about mathematical discipline and execution until the 30-trade sample is complete."
//
// Data: GET /signals/paper-run/:axis (rule app/lib/paperRun.mjs). No dollar figure, no sum or average of R:
// paper has no fees and no funding, so a total would overstate. The 30-trade judgment is made after fees,
// under the live plan, in its own PR. The link card comes from functions/proof/paper/[axis].js.

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { C, SIGNAL } from "@/config/theme";
import { PageMeta } from "@/components/PageMeta";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { paperRunLine } from "@/lib/paperRun.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const AGENT_API = "https://og.nexustradinglabs.com";

type Trade = {
  n: number; coin: string; side: "LONG" | "SHORT"; openedAt: string | null; closedAt: string; holdH: number | null;
  entry: number | null; exit: number | null; reason: string | null; outcome: string; movePct: number | null;
  r: number | null; rBasis: "fill" | "contract" | null;
  tape?: { entry: string; exit: string; trigger?: string };
};
type TapeSummary = { fills: number; judged: number; onTape: number; near: number; off: number; noTrades: number; noData: number; averaged: number; pending: number; triggers?: number; markOnly?: number; line: string | null };
type Run = {
  ok?: boolean; error?: string; axis: string; wallet: string; target: number; unread?: boolean; count: number;
  remaining: number; complete: boolean; startedAt: string | null; windowed: boolean;
  tally: { win: number; loss: number; time: number; other: number };
  open: { n?: number; coin: string; side: string; openedAt: string | null; entry?: number | null; tape?: { entry: string } } | null; trades: Trade[];
  tape?: TapeSummary;
};
type Judgment = { ok?: boolean; verdict: string; target: number; signedAt: string; feeBps: number; line: string | null; recorded?: boolean };

// Each fill against Orderly's public 1-minute tape (app/lib/paperTape.mjs). Not money: no green or red.
const TAPE_MARK: Record<string, { mark: string; word: string }> = {
  ON_TAPE: { mark: "✓", word: "traded inside that minute’s range" },
  NEAR: { mark: "≈", word: "within 0.1% of that minute’s range (the mark is an index, not a trade)" },
  OFF: { mark: "✕", word: "outside that minute’s range" },
  NO_TRADES: { mark: "·", word: "no trades printed that minute" },
  NO_DATA: { mark: "?", word: "Orderly no longer serves that minute" },
  AVERAGED: { mark: "avg", word: "an average of several entries, not one trade" },
  PENDING: { mark: "…", word: "not checked yet (within the hour)" },
};
const tapeMark = (v: string) => TAPE_MARK[v] || TAPE_MARK.PENDING;

const fmtR = (r: number | null) => (r == null ? "unread" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`);
const fmtDay = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "—");
const fmtHold = (h: number | null) => (h == null ? "—" : h < 48 ? `${Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);
const EXIT_WORD: Record<string, string> = { TP: "Target", SL: "Stop", TIMEOUT: "Time stop (168h)" };

export default function PaperRunPage() {
  const { axis = "" } = useParams();
  const isMobile = useIsMobile();
  const [run, setRun] = useState<Run | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "missing" | "failed">("loading");
  // The 30-trade judgment (GET /signals/paper-judge/:axis, rule app/lib/paperJudge.mjs). Unread = the block hides.
  const [judge, setJudge] = useState<Judgment | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    (async () => {
      try {
        const res = await fetch(`${AGENT_API}/signals/paper-run/${encodeURIComponent(axis)}`);
        if (res.status === 404) { if (alive) setState("missing"); return; }
        const d = (await res.json()) as Run;
        if (!alive) return;
        if (!d?.ok) { setState("failed"); return; }
        setRun(d); setState("ok");
      } catch { if (alive) setState("failed"); }
    })();
    return () => { alive = false; };
  }, [axis]);

  useEffect(() => {
    let alive = true;
    setJudge(null);
    (async () => {
      try {
        const res = await fetch(`${AGENT_API}/signals/paper-judge/${encodeURIComponent(axis)}`);
        if (!res.ok) return;
        const d = (await res.json()) as Judgment;
        if (alive && d?.ok) setJudge(d);
      } catch { /* no judgment block */ }
    })();
    return () => { alive = false; };
  }, [axis]);

  const line = run ? paperRunLine(run) : null;
  const pageUrl = `https://trade.nexustradinglabs.com/proof/paper/${encodeURIComponent(axis)}`;
  const shareText = line ? `${line} Every trade in R. No dollar P&L until the sample is complete.` : "";
  const pad = isMobile ? 16 : 32;

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: `${isMobile ? 24 : 48}px ${pad}px 64px`, fontFamily: UI, color: BRIGHT }}>
      <PageMeta title={line ? `${axis} on paper` : "On paper"} description={line || "A cleared read’s paper run, every trade in R."} />
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 12 }}>
        <Link to="/proof" style={{ color: FOG, textDecoration: "none" }}>The proof</Link> · On paper
      </div>

      {state === "loading" && <p style={{ color: FOG, fontSize: 15 }}>Reading the paper record…</p>}
      {state === "missing" && <p style={{ color: FOG, fontSize: 15 }}>No paper run for “{axis}”. Only a read that cleared its bar gets a paper wallet.</p>}
      {state === "failed" && <p style={{ color: FOG, fontSize: 15 }}>The paper record couldn’t be read right now. Nothing is shown rather than a guess.</p>}

      {state === "ok" && run && run.unread && (
        <p style={{ color: FOG, fontSize: 15 }}>{axis} on paper: the record is unread right now. Nothing is shown rather than a guess.</p>
      )}

      {state === "ok" && run && !run.unread && (
        <>
          <h1 style={{ margin: 0, fontSize: isMobile ? 28 : 40, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>
            {axis} on paper.
            <span style={{ display: "block", color: FOG }}>{run.count} of {run.target} trades.</span>
          </h1>

          {/* n of 30: one cell per trade, filled as each closes. Shape, not colour: green/red is for money and price. */}
          <div aria-label={`${run.count} of ${run.target} trades`} style={{ display: "grid", gridTemplateColumns: `repeat(${isMobile ? 15 : 30}, 1fr)`, gap: 4, marginTop: 20, maxWidth: 640 }}>
            {Array.from({ length: run.target }, (_, i) => {
              const t = run.trades.find((x) => x.n === i + 1);
              const done = i < run.count;
              return (
                <div key={i} title={t ? `#${t.n} ${t.coin} ${t.side} · ${fmtR(t.r)}` : done ? `#${i + 1}` : undefined}
                  style={{ height: 14, borderRadius: 2, border: `1px solid ${done ? BRIGHT : MUTED}`, background: done ? BRIGHT : "transparent", opacity: done && t && t.outcome === "LOSS" ? 0.45 : 1 }} />
              );
            })}
          </div>

          <p style={{ margin: "16px 0 0", fontSize: 15, lineHeight: 1.6, maxWidth: 680 }}>
            {run.tally.win} hit the target · {run.tally.loss} hit the stop · {run.tally.time} closed at the time stop
            {run.tally.other ? ` · ${run.tally.other} other` : ""}
            {run.open ? <span style={{ color: FOG }}>{` · 1 open: ${run.open.coin} ${run.open.side}, since ${fmtDay(run.open.openedAt)}`}</span> : null}
            {run.complete ? <span style={{ color: FOG }}> · Sample complete.</span>
              : <span style={{ color: FOG }}>{` · ${run.remaining} to go.`}</span>}
          </p>

          <section style={{ marginTop: 28, borderTop: `1px solid ${MUTED}`, paddingTop: 18, maxWidth: 720 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 10 }}>The rules, fixed before the first trade</div>
            <ul style={{ margin: 0, paddingLeft: 18, color: FOG, fontSize: 14, lineHeight: 1.7 }}>
              <li>Every entry comes from the registered read, as graded, on the 11 main-card coins. Paper only. Nothing is armed.</li>
              <li>Stop = 1.2× the coin’s 4-hour ATR at entry. Target = 1.5× the stop. A trade that hits neither closes at 168 hours. No breakeven stop.</li>
              <li>R = the price move in the trade’s direction ÷ its stop. +1.50R is a full target. −1.00R is a full stop.</li>
              <li>No dollar P&amp;L and no running total here. Paper has no fees and no funding, so a total would overstate. After {run.target} trades the run is judged after fees.</li>
            </ul>
          </section>

          {judge && (
            <section style={{ marginTop: 28, borderTop: `1px solid ${MUTED}`, paddingTop: 18, maxWidth: 720 }}>
              <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 10 }}>
                The verdict at {judge.target} · rules locked {String(judge.signedAt).slice(0, 10)}
              </div>
              {judge.line && <p style={{ margin: "0 0 10px", fontSize: 15, lineHeight: 1.6, color: BRIGHT }}>{judge.line}</p>}
              <ul style={{ margin: 0, paddingLeft: 18, color: FOG, fontSize: 14, lineHeight: 1.7 }}>
                <li>The first {judge.target} trades only. Each one’s net = its move − {judge.feeBps} bps taker fee on each side − the funding it paid while held.</li>
                <li>Mean net above 0 bps = pass. At or below 0 = fail. Each trade weighs the same.</li>
                <li>Fill prices come from the public tape. A fill outside what traded is judged at the worse of its price and the nearest traded price: it can only hurt the run. A fill with no bar to check is counted and named.</li>
                <li>Parity must read clean: every entry paired with a graded event, every event the agent was free to take taken. Drift holds the verdict until it’s explained.</li>
                <li>A reset after the rules were locked ends the run unjudged. The verdict is recorded once and never rewritten. It arms nothing.</li>
              </ul>
              <p style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                <a href={`${AGENT_API}/signals/paper-judge/${encodeURIComponent(axis)}`} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>The judgment, as computed (JSON)</a>
              </p>
            </section>
          )}

          <section style={{ marginTop: 28 }}>
            <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 10 }}>Every trade</div>
            {run.trades.length === 0 && !run.open ? <p style={{ color: FOG, fontSize: 14 }}>No trade yet.</p> : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ minWidth: 700, width: "100%", borderCollapse: "collapse", fontFamily: MONO, fontSize: 12.5 }}>
                  <thead>
                    <tr style={{ color: FOG, textAlign: "left" }}>
                      {["#", "Market", "Side", "Opened", "Held", "Entry → exit", "Tape", "Exit", "R"].map((h) => (
                        <th key={h} style={{ padding: "8px 10px 8px 0", fontWeight: 500, borderBottom: `1px solid ${MUTED}`, textAlign: h === "R" ? "right" : "left" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {/* The open trade first: its entry and tape check, no P&L and no R until it closes. */}
                    {run.open && (
                      <tr style={{ color: BRIGHT }}>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{run.open.n ?? run.count + 1}</td>
                        <td style={{ padding: "9px 10px 9px 0" }}>{run.open.coin}</td>
                        <td style={{ padding: "9px 10px 9px 0" }}>{run.open.side}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{fmtDay(run.open.openedAt)}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{run.open.openedAt ? `${fmtHold((Date.now() - Date.parse(run.open.openedAt)) / 3600000)} so far` : "—"}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{run.open.entry ?? "—"} → open</td>
                        <td style={{ padding: "9px 10px 9px 0", whiteSpace: "nowrap" }}
                            title={run.open.tape ? `Entry: ${tapeMark(run.open.tape.entry).word}.` : undefined}>
                          {run.open.tape ? (
                            <>
                              <span style={{ color: run.open.tape.entry === "OFF" ? SIGNAL.watch : BRIGHT }}>{tapeMark(run.open.tape.entry).mark}</span>
                              <span style={{ color: MUTED }}> → </span>
                              <span style={{ color: FOG }}>—</span>
                            </>
                          ) : <span style={{ color: FOG }}>—</span>}
                        </td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>Open</td>
                        <td style={{ padding: "9px 0", textAlign: "right", color: FOG }} title="R is read when the trade closes.">—</td>
                      </tr>
                    )}
                    {[...run.trades].reverse().map((t) => (
                      <tr key={t.n} style={{ color: BRIGHT }}>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{t.n}</td>
                        <td style={{ padding: "9px 10px 9px 0" }}>{t.coin}</td>
                        <td style={{ padding: "9px 10px 9px 0" }}>{t.side}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{fmtDay(t.openedAt)}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{fmtHold(t.holdH)}</td>
                        <td style={{ padding: "9px 10px 9px 0", color: FOG }}>{t.entry ?? "—"} → {t.exit ?? "—"}</td>
                        <td style={{ padding: "9px 10px 9px 0", whiteSpace: "nowrap" }}
                            title={t.tape ? `Entry: ${tapeMark(t.tape.entry).word}. Exit: ${tapeMark(t.tape.exit).word}.${t.tape.trigger === "MARK_ONLY" ? " The exit fired on the mark: no trade reached its level." : t.tape.trigger === "TRADED" ? " The tape traded at the exit’s level." : ""}` : undefined}>
                          {t.tape ? (
                            <>
                              <span style={{ color: t.tape.entry === "OFF" ? SIGNAL.watch : BRIGHT }}>{tapeMark(t.tape.entry).mark}</span>
                              <span style={{ color: MUTED }}> → </span>
                              <span style={{ color: t.tape.exit === "OFF" ? SIGNAL.watch : BRIGHT }}>{tapeMark(t.tape.exit).mark}</span>
                              {t.tape.trigger === "MARK_ONLY" && <span style={{ color: SIGNAL.watch }}> mark only</span>}
                            </>
                          ) : <span style={{ color: FOG }}>—</span>}
                        </td>
                        <td style={{ padding: "9px 10px 9px 0" }}>{EXIT_WORD[t.reason || ""] || t.reason || "—"}</td>
                        <td style={{ padding: "9px 0", textAlign: "right" }}>
                          {fmtR(t.r)}{t.rBasis === "contract" ? <span style={{ color: FOG }}> *</span> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {run.trades.some((t) => t.rBasis === "contract") && (
              <p style={{ margin: "10px 0 0", color: FOG, fontSize: 12.5, lineHeight: 1.6, maxWidth: 680 }}>
                * Read by the contract (target = +1.50R, stop = −1.00R): these trades closed before each paper row recorded its own stop (from Nov 12). Every later trade shows its R from the fill.
              </p>
            )}
            {run.windowed && <p style={{ margin: "8px 0 0", color: FOG, fontSize: 12.5 }}>Showing the last 50 trades of {run.count}.</p>}
            {run.tape && run.trades.length > 0 && (
              <p style={{ margin: "10px 0 0", color: FOG, fontSize: 12.5, lineHeight: 1.6, maxWidth: 680 }}>
                <span style={{ color: BRIGHT }}>Tape check.</span>{" "}
                {run.tape.line ? `${run.tape.line}.` : "No fill checked yet: each one is checked within the hour of its minute closing."}{" "}
                Paper fills are prices our own agent wrote down. Each one is checked against the public 1-minute bar for that minute, and the bar is kept.{" "}
                <a href={`${AGENT_API}/agent/${run.wallet}/tape`} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>The checks and their sources (JSON)</a>
              </p>
            )}
          </section>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 22, marginTop: 28, fontSize: 13 }}>
            <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}`} target="_blank" rel="noopener noreferrer" style={{ color: BRIGHT }}>𝕏 Share this run</a>
            <a href={`${AGENT_API}/agent/${run.wallet}/parity`} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>Parity check: does the paper agent trade what the grade grades?</a>
            <a href={`${AGENT_API}/signals/paper-run/${encodeURIComponent(axis)}`} target="_blank" rel="noopener noreferrer" style={{ color: FOG }}>The raw record (JSON)</a>
            <Link to="/proof" style={{ color: FOG }}>Back to the proof</Link>
          </div>
          <p style={{ margin: "14px 0 0", color: MUTED, fontSize: 12 }}>Paper wallet {run.wallet}. Started {fmtDay(run.startedAt)}.</p>
        </>
      )}
    </main>
  );
}
