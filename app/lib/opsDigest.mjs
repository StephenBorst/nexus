// ── The owner's Telegram digest + instant alerts (borst, 2026-11-14) ───────────────────────────────────────
// "Stops you from having to open four different pages to know what needs attention." lab-api gathers the facts
// once an hour (workers/nexus-lab-api/opsDigest.mjs, :49 on the minute cron, after the :47 judge) and:
//   • sends an ALERT the hour something changes that needs the owner: a stage move, a paper wallet's parity turning
//     DRIFT / UNVERIFIABLE (a drift stops every step until it's explained) or clearing, a final verdict recorded,
//     a new item waiting on the owner (register a wallet, sign the rules, wire the brain);
//   • sends the DIGEST once a day (the first run at or after DIGEST_HOUR_UTC): what needs the owner, each paper run
//     (count, trades closed in the last 24h in R with their tape checks, the open trade or why it's quiet, parity),
//     the stage board, and what the revenue receivers hold that hasn't been swept to the Safe.
// Read-only: it trades, signs and moves nothing. No paper dollars: trades in R, as the paper run page shows them.
// Pure: no fetch, no KV. Tested in opsDigest.test.mjs.

export const DIGEST_HOUR_UTC = 15;   // 15:49 UTC = 8:49 in Denver (MST): after the 7:45 watcher run
export const DIGEST_RUN_MINUTE = 49; // lab-api's minute cron, after the :41 tape check and the :47 judge
export const DIGEST_STATE_KEY = "ops:digest:state:v1"; // LAB_STORE: what the last successful run saw
export const DIGEST_DAY_KEY = (day) => `ops:digest:sent:${day}`;
export const SWEEP_NUDGE_USDC = 100;

const BLOCKING_PARITY = new Set(["DRIFT", "UNVERIFIABLE"]);
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtR = (r) => (r == null ? "R unread" : `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}R`);
const TAPE = { ON_TAPE: "✓", NEAR: "≈", OFF: "✗", NO_TRADES: "–", NO_DATA: "?", AVERAGED: "avg", PENDING: "…" };
const EXIT = { TP: "target", SL: "stop", TIMEOUT: "time stop" };

/** What waits on the owner. `reads` = [{axis, stage, wallet, hasSetup, signed}] (signed: null = no page needed). */
export function pendingItems(reads) {
  const out = [];
  for (const r of reads || []) {
    if (r.stage === "TRADEABLE" && !r.wallet) {
      out.push(r.hasSetup
        ? { key: `register:${r.axis}`, text: `Register a fresh paper wallet for ${r.axis} on /ops/revenue (open its setup link first).` }
        : { key: `wire:${r.axis}`, text: `${r.axis} is TRADEABLE: its brain wiring comes first. Ask Claude to build it.` });
    }
    if (r.wallet && r.signed === false) out.push({ key: `sign:${r.axis}`, text: `Sign ${r.axis}'s 30-trade rules on /ops/revenue.` });
  }
  return out;
}

// ── After a recorded 30-trade verdict: what happens next, in order (borst 2026-11-14) ─────────────────────────
// The judgment's rule 8: "PASS: a written live plan may be signed (its own PR). The house rules still bind: the $10
// mechanics test first; arming and size are borst's, in person. FAIL: nothing goes live; the gap between graded and
// traded is the next question, written down before it is looked at." The digest turns that into steps with what's
// already done marked, so the path is a glance, not a reread. It decides nothing and does none of the steps.
const APP = "https://trade.nexustradinglabs.com";
const REPO = "https://github.com/StephenBorst/nexus/blob/main";

/**
 * @param {object} p   a paper run row: { axis, verdict, wallet }
 * @param {{ plan?: { doc: string, signed: boolean } | null, liftWallet?: string | null }} [ctx]
 * @returns {null | { head: string, steps: Array<{ state: "done"|"next"|"later", text: string }> }}
 */
export function verdictSteps(p, { plan = null, liftWallet = null } = {}) {
  if (!p?.verdict) return null;
  if (p.verdict === "FAIL") {
    return { head: `${p.axis} FAILED its 30-trade judgment. Nothing goes live.`, steps: [
      { state: "next", text: "Write down the gap question (graded vs traded) before anyone looks at why. The read stays on the scoreboard." },
    ] };
  }
  if (p.verdict === "RESET") {
    return { head: `${p.axis}'s paper run was reset: the judgment ended RESET.`, steps: [
      { state: "next", text: "A new run needs a new dated rules page before its first trade." },
    ] };
  }
  if (p.verdict !== "PASS") return null;
  const steps = [
    plan
      ? { state: plan.signed ? "done" : "todo", text: `Refresh the live plan's numbers with Claude (they date from its draft), then sign it on ${APP}/ops/revenue. Signing arms nothing. ${REPO}/${plan.doc}` }
      : { state: "todo", text: `Have Claude draft ${p.axis}'s live plan: none exists yet. Then sign it on ${APP}/ops/revenue.` },
    { state: liftWallet ? "done" : "todo", text: "Fund a NEW dedicated wallet with the plan's account size and nothing else. Never the Safe, never borst.eth." },
    { state: liftWallet ? "done" : "todo", text: "Arm it: your own PR that puts that wallet in GRADED_EXIT_LIVE_LIFT, in person. Nothing else arms it." },
    { state: "todo", text: `The $10 mechanics test before the first real trade (house rules): the backstop shows on Orderly and KILL clears it. Line by line: ${APP}/ops/preflight?wallet=${liftWallet || "<the new wallet>"}` },
    { state: "todo", text: "After 10 live trades: the written compare against the paper wallet (slippage, fees, parity) before trade 11." },
  ];
  let marked = false;
  for (const s of steps) if (s.state === "todo") { s.state = marked ? "later" : "next"; marked = true; }
  return { head: `${p.axis} PASSED its 30-trade judgment (${APP}/proof/paper/${p.axis}). Next, in order:`, steps };
}

/** The state a run leaves for the next one to compare against. */
export function digestState(facts) {
  return {
    at: facts.asOf,
    stages: facts.stages || {},
    parity: Object.fromEntries((facts.paper || []).map((p) => [p.axis, p.parity || null])),
    verdicts: Object.fromEntries((facts.paper || []).map((p) => [p.axis, p.verdict || null])),
    pending: (facts.pending || []).map((x) => x.key),
  };
}

/**
 * The alerts for what changed since the last run. A first run (no prev) alerts only on what blocks right now
 * (parity drift, a recorded verdict and pending items are listed by the digest instead): never a burst of "new" news.
 * An unread board (facts.stages null) alerts nothing about stages: never on a guess.
 */
export function alertsFor(prev, facts) {
  const out = [];
  const p = prev || null;
  if (facts.stages && p?.stages) {
    for (const [axis, stage] of Object.entries(facts.stages)) {
      const was = p.stages[axis];
      if (was && was !== stage) out.push({ key: `stage:${axis}:${stage}`, text: `${axis}: ${was} → ${stage}.` });
      if (!was && p.stages && Object.keys(p.stages).length) out.push({ key: `stage:${axis}:${stage}`, text: `${axis} is on the board: ${stage}.` });
    }
  }
  for (const r of facts.paper || []) {
    const was = p?.parity?.[r.axis] ?? null;
    if (BLOCKING_PARITY.has(r.parity) && was !== r.parity) {
      out.push({ key: `parity:${r.axis}:${r.parity}`, text: `${r.axis} paper parity reads ${r.parity}: ${r.parityNote || "a graded event and the paper wallet disagree"}. Every step for this read waits until it's explained.` });
    } else if (r.parity === "CLEAN" && BLOCKING_PARITY.has(was)) {
      out.push({ key: `parity:${r.axis}:CLEAN`, text: `${r.axis} paper parity is CLEAN again.` });
    }
    if (r.verdict && r.verdict !== (p?.verdicts?.[r.axis] ?? null) && p) {
      const next = r.verdict === "PASS" ? " Next: refresh and sign the live plan on /ops/revenue (it arms nothing). The digest lists every step."
        : r.verdict === "FAIL" ? " Nothing goes live." : "";
      out.push({ key: `verdict:${r.axis}:${r.verdict}`, text: `${r.axis}: the 30-trade judgment is recorded: ${r.verdict}. It licenses nothing by itself.${next}` });
    }
  }
  if (p) {
    const had = new Set(p.pending || []);
    for (const x of facts.pending || []) if (!had.has(x.key)) out.push({ key: `pending:${x.key}`, text: x.text });
  }
  return out;
}

/** The first run's message: proves the bot reaches the owner's chat the day it ships, not at the next digest. */
export const HELLO_TEXT = "<b>Nexus · digest is on</b>\n"
  + "Alerts come within the hour when something needs you: a stage move, paper parity drifting, a verdict recorded, "
  + "a wallet to register or rules to sign. The daily digest comes at 15:49 UTC (8:49 in Denver). Read-only: nothing moves.";

/** One alert message (Telegram HTML). */
export function alertText(alerts) {
  if (!alerts.length) return null;
  return `<b>Nexus · heads up</b>\n${alerts.map((a) => `· ${esc(a.text)}`).join("\n")}`;
}

const groupStages = (stages) => {
  const by = {};
  for (const [axis, st] of Object.entries(stages || {})) (by[st] ||= []).push(axis);
  const order = ["PAPER", "TRADEABLE", "EDGE", "LEAD", "REGISTERED", "RETIRED"];
  return order.filter((s) => by[s]?.length).map((s) => (s === "REGISTERED" || s === "RETIRED" ? `${s} ${by[s].length}` : `${s}: ${by[s].sort().join(", ")}`));
};

/** The daily digest (Telegram HTML). */
export function digestText(facts) {
  const day = new Date(facts.asOf).toISOString().slice(0, 10);
  const L = [`<b>Nexus · daily digest</b> · ${day}`, ""];
  L.push("<b>Needs you</b>");
  if (facts.pending?.length) for (const x of facts.pending) L.push(`· ${esc(x.text)}`);
  const drift = (facts.paper || []).filter((p) => BLOCKING_PARITY.has(p.parity));
  for (const p of drift) L.push(`· ${esc(p.axis)} parity reads ${esc(p.parity)}: explain it before anything else moves.`);
  const after = (facts.paper || []).map((p) => verdictSteps(p, { plan: p.plan || null, liftWallet: p.liftWallet || null })).filter(Boolean);
  for (const v of after) {
    L.push(`· ${esc(v.head)}`);
    v.steps.forEach((s, i) => L.push(`  ${i + 1}. ${s.state === "done" ? "[done]" : s.state === "next" ? "[next]" : "[ ]"} ${esc(s.text)}`));
  }
  if (!facts.pending?.length && !drift.length && !after.length) L.push("Nothing waiting on you.");

  if (facts.paper?.length) {
    L.push("", "<b>Paper runs</b>");
    for (const p of facts.paper) {
      if (p.unread) { L.push(`${esc(p.axis)} · record unread right now`); continue; }
      L.push(`${esc(p.axis)} · ${p.count} of ${p.target} · parity ${esc(p.parity || "unread")}${p.verdict ? ` · verdict ${esc(p.verdict)}` : ""}`);
      for (const t of p.closed24h || []) {
        const tape = t.tape ? ` · tape ${TAPE[t.tape.entry] || "?"}/${TAPE[t.tape.exit] || "?"}` : "";
        L.push(`  #${t.n} ${esc(t.coin)} ${esc(t.side)} · ${esc(EXIT[t.reason] || t.reason || "closed")} · ${fmtR(t.r)}${t.rBasis === "contract" ? " (by the contract)" : ""}${tape}`);
      }
      if (!(p.closed24h || []).length) L.push("  no trade closed in the last 24h");
      if (p.open) L.push(`  open: ${esc(p.open.coin)} ${esc(p.open.side)} since ${esc(String(p.open.openedAt || "").slice(0, 16).replace("T", " "))} UTC`);
      else if (p.quiet) L.push(`  waiting: ${esc(p.quiet.text)}${p.quiet.stale ? " (stale: the brain may be down)" : ""}`);
    }
  }

  L.push("", "<b>Stages</b>");
  L.push(facts.stages ? esc(groupStages(facts.stages).join(" · ")) : "Scoreboard unread right now: no stage claims.");

  if (facts.receivers) {
    const r = facts.receivers;
    const parts = [];
    if (r.usdc > 0) parts.push(`${r.usdc.toFixed(2)} USDC`);
    if (r.nexus > 0) parts.push(`${r.nexus >= 1e6 ? `${(r.nexus / 1e6).toFixed(2)}M` : Math.round(r.nexus).toLocaleString("en-US")} $NEXUS`);
    if (r.eth > 0) parts.push(`${r.eth.toFixed(4)} ETH`);
    L.push("", "<b>Receivers, not swept</b>");
    if (parts.length) L.push(`${parts.join(" · ")}.`);
    else if (!r.unread) L.push("Nothing waiting.");
    // Name what couldn't be read (a failed read is never a zero), so a broken source shows which one it is.
    if (r.unread) L.push(`Unread: ${esc(unreadList(r))}.`);
    if (r.usdc >= SWEEP_NUDGE_USDC) L.push("Worth a sweep to the treasury Safe when you're ready. Nothing moves on its own.");
  }
  if (facts.boardAsOf) L.push("", `Scoreboard as of ${esc(String(facts.boardAsOf).slice(11, 16))} UTC.`);
  return L.join("\n");
}

/** Is the daily digest due on this run? (the first run at or after DIGEST_HOUR_UTC each UTC day) */
export function digestDue(nowMs, sentToday) {
  return !sentToday && new Date(nowMs).getUTCHours() >= DIGEST_HOUR_UTC;
}

const RECEIVER_NAMES = { subs: "subs receiver", x402: "Bankr wallet", fees: "borst.eth", near: "NEAR Intents" };
const CHAIN_NAMES = { arb: "Arbitrum", base: "Base", eth: "Ethereum", sol: "Solana", btc: "Bitcoin" };

/**
 * Receivers' unswept holdings from a readRevenue() result (revenue.mjs): tokens only, summed across every group
 * but the treasury Safe. Stablecoins are exact; $NEXUS and ETH are shown in tokens, never priced here.
 */
function unreadList(r) {
  const rows = r.unreadRows || [];
  if (!rows.length) return `${r.unread} balance(s)`;
  if (rows.length > 6) return `${rows.slice(0, 6).join(", ")} and ${rows.length - 6} more`;
  return rows.join(", ");
}

export function receiversFrom(rev) {
  if (!rev?.groups) return null;
  const out = { usdc: 0, nexus: 0, eth: 0, unread: 0, unreadRows: [] };
  for (const g of rev.groups) {
    if (g.id === "treasury") continue;
    for (const row of g.rows || []) {
      if (row.amount == null) { out.unread++; out.unreadRows.push(`${RECEIVER_NAMES[g.id] || g.id} ${row.sym} on ${CHAIN_NAMES[row.chain] || row.chain}`); continue; }
      if (row.sym === "USDC") out.usdc += row.amount;
      else if (row.sym === "NEXUS" || row.sym === "$NEXUS") out.nexus += row.amount;
      else if (row.sym === "ETH" || row.sym === "WETH") out.eth += row.amount;
    }
  }
  return out;
}
