// ── Agent BACKTEST card ──
// Extracted from AgentView.tsx (god-file split). Read-only analysis: it replays a
// config against real history and renders the result. It is NOT on the money path —
// nothing here places an order or mutates agent state — which is why it was the right
// ~140 lines to lift out first.
//
// Result shapes are typed in ./backtestTypes (the worker's response contract).
import type { AgentConfig } from "./types";
import type { BacktestResult, SweepResult, ValidationResult, OiCoverage as OiCoverageField } from "./backtestTypes";
import { strategyLabel, backtestGateSupport } from "@/lib/strategyLabel.mjs";
import { agentCardStyle, agentLabelStyle, btnPrimary, navBtnStyle } from "./styles";
import { bareTicker } from "@/utils/utils";
import { pressKey } from "@/utils/a11y";

// Per-symbol recorded-OI coverage. A bare "0/14d" hid WHICH market was short — and since
// the brain only records OI for core BTC/ETH/SOL + watchlisted symbols, that was usually a
// market the user never asked about zeroing a min() across the whole universe.
function OiCoverage({ rows }: { rows?: OiCoverageField }) {
  if (!Array.isArray(rows) || !rows.length) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 7 }}>
      {rows.map((r) => (
        <span key={r.symbol} title={r.mature ? "mature · included in the run" : "not enough recorded history · excluded"}
          style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, padding: "2px 7px", borderRadius: 2, border: `1px solid ${r.mature ? "#3ecf8e44" : "#33333a"}`, color: r.mature ? "#3ecf8e" : "#71717a" }}>
          {bareTicker(String(r.symbol))} {r.days}d/{r.samples}
        </span>
      ))}
    </div>
  );
}

// Name what was ACTUALLY tested. A filtered or inverted run reads "Gated …" / "Inverted …"
// (strategyLabel), so it can't be mistaken for the preset — inverted runs trade the mirror
// image and are flagged loud, because that is exactly how a saved config went −$21 unnoticed.
function TestedAs({ label }: { label?: string }) {
  if (!label) return null;
  const inverted = label.startsWith("Inverted");
  return (
    <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9.5, color: inverted ? "#fbbf24" : "#71717a", marginBottom: 8 }}>
      TESTED AS: <b style={{ color: inverted ? "#fbbf24" : "#d4d4d8" }}>{label}</b>{inverted ? " — INVERT is on: this trades the opposite side of the signal" : ""}
    </div>
  );
}

// Gates the SIM cannot honour. deriveSignal skips the regime / smart-money filters when no
// regime or consensus is supplied, and a backtest has neither — so a green number must
// never imply a filter that silently never ran.
function GatesNote({ skipped }: { skipped?: string[] }) {
  if (!Array.isArray(skipped) || !skipped.length) return null;
  return (
    <div style={{ color: "#fbbf24", fontFamily: "var(--nx-font-ui)", fontSize: 9.5, lineHeight: 1.5, marginTop: 7 }}>
      ⚠ Not simulated here: {skipped.join(" · ")}. Those apply live only — the numbers above are the un-gated version.
    </div>
  );
}

export function AgentBacktestCard({
  isPro, config, backtest, backtesting, sweep, sweeping, validation, validating,
  runConfigBacktest, runConfigSweep, runValidation, applySweepConfig,
}: {
  isPro: boolean;
  config: AgentConfig;
  backtest: BacktestResult | null;
  backtesting: boolean;
  sweep: SweepResult | null;
  sweeping: boolean;
  validation: ValidationResult | null;
  validating: boolean;
  runConfigBacktest: () => void;
  runConfigSweep: () => void;
  runValidation: () => void;
  applySweepConfig: (cfg: Record<string, unknown>) => void;
}) {
  // ── BACKTEST — test this exact config on real history (PRO) ──
  return (
    <div style={agentCardStyle}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={agentLabelStyle}>BACKTEST</div>
          {/* Name the COMPOSITION, not just signalMode — an inverted config takes the
              OPPOSITE trade, so "CONFLUENCE" described a trade we aren't making. */}
          <span title="What this config actually trades" style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#a1a1aa", border: "1px solid #232327", borderRadius: 3, padding: "2px 8px" }}>{strategyLabel(config)}</span>
          <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#ededf0", border: "1px solid #33333a", borderRadius: 3, padding: "2px 8px" }}>◆ PRO</span>
        </div>
        {isPro && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={runConfigBacktest} disabled={backtesting || sweeping} style={{ ...btnPrimary, fontSize: 10, padding: "6px 16px", opacity: (backtesting || sweeping) ? 0.5 : 1 }}>
              {backtesting ? "RUNNING…" : "▶ TEST THIS CONFIG"}
            </button>
            <button onClick={runConfigSweep} disabled={backtesting || sweeping || validating} style={{ ...navBtnStyle, fontSize: 10, padding: "6px 16px", opacity: (backtesting || sweeping || validating) ? 0.5 : 1 }}>
              {sweeping ? "SWEEPING…" : "⊞ SWEEP CONFIGS"}
            </button>
            <button onClick={runValidation} disabled={backtesting || sweeping || validating} title="Walk-forward across markets and time. The robustness test." style={{ ...navBtnStyle, fontSize: 10, padding: "6px 16px", color: "#ededf0", borderColor: "#33333a", opacity: (backtesting || sweeping || validating) ? 0.5 : 1 }}>
              {validating ? "VALIDATING…" : "✓ VALIDATE"}
            </button>
          </div>
        )}
      </div>
      {!isPro ? (
        <div style={{ color: "#a1a1aa", fontFamily: "var(--nx-font-ui)", fontSize: 11, marginTop: 10, lineHeight: 1.5 }}>
          Replay this exact config over 60 days of real BTC/ETH/SOL data — using the same engine the agent runs on — before risking a cent. A Nexus PRO feature.
        </div>
      ) : (
        <>
          <div style={{ color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 10, marginTop: 8, lineHeight: 1.5 }}>
            Replays your config on real Orderly history with the deployed signal + exit logic. Verify before you deploy capital.
          </div>
          {backtest && (
            <div style={{ marginTop: 12 }}>
              {backtest.untestable && (
                <div style={{ color: "#fbbf24", fontFamily: "var(--nx-font-ui)", fontSize: 10, lineHeight: 1.5, marginBottom: 10, padding: "6px 8px", border: "1px solid #fbbf2430", borderRadius: 3 }}>
                  ⚠ {backtest.note}
                  <OiCoverage rows={backtest.oiCoverage ?? backtest.basisCoverage} />
                </div>
              )}
              {/* When OI-driven modes ARE testable, surface the OI-window caveat
                  (funding+price span the full window; confluence only the recorded OI). */}
              {!backtest.untestable && backtest.note && (
                <div style={{ color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 10, lineHeight: 1.5, marginBottom: 10, padding: "6px 8px", border: "1px solid #232327", borderRadius: 3 }}>
                  ◆ {backtest.note}
                  <OiCoverage rows={backtest.oiCoverage ?? backtest.basisCoverage} />
                </div>
              )}
              <TestedAs label={backtest.strategyLabel} />
              <GatesNote skipped={backtest.gatesSkipped ?? backtestGateSupport(config).skipped} />
              {backtest.portfolio && (
                <div style={{ ...agentLabelStyle, fontSize: 8.5, color: "#52525b", marginBottom: 4 }}>EACH MARKET ON ITS OWN</div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
                {[
                  { label: `NET P&L (${backtest.basisWindowDays ?? backtest.days ?? 60}d)`, value: `${backtest.combined.netUsd >= 0 ? "+" : ""}$${backtest.combined.netUsd}`, color: backtest.combined.netUsd >= 0 ? "#3ecf8e" : "#f7525f" },
                  { label: "WIN RATE", value: `${backtest.combined.winRate}%`, color: "#d4d4d8" },
                  { label: "TRADES", value: String(backtest.combined.trades), color: "#d4d4d8" },
                ].map(({ label, value, color }) => (
                  <div key={label}>
                    <div style={{ ...agentLabelStyle, fontSize: 9 }}>{label}</div>
                    <div style={{ color, fontFamily: "var(--nx-font-mono)", fontSize: 18, fontWeight: 600 }}>{value}</div>
                  </div>
                ))}
              </div>
              {backtest.portfolio && (() => {
                // The same markets under the agent's real rules: one position at a time across the
                // watchlist, the brain's single best signal per tick, the daily trade/loss caps.
                const p = backtest.portfolio;
                const b = p.blocked || {};
                const why = [
                  b.busy ? `${b.busy} while already in a position` : null,
                  b.otherMarket ? `${b.otherMarket} lost to another market the same hour` : null,
                  b.dailyCap ? `${b.dailyCap} over the daily cap` : null,
                  b.cooldown ? `${b.cooldown} in the cooldown` : null,
                ].filter(Boolean);
                const skipped = (b.busy || 0) + (b.otherMarket || 0) + (b.dailyCap || 0) + (b.cooldown || 0);
                return (
                  <div style={{ marginTop: 12, padding: "8px 10px", border: "1px solid #33333a", borderRadius: 4, background: "#0f0f11" }}
                    title="Replayed on one timeline the way the exec runs it: one position at a time across all markets, the brain's single best signal per tick (ties → first in your list), your daily trade and loss caps. Same entry and exit code as the numbers above.">
                    <div style={{ ...agentLabelStyle, fontSize: 8.5, color: "#ededf0", marginBottom: 6 }}>AS THE AGENT TRADES IT · one position at a time · daily caps</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 16px", fontFamily: "var(--nx-font-mono)", fontSize: 12 }}>
                      <span style={{ color: p.netUsd >= 0 ? "#3ecf8e" : "#f7525f", fontWeight: 600 }}>{p.netUsd >= 0 ? "+" : ""}${p.netUsd}</span>
                      <span style={{ color: "#d4d4d8" }}>{p.winRate}% win</span>
                      <span style={{ color: "#d4d4d8" }}>{p.trades} trades</span>
                      <span style={{ color: "#71717a" }}>PF {p.profitFactor}</span>
                    </div>
                    <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 10, color: "#71717a", marginTop: 5, lineHeight: 1.5 }}>
                      {skipped
                        ? <>Couldn’t take {skipped} signal{skipped === 1 ? "" : "s"}: {why.join(" · ")}.</>
                        : <>Every signal was takeable. No overlap between markets in this window.</>}
                    </div>
                    {p.baseline && (() => {
                      // Same markets, trade count, long/short mix and exits — only the entry timing is
                      // random. Says whether the SIGNAL picked good moments or the exits + drift did.
                      const bl = p.baseline;
                      if (bl.verdict === "TOO_FEW_TRADES") {
                        return (
                          <div style={{ fontFamily: "var(--nx-font-ui)", fontSize: 10, color: "#52525b", marginTop: 5, lineHeight: 1.5 }}>
                            vs random entries: too few trades to test ({bl.trades} — needs {bl.minTrades}).
                          </div>
                        );
                      }
                      const tone = bl.verdict === "BEATS_RANDOM" ? "#3ecf8e" : bl.verdict === "LEANS_ABOVE" ? "#fbbf24" : bl.verdict === "BELOW_RANDOM" ? "#f7525f" : "#a1a1aa";
                      const read = bl.verdict === "BEATS_RANDOM" ? "the timing carries information"
                        : bl.verdict === "LEANS_ABOVE" ? "leans above random · not conclusive"
                        : bl.verdict === "BELOW_RANDOM" ? "worse than random timing this window. Inverting it is a new rule, untested"
                        : "indistinguishable from random timing this window";
                      return (
                        <div title={`${bl.runs} replays with the same markets, number of trades, long/short split and exits — only the entry times are random (seed ${bl.seed}). Random P&L: median $${bl.randomMedianUsd}, 5th–95th pct $${bl.randomP5Usd} to $${bl.randomP95Usd}.`}
                          style={{ fontFamily: "var(--nx-font-ui)", fontSize: 10, color: "#71717a", marginTop: 5, lineHeight: 1.5, cursor: "help" }}>
                          vs random entries: beat <b style={{ color: tone, fontFamily: "var(--nx-font-mono)" }}>{bl.pctBeaten}%</b> of {bl.runs} replays
                          <span style={{ color: "#52525b" }}> (random median ${bl.randomMedianUsd})</span> — {read}.
                          {bl.verdict !== "BEATS_RANDOM" && bl.moreTradesNeeded != null && (
                            <span style={{ color: "#52525b" }}> At this edge, ~{bl.moreTradesNeeded} more trade{bl.moreTradesNeeded === 1 ? "" : "s"} to separate from random (rough guide).</span>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
              <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
                {backtest.perSymbol.map((s) => (
                  <div key={s.symbol} style={{ display: "flex", justifyContent: "space-between", fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa", borderTop: "1px solid #232327", paddingTop: 4 }}>
                    <span>{bareTicker(s.symbol)}</span>
                    <span>{s.trades} trades · {s.winRate}% win · PF {s.profitFactor} · <span style={{ color: s.netUsd >= 0 ? "#3ecf8e" : "#f7525f" }}>{s.netUsd >= 0 ? "+" : ""}${s.netUsd}</span></span>
                  </div>
                ))}
              </div>
              <div style={{ color: "#52525b", fontFamily: "var(--nx-font-ui)", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
                Past performance ≠ future results. Taker fees modeled (~3bps/side); funding RECEIVED while fading is not (a tailwind — live may run better). 60d hourly, ${(config.capitalPerTrade * config.leverage).toFixed(0)} notional/trade.
              </div>
            </div>
          )}
          {validation && (() => {
            const v = validation.verdict;
            const vc = v === "ROBUST" ? "#3ecf8e" : v === "FRAGILE" ? "#fbbf24" : "#f7525f";
            const vlabel = v === "ROBUST" ? "✓ ROBUST" : v === "FRAGILE" ? "◐ FRAGILE" : "✕ NOT ROBUST";
            return (
              <div style={{ marginTop: 14 }}>
                <div style={{ ...agentLabelStyle, fontSize: 9, marginBottom: 6 }}>
                  WALK-FORWARD — {validation.strategyLabel ?? strategyLabel(config)} · {validation.totalSymbols} symbols · {validation.folds} time folds · {validation.days}d · fees on
                </div>
                {validation.untestable ? (
                  <div style={{ color: "#fbbf24", fontFamily: "var(--nx-font-ui)", fontSize: 10, lineHeight: 1.5, padding: "6px 8px", border: "1px solid #fbbf2430", borderRadius: 3 }}>
                    ⚠ {validation.note}
                    <OiCoverage rows={validation.oiCoverage ?? validation.basisCoverage} />
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 10px", border: `1px solid ${vc}44`, borderRadius: 4, background: `${vc}0c` }}>
                      <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 14, fontWeight: 700, color: vc }}>{vlabel}</span>
                      <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#a1a1aa" }}>
                        net-positive on {validation.posSymbols}/{validation.totalSymbols} markets · {validation.foldConsistency}% of folds positive · net <span style={{ color: validation.totalNet >= 0 ? "#3ecf8e" : "#f7525f" }}>{validation.totalNet >= 0 ? "+" : ""}${validation.totalNet}</span>
                      </span>
                    </div>
                    {validation.note && (
                      <div style={{ color: "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 9.5, lineHeight: 1.5, marginTop: 8 }}>
                        ◆ {validation.note}
                        <OiCoverage rows={validation.oiCoverage ?? validation.basisCoverage} />
                      </div>
                    )}
                    <div style={{ marginTop: 8, overflowX: "auto" }}>
                      <div style={{ minWidth: 320 }}>
                        {validation.perSymbol.map((s) => (
                          <div key={s.symbol} style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: "var(--nx-font-mono)", fontSize: 10, padding: "3px 0", borderTop: "1px solid #141416" }}>
                            <span style={{ width: 46, color: "#d4d4d8" }}>{bareTicker(s.symbol)}</span>
                            <span style={{ width: 66, textAlign: "right", color: s.net >= 0 ? "#3ecf8e" : "#f7525f" }}>{s.net >= 0 ? "+" : ""}${s.net}</span>
                            <span style={{ width: 54, textAlign: "right", color: "#a1a1aa" }}>{s.foldsPositive}/{validation.folds}f</span>
                            <span style={{ display: "flex", gap: 2, marginLeft: 6 }}>
                              {s.folds.map((n: number, i: number) => <span key={i} title={`fold ${i + 1}: ${n >= 0 ? "+" : ""}$${n}`} style={{ width: 8, height: 12, borderRadius: 1, background: n > 0 ? "#3ecf8e" : n < 0 ? "#f7525f" : "#33333a" }} />)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                    {validation.portfolio && (() => {
                      // The verdict above is per-market breadth × time. This is what the agent can book:
                      // its own watchlist on one timeline, one position at a time, daily caps.
                      const p = validation.portfolio;
                      return (
                        <div style={{ marginTop: 10, padding: "7px 9px", border: "1px solid #33333a", borderRadius: 4, background: "#0f0f11" }}
                          title="The verdict is judged per market (does the edge exist on each market on its own). This line is the stream your agent can actually take on its own watchlist — one position at a time, daily caps — split into the same time folds.">
                          <div style={{ ...agentLabelStyle, fontSize: 8.5, color: "#ededf0", marginBottom: 5 }}>
                            AS THE AGENT TRADES IT · {(p.watchlist || []).map((x: string) => bareTicker(x)).join("·")}
                          </div>
                          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 14px", fontFamily: "var(--nx-font-mono)", fontSize: 11 }}>
                            <span style={{ color: p.netUsd >= 0 ? "#3ecf8e" : "#f7525f", fontWeight: 600 }}>{p.netUsd >= 0 ? "+" : ""}${p.netUsd}</span>
                            <span style={{ color: "#d4d4d8" }}>{p.trades} trades · {p.winRate}% win</span>
                            <span style={{ color: "#a1a1aa" }}>{p.foldsPositive}/{validation.folds} folds positive</span>
                            <span style={{ display: "flex", gap: 2 }}>
                              {(p.folds || []).map((n: number, i: number) => <span key={i} title={`fold ${i + 1}: ${n >= 0 ? "+" : ""}$${n} · ${p.foldTrades?.[i] ?? 0} trades`} style={{ width: 8, height: 12, borderRadius: 1, background: n > 0 ? "#3ecf8e" : n < 0 ? "#f7525f" : "#33333a" }} />)}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                    <div style={{ color: "#52525b", fontFamily: "var(--nx-font-ui)", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
                      The honest test: an edge that only works on one market in one window is NOT robust. We hold our own presets to this — nothing wears &quot;proven&quot; until it passes. Past performance ≠ future results.
                    </div>
                  </>
                )}
              </div>
            );
          })()}
          {sweep && (() => {
            // The basis sweep reports per-row market breadth (posSymbols) — show it, because
            // "best net on one market" is exactly the overfit a sweep invites.
            const hasMkts = sweep.results.some((r) => Number.isFinite(r.posSymbols));
            const sweepCols = hasMkts ? "1fr 62px 44px 44px 50px" : "1fr 70px 52px 56px";
            return (
            <div style={{ marginTop: 14 }}>
              <div style={{ ...agentLabelStyle, fontSize: 9, marginBottom: 6 }}>
                RANKED{sweep.rankedBy === "portfolio" ? " AS THE AGENT TRADES IT" : ""} — {sweep.results.length} configs · {sweep.symbols.map((s: string) => bareTicker(s)).join("/")} · {sweep.days}d · ${sweep.notional} notional
              </div>
              <div style={{ overflowX: "auto" }}>
                <div style={{ minWidth: 340 }}>
                  <div style={{ display: "grid", gridTemplateColumns: sweepCols, gap: 6, fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#71717a", padding: "0 0 4px", borderBottom: "1px solid #232327" }}>
                    <span>STRATEGY</span><span style={{ textAlign: "right" }}>NET$</span>{hasMkts && <span title="Markets it was net-positive on" style={{ textAlign: "right" }}>MKTS+</span>}<span style={{ textAlign: "right" }}>WIN%</span><span style={{ textAlign: "right" }}>TRADES</span>
                  </div>
                  {sweep.results.slice(0, 12).map((r, i: number) => (
                    <div role="button" tabIndex={0} key={i} onClick={() => r.config && applySweepConfig(r.config)} onKeyDown={pressKey(() => r.config && applySweepConfig(r.config))} title="Apply this config to the editor above" style={{ display: "grid", gridTemplateColumns: sweepCols, gap: 6, fontFamily: "var(--nx-font-mono)", fontSize: 10, padding: "5px 4px", borderBottom: "1px solid #141416", color: "#a1a1aa", cursor: r.config ? "pointer" : "default", borderRadius: 3 }}
                      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "#141416"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}>
                      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i === 0 ? "★ " : ""}{r.name}</span>
                      <span title={Number.isFinite(r.indepNetUsd) ? `One position at a time across ${sweep.symbols.length} markets, daily caps. Each market on its own: ${(r.indepNetUsd ?? 0) >= 0 ? "+" : ""}$${r.indepNetUsd} over ${r.indepTrades} trades.` : undefined}
                        style={{ textAlign: "right", color: r.netUsd >= 0 ? "#3ecf8e" : "#f7525f", fontWeight: 600 }}>{r.netUsd >= 0 ? "+" : ""}{r.netUsd}</span>
                      {hasMkts && <span style={{ textAlign: "right", color: (r.posSymbols ?? 0) * 2 > (r.totalSymbols ?? 0) ? "#d4d4d8" : "#71717a" }}>{r.posSymbols}/{r.totalSymbols}</span>}
                      <span style={{ textAlign: "right" }}>{r.winRate}</span>
                      <span style={{ textAlign: "right" }}>{r.trades}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ color: "#52525b", fontFamily: "var(--nx-font-ui)", fontSize: 9, marginTop: 8, lineHeight: 1.5 }}>
                ↑ Click any row to apply that config to the editor. {sweep.note ? sweep.note : sweep.oiTested
                  ? `CONFLUENCE + OI-divergence are now in the sweep${sweep.oiCoverage && !Array.isArray(sweep.oiCoverage) && sweep.oiCoverage.minDays ? `, graded on ${sweep.oiCoverage.minDays}d of recorded OI history` : ""}.`
                  : "CONFLUENCE/OI aren't in the sweep yet. They fold in once recorded OI history is deep enough."} Every config here was graded on real price — apply a winner, then paper-test before going live.
              </div>
              {sweep.basisCoverage && <OiCoverage rows={sweep.basisCoverage} />}
            </div>
            );
          })()}
        </>
      )}
    </div>
  );
}
