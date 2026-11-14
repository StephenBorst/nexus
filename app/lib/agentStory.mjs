// "What your agent is doing", in plain words (Agent tab, 2026-11-14, borst: "read like a log, clean on phone").
// One card at the top of the Agent tab answers the four questions a trader opens it with: is it on and in what mode,
// what is it holding (or why is it sitting out, from the brain's last check), what did it do last, and where it
// stands against today's caps. Built from the state GET /agent/:a already returns. Display only; pure, tested.
import { quietLine, quietAgeText } from "./quietLine.mjs";

const bare = (s) => String(s ?? "").replace(/^PERP_/, "").replace(/_USDC$/, "");
const side = (d) => (d === "LONG" ? "long" : d === "SHORT" ? "short" : String(d ?? "").toLowerCase());
const usd = (v) => `${v < 0 ? "−" : v > 0 ? "+" : ""}$${Math.abs(v).toFixed(2)}`;
const px = (v) => `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: Number(v) >= 100 ? 2 : 4 })}`;
export function agoText(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

export const EXIT_WORDS = Object.freeze({
  SL: "its stop", TP: "its target", TP_PARTIAL: "a partial target", TIMEOUT: "its time limit", TRAIL: "its trailing stop",
  BE: "its break-even stop", KILLED: "the kill switch", WEBHOOK_CLOSE: "a webhook close",
});

const MODE_LINE = {
  PAPER: "Running on paper: simulated fills, no money moves.",
  ASSISTED: "Assisted: it opens nothing new; it still manages what's open.",
  AUTONOMOUS: "Live: it places real orders on your account, inside your caps.",
};

/**
 * @param {{ config: object, state: object|null, trades?: object[], now?: number }} p
 *   trades = the LIVE history rows (paper rows come from state.paper_trades)
 * @returns {{ status: "OFF"|"ON", lines: {k: string, text: string, tone?: string}[] }}
 */
export function agentStory({ config = {}, state = null, trades = [], now = Date.now() } = {}) {
  const lines = [];
  const mode = config.mode || "PAPER";
  if (!state?.active) {
    lines.push({ k: "status", text: "Off. Nothing runs until you activate it." });
  } else {
    lines.push({ k: "status", text: MODE_LINE[mode] ?? `Running (${mode}).` });
  }

  const coins = (config.symbols || []).map(bare).filter(Boolean);
  lines.push({ k: "watching", text: coins.length ? `Watching ${coins.join(", ")}.` : "No markets picked: it evaluates nothing until you add one.", tone: coins.length ? undefined : "watch" });

  const pos = state?.current_position;
  if (pos && pos.symbol) {
    const opened = Number(pos.opened_at);
    const move = Number(pos.pnl_percent);
    lines.push({
      k: "now",
      text: `Holding a ${pos.paper ? "paper " : ""}${side(pos.direction)} on ${bare(pos.symbol)}${opened > 0 ? ` since ${agoText(now - opened)}` : ""}, entered at ${px(pos.entry_price)}${Number.isFinite(move) ? ` (${move >= 0 ? "+" : "−"}${Math.abs(move).toFixed(2)}% so far)` : ""}.`,
      tone: Number.isFinite(move) ? (move >= 0 ? "pos" : "neg") : undefined,
    });
  } else if (state?.active) {
    const q = quietLine(state?.last_signal ?? null, now);
    if (q) lines.push({ k: "now", text: `Flat. ${q.text[0].toUpperCase()}${q.text.slice(1)} (${quietAgeText(q)}).`, tone: q.stale ? "watch" : undefined });
    else if (state?.last_signal?.symbol) {
      const s = state.last_signal;
      lines.push({ k: "now", text: `Flat. Last signal: ${side(s.direction)} ${bare(s.symbol)}, ${agoText(now - Number(s.timestamp))}.` });
    } else lines.push({ k: "now", text: "Flat. No check from the brain yet." });
  }

  const rows = mode === "PAPER" ? (state?.paper_trades ?? []) : (trades ?? []);
  const last = [...rows].filter((t) => t && t.closed_at).sort((a, b) => Date.parse(b.closed_at) - Date.parse(a.closed_at))[0];
  if (last) {
    const pnl = Number(last.pnl);
    lines.push({
      k: "last",
      text: `Last: closed a ${mode === "PAPER" ? "paper " : ""}${side(last.direction)} on ${bare(last.symbol)} ${agoText(now - Date.parse(last.closed_at))} at ${EXIT_WORDS[last.reason] ?? String(last.reason || "close").toLowerCase()}${Number.isFinite(pnl) ? `, ${usd(pnl)}` : ""}.`,
      tone: Number.isFinite(pnl) ? (pnl >= 0 ? "pos" : "neg") : undefined,
    });
  }

  if (state?.active) {
    const n = Number(state.trades_today) || 0, max = Number(config.maxTradesPerDay) || null;
    const pnl = Number(state.daily_pnl) || 0, cap = Number(config.maxDailyLossUsdc) || null;
    const parts = [max ? `${n} of ${max} trades today` : `${n} trades today`];
    parts.push(cap ? `day's P&L ${usd(pnl)} against a −$${cap} stop` : `day's P&L ${usd(pnl)}`);
    const capped = (max && n >= max) || (cap && pnl <= -cap);
    lines.push({ k: "today", text: `${parts.join(" · ")}${capped ? ". Capped: no new entries until the day resets." : "."}`, tone: capped ? "watch" : undefined });
  }

  return { status: state?.active ? "ON" : "OFF", lines };
}
