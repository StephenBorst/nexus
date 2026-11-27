// ── /proof/graveyard — every read that failed, fell back or was dropped, beside what cleared ─────────────────────────
// borst 2026-11-26: "the strategy graveyard". Built only from records that already exist (rules app/lib/graveyard.mjs):
// the served board's `failing` labels dated by the daily watcher, promotion locks, recorded paper verdicts, axes graded
// on recorded history only, the retired graded exit and the drafts dropped before registration. Facts in ink: no
// score, no ranking of the dead, no green or red. An unread board lists nothing rather than a partial graveyard.

import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { C } from "@/config/theme";
import { PageMeta } from "@/components/PageMeta";
import { useIsMobile } from "@/pages/lab/useIsMobile";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { usePaperJudgments } from "@/hooks/usePaperJudgments";
import { PROMOTION_LOCKS } from "@/lib/promotionLocks.mjs";
import { FAILING_READS } from "@/lib/failingReads.mjs";
import { FAILING_SEEDS } from "@/lib/pipelineWatch.mjs";
import { graveyard, graveDate, graveyardHeadline, GRAVEYARD_LINE } from "@/lib/graveyard.mjs";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const API = "https://og.nexustradinglabs.com";
const STAGE_WORDS: Record<string, string> = { REGISTERED: "Still testing", LEAD: "Lead", EDGE: "Edge", TRADEABLE: "Tradeable", PAPER: "Paper" };
const stageWord = (s: string | null | undefined) => (s ? STAGE_WORDS[s] || s : "unread");
const fmtR = (r: number | null) => (r == null ? "unread" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`);

type Row = { key: string; title: string; when: string; lines: string[]; link?: { to: string; text: string } };

function Section({ title, note, rows, empty }: { title: string; note: string; rows: Row[]; empty: string }) {
  return (
    <section style={{ marginTop: 36 }}>
      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: BRIGHT }}>
        {title} <span style={{ fontFamily: MONO, fontSize: 13, color: FOG, fontWeight: 400 }}>{rows.length}</span>
      </h2>
      <p style={{ margin: "6px 0 12px", fontSize: 13, lineHeight: 1.5, color: MUTED, maxWidth: 680 }}>{note}</p>
      {rows.length === 0 ? <p style={{ margin: 0, fontSize: 14, color: FOG }}>{empty}</p> : (
        <div style={{ display: "grid", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.key} style={{ border: `1px solid ${C.border}`, borderRadius: 8, padding: "12px 14px", background: C.surface }}>
              <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "4px 12px", alignItems: "baseline" }}>
                <span style={{ fontSize: 15, fontWeight: 600, color: BRIGHT, overflowWrap: "anywhere" }}>{r.title}</span>
                <span style={{ fontFamily: MONO, fontSize: 11.5, color: FOG }}>{r.when}</span>
              </div>
              {r.lines.map((l, i) => <p key={i} style={{ margin: "6px 0 0", fontSize: 13.5, lineHeight: 1.5, color: i === 0 ? BRIGHT : FOG, overflowWrap: "anywhere" }}>{l}</p>)}
              {r.link ? <Link to={r.link.to} style={{ display: "inline-block", marginTop: 8, fontFamily: UI, fontSize: 13, color: FOG }}>{r.link.text}</Link> : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default function GraveyardPage() {
  const isMobile = useIsMobile();
  const [scorecard, setScorecard] = useState<{ axes: unknown[]; pipeline?: { reads?: { axis: string; stage: string; paperWallet?: string | null }[] } } | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");

  useEffect(() => {
    let alive = true;
    sharedJson(`${API}/intel/axis-backtest`)
      .then((d) => { if (!alive) return; const sc = d as { axes?: unknown[] } | null; if (Array.isArray(sc?.axes)) { setScorecard(sc as { axes: unknown[] }); setState("ok"); } else setState("failed"); })
      .catch(() => { if (alive) setState("failed"); });
    return () => { alive = false; };
  }, []);

  const judgments = usePaperJudgments(scorecard?.pipeline?.reads, { anyStage: true });
  const g = useMemo(() => graveyard({ scorecard, failingReads: FAILING_READS, seeds: FAILING_SEEDS, locks: PROMOTION_LOCKS, judgments }), [scorecard, judgments]);
  const pad = isMobile ? 16 : 32;

  const failingRows: Row[] = g.failing.map((r) => ({
    key: r.axis, title: r.label, when: r.since ? `failing since ${graveDate(r.since)}` : "dated at the next daily read",
    lines: [...r.reasons, `Stage now: ${stageWord(r.stage)}. ${r.paperRun ? "Still running on paper; it can recover." : "No paper run; it is still graded on new data and can recover."}${r.sinceSource === "git" ? " Date from the daily watcher’s history." : ""}`],
    link: r.paperRun ? { to: `/proof/paper/${encodeURIComponent(r.axis)}`, text: "Its paper run →" } : undefined,
  }));
  const fellRows: Row[] = g.fellBack.map((r) => ({
    key: r.axis, title: r.label, when: `fell back ${graveDate(r.on)}`,
    lines: [r.backAtStage ? `Was ${stageWord(r.lostStage)}, fell, and is back at ${stageWord(r.nowStage)}: still locked.` : `Was ${stageWord(r.lostStage)}; now ${stageWord(r.nowStage)}.`, `${r.eventsAtDemotion ?? "unread"} events when it fell. Locked until 2 clean daily reads a week apart and 15 new events; ${r.cleanPasses} of 2 clean so far.`],
  }));
  const paperRows: Row[] = g.paper.map((r) => ({
    key: r.axis, title: r.label, when: r.verdict,
    lines: [r.verdict === "PASS" ? `Passed its 30 paper trades but didn’t beat random entries on the same coins and side${r.randomPct != null ? ` (${r.randomPct}% of 300)` : ""}.` : r.verdict === "RESET" ? "Its paper record was reset after the judgment page was signed. Final." : "Its first 30 paper trades lost after fees. Final."],
    link: { to: `/proof/paper/${encodeURIComponent(r.axis)}`, text: "The 30 trades →" },
  }));
  const historyRows: Row[] = g.history.map((r) => ({
    key: r.axis, title: r.label, when: "recorded history only",
    lines: [`${r.trades ?? "unread"} trades, average ${fmtR(r.meanR)} on the frozen contract.`, `Beat ${r.randomPct ?? "unread"}${r.randomPct != null ? "%" : ""} of random entries. Never registered, so never counted forward.`],
  }));
  const retiredRows: Row[] = g.retired.map((r) => ({ key: r.axis, title: r.label, when: `retired ${graveDate(r.on)}`, lines: [r.why] }));
  const droppedRows: Row[] = g.dropped.map((d) => ({ key: d.name, title: d.name, when: `dropped ${graveDate(d.on)}`, lines: [d.why, `Page: ${d.doc}`] }));

  return (
    <main style={{ maxWidth: 920, margin: "0 auto", padding: `${isMobile ? 24 : 48}px ${pad}px 64px`, fontFamily: UI, color: BRIGHT }}>
      <PageMeta title="The graveyard" description={GRAVEYARD_LINE} />
      <div style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.2em", textTransform: "uppercase", color: FOG, marginBottom: 12 }}>
        <Link to="/proof" style={{ color: FOG, textDecoration: "none" }}>The proof</Link> · The graveyard
      </div>
      <h1 style={{ margin: 0, fontSize: isMobile ? 28 : 40, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1.1 }}>The graveyard.</h1>
      <p style={{ margin: "12px 0 0", fontSize: 15, lineHeight: 1.6, color: FOG, maxWidth: 680 }}>{GRAVEYARD_LINE}</p>

      {state === "loading" && <p style={{ marginTop: 24, color: FOG, fontSize: 15 }}>Reading the board…</p>}
      {state === "failed" && <p style={{ marginTop: 24, color: FOG, fontSize: 15 }}>{graveyardHeadline(null)}</p>}
      {state === "ok" && (
        <>
          <p style={{ margin: "20px 0 0", fontFamily: MONO, fontSize: 13.5, lineHeight: 1.6, color: BRIGHT, maxWidth: 720 }}>{graveyardHeadline(g)}</p>
          {g.cleared.length > 0 && (
            <p style={{ margin: "8px 0 0", fontSize: 13.5, color: FOG }}>Cleared: {g.cleared.join(", ")}. <Link to="/proof" style={{ color: FOG }}>On the board →</Link></p>
          )}
          <Section title="Failing now" note="Registered reads the 100-event check flags today. A label, not a verdict: they keep running and come off this list if they recover." rows={failingRows} empty="No registered read is failing today." />
          <Section title="Fell back" note="Reads whose served stage dropped below the one recorded. Paper keeps running; nothing can be signed for them while locked." rows={fellRows} empty="No read has fallen back." />
          <Section title="Failed on paper" note="Recorded 30-trade paper verdicts that failed, were reset, or passed without beating random entries." rows={paperRows} empty="No paper run has been judged a failure yet." />
          <Section title="Retired" note="Final retirements." rows={retiredRows} empty="Nothing retired." />
          <Section title="Lost on recorded history" note="Graded on recorded history only (in-sample) and never registered, with an average at or below 0R. Worst first." rows={historyRows} empty="None." />
          <Section title="Dropped before testing" note="Drafts dropped at the event-count check, before anything was graded. Each page says why." rows={droppedRows} empty="None." />
        </>
      )}
    </main>
  );
}
