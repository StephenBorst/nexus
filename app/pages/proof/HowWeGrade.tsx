// ── "How we grade": the method behind every line on /proof, one tap away ────────────────────
// Moved off the page body (borst, 2026-10-23): the bar's stages, how a signal is graded, the tide,
// the Oct 15 result (dated receipts), and how calls and agents are graded. Every live number comes
// from /intel/axis-backtest as served; the stage thresholds read its `pipeline.rules`, so this
// can't drift from what the grader enforces.
import { C } from "@/config/theme";
import { Oct15Result } from "./FeaturedLead";
import type { Scorecard } from "./SignalBoard";

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui, sans-serif)";
const { bright: BRIGHT, fog: FOG, muted: MUTED } = C.text;
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");
const signR = (r: number) => `${r < 0 ? "−" : "+"}${Math.abs(r).toFixed(2)}R`;

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontFamily: UI, fontSize: 13.5, fontWeight: 600, color: BRIGHT }}>{title}</div>
      <div style={{ marginTop: 6, fontFamily: UI, fontSize: 13, color: FOG, lineHeight: 1.6 }}>{children}</div>
    </div>
  );
}

export default function HowWeGrade({ scorecard, isMobile }: { scorecard: Scorecard | null; isMobile?: boolean }) {
  const rules = (scorecard?.pipeline?.rules || {}) as Record<string, number | undefined>;
  const n = rules.minEvents ?? 30, edge = rules.edgePct ?? 95, hN = rules.holdoutMinEvents ?? 30, hPct = rules.holdoutPct ?? 80;
  const exitN = rules.exitMinTrades ?? 30, kill = rules.killEvents ?? 100;
  const tide = scorecard?.tide;
  const coins = scorecard?.config?.coins?.length;
  return (
    <div style={{ padding: "0 2px" }}>
      <Block title="The bar">
        Written down before the results. A signal is registered with its rule frozen, and only events after that date count. It moves up in stages:
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          {[
            ["A lead", `${n}+ events, positive on average, in both halves.`],
            ["An edge", `beats ${edge}% of random entries on its side, and repeats on markets it was never picked on (${hN}+ events, beats ${hPct}% of random).`],
            ["Tradeable", `makes money after fees as the agent trades it, over ${exitN}+ trades.`],
            ["On paper", "a paper wallet trades it. Real money is a separate review."],
          ].map(([t, d], i) => (
            <div key={t} style={{ display: "grid", gridTemplateColumns: "18px minmax(0, 1fr)", gap: 6 }}>
              <span style={{ fontFamily: MONO, fontSize: 11, color: MUTED, lineHeight: "20.8px" }}>{i + 1}</span>
              <span><b style={{ color: BRIGHT, fontWeight: 600 }}>{t}</b>: {d}</span>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>After {kill} events, a signal that loses on average or does worse than random is retired, in public.</div>
      </Block>

      <Block title="How a signal is graded">
        Each time a signal fires, we take its side and grade it in R: a stop at 1.2× the coin’s average 4-hour range, a target at
        1.5× the stop. Whichever is touched first decides it; an hour that touches both counts as a loss; neither within a week
        counts as zero. Prices after the signal only, nothing it couldn’t have seen.
        <div style={{ marginTop: 8 }}>
          “Old data” means the history we already had when a signal was registered. A grade on it shows the idea, not an edge: rules
          picked on old data tend to look better there than they will later.
        </div>
        <div style={{ marginTop: 8 }}>
          Against random: every event is re-entered at 300 random hours on the same market, same side, same window. Beating {edge}% of
          them beats random. Beating 5% or fewer is worse than random.
        </div>
      </Block>

      {tide && (
        <Block title="The tide">
          What a random trade earned over every recorded market-hour, {day(tide.from)} – {day(tide.to)}, {tide.markets} markets:
          long <span style={{ fontFamily: MONO, color: tide.LONG.meanR >= 0 ? C.pos : C.neg }}>{signR(tide.LONG.meanR)}</span>, short{" "}
          <span style={{ fontFamily: MONO, color: tide.SHORT.meanR >= 0 ? C.pos : C.neg }}>{signR(tide.SHORT.meanR)}</span>.
          A signal has to beat its side’s tide, not zero.
        </Block>
      )}

      <Block title="The Oct 15 check">
        The first scheduled re-check. Nothing cleared. The closest, Basis × CVD:
        <Oct15Result isMobile={isMobile} />
      </Block>

      <Block title="How calls are graded">
        From public 1-hour prices, once the entry trades. First touch of the target or the stop decides it; a candle touching both is a
        loss. A win pays the R the posted levels make. Nobody types in a result.
      </Block>

      <Block title="How agents are graded">
        Settled trades with exchange order IDs, so each one can be checked against the exchange. Paper and live are kept apart.
      </Block>

      {(coins || scorecard?.asOf) && (
        <div style={{ marginTop: 16, fontFamily: MONO, fontSize: 10, color: MUTED }}>
          {coins ? `Signals pooled across ${coins} markets` : ""}{coins && scorecard?.asOf ? " · " : ""}{scorecard?.asOf ? `updated ${day(scorecard.asOf)}` : ""}
        </div>
      )}
    </div>
  );
}
