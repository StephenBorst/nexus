// ── Share cards (1200×630 SVG → PNG via resvg in index.js) ──────────────────────────────
// Moved out of index.js unchanged in shape so the brand test can render every card with
// fixtures and fail any colour that isn't the brand's (brand.test.mjs). Colours come from
// app/lib/brand.mjs — the rule is in docs/brand.md: black surfaces, bone type, a bone
// accent mark, and green/red ONLY on money (P&L, WIN/LOSS, price moves, Buy/Sell).
import { BRAND, cardTopRule } from "../../app/lib/brand.mjs";
import { identityCardModel } from "../../app/lib/identityCard.mjs";

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildBoardOgSvg(rows, asOf, { fontFamily = "'Courier New', Courier, monospace" } = {}) {
  const { bone: BONE, bright: BRIGHT, muted: MUT, faint: FAINT, canvas: BG, border: BORD, borderStrong: BORD2, brand: MARK } = BRAND;
  // A play is a direction, not money, so it reads monochrome: a real FADE in bone, anything
  // else muted (a WATCH row must LOOK like WATCH). The direction is in the words ("FADE LONG").
  const playCol = (play) => (play.klass === "FADE" ? BRIGHT : MUT);
  // Each lens cell says its side as a letter; an empty lens is an empty outline.
  const lensCell = (v, x, y) => (v === "LONG" || v === "SHORT")
    ? `<rect x="${x}" y="${y - 17}" width="22" height="22" rx="4" fill="${BORD2}"/><text x="${x + 11}" y="${y}" fill="${BONE}" font-size="14" font-weight="bold" text-anchor="middle">${v === "LONG" ? "L" : "S"}</text>`
    : `<rect x="${x + 0.5}" y="${y - 16.5}" width="21" height="21" rx="4" fill="none" stroke="${BORD}"/>`;
  const lensCols = [{ k: "smart", x: 636 }, { k: "catalyst", x: 706 }, { k: "forecast", x: 776 }];
  const body = (rows || []).slice(0, 6).map((r, i) => {
    const y = 306 + i * 46;
    const dc = playCol(r.play);
    const strong = r.play.strong && r.agree >= 2;
    const rects = lensCols.map(({ k, x }) => lensCell(r.lens[k], x, y)).join("");
    const accent = strong ? `<rect x="40" y="${y - 24}" width="4" height="36" fill="${MARK}"/>` : "";
    return `${accent}
    <text x="60" y="${y}" fill="${BONE}" font-size="28" font-weight="bold">${esc(r.coin)}</text>
    <circle cx="234" cy="${y - 9}" r="6" fill="${dc}"/>
    <text x="250" y="${y}" fill="${dc}" font-size="23" font-weight="bold">${esc(r.play.label)}</text>
    ${rects}
    <text x="1044" y="${y}" fill="${strong ? BRIGHT : r.agree >= 1 ? BONE : FAINT}" font-size="23" font-weight="bold">${r.play.dir ? `${r.agree}/3` : "—"}</text>`;
  }).join("");
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${BG}"/>
  ${cardTopRule()}
  <text x="60" y="54" fill="${FAINT}" font-size="15" letter-spacing="4">NEXUS TRADING LABS</text>
  <text x="1140" y="54" fill="${FAINT}" font-size="15" text-anchor="end">trade.nexustradinglabs.com/lab</text>
  <text x="60" y="126" fill="${MUT}" font-size="16" letter-spacing="6">THE BOARD · LIVE READ</text>
  <text x="60" y="174" fill="${BONE}" font-size="44" font-weight="bold">Every market, one read</text>
  <text x="60" y="210" fill="${MUT}" font-size="16">FADE only when funding is stretched vs its own range — and how many independent reads confirm it.</text>
  <text x="60" y="266" fill="${FAINT}" font-size="13" letter-spacing="2">MARKET</text>
  <text x="250" y="266" fill="${FAINT}" font-size="13" letter-spacing="2">THE PLAY</text>
  <text x="647" y="266" fill="${FAINT}" font-size="12" text-anchor="middle">Sm</text>
  <text x="717" y="266" fill="${FAINT}" font-size="12" text-anchor="middle">Ct</text>
  <text x="787" y="266" fill="${FAINT}" font-size="12" text-anchor="middle">Fc</text>
  <text x="1044" y="266" fill="${FAINT}" font-size="13" letter-spacing="2">CONFIRM</text>
  <line x1="60" y1="278" x2="1140" y2="278" stroke="${BORD}" stroke-width="1"/>
  ${body}
  <line x1="60" y1="584" x2="1140" y2="584" stroke="${BORD}" stroke-width="1"/>
  <text x="60" y="610" fill="${FAINT}" font-size="14">Public facts. The play is a mechanical rule, not graded yet. Not advice.</text>
  <text x="1140" y="610" fill="${FAINT}" font-size="14" text-anchor="end">${esc(asOf || "")}</text>
</svg>`;
}

// ── FUNDING-TICKET share card — one coin's frozen verdict, as a branded image ──
// Grok's rules: shows the READ ONLY (verdict · funding %/yr · in-band vs stretched · crowd
// stance · lens states), NEVER E[R]/stops/edge (Draft doesn't write a real thesis yet). A
// WATCH card must LOOK like WATCH (muted), not a soft fade. Green stays profit-only, so the
// FADE accent is BONE, not green. Server-computed from the same p25–p75 pierce test as the
// ticket → the card can't drift from what the user sees.
export function buildReadOgSvg(p, { fontFamily = "'Courier New', Courier, monospace" } = {}) {
  const { bone: BONE, muted: MUT, faint: FAINT, fog: FOG, canvas: BG, border: BORD, surface: SURF } = BRAND;
  const isFade = p.verdict === "FADE";
  const accent = isFade ? BONE : MUT;                 // FADE = bone, WATCH = muted (looks like WATCH)
  const fadeDir = p.direction === "SHORT" ? "SHORT" : p.direction === "LONG" ? "LONG" : null;
  const crowdSide = p.direction === "SHORT" ? "long" : p.direction === "LONG" ? "short" : null;
  const verdictLabel = p.verdict === "NONE" ? "BALANCED" : isFade ? `◆ FADE ${fadeDir}` : "◆ WATCHING";
  const stanceLabel = p.direction === "SHORT" ? "Crowd over-long" : p.direction === "LONG" ? "Crowd over-short" : "Balanced";
  const fundingTxt = `${p.fundingAnnualPct >= 0 ? "+" : ""}${p.fundingAnnualPct}%/yr`;
  const stretchSub = isFade
    ? `Funding has pierced its own typical range — the crowd is stretched ${crowdSide}.`
    : p.verdict === "NONE"
    ? "Funding is close to balanced — no clear crowd to fade."
    : `Funding is elevated but within its own typical range — no crowd extreme to fade yet.`;
  // two lens cells (Crowd + Smart$) — both from the cheap board row; empty looks empty.
  const smSide = p.smartMoney && (p.smartMoney.side === "LONG" || p.smartMoney.side === "SHORT") ? p.smartMoney.side : null;
  const smWith = isFade && smSide && fadeDir ? (smSide === fadeDir) : null;
  const lensCell = (x, label, val, tag, tagCol) => `
    <rect x="${x}" y="404" width="510" height="96" rx="8" fill="${SURF}" stroke="${BORD}"/>
    <text x="${x + 22}" y="438" fill="${FAINT}" font-size="14" letter-spacing="2">${esc(label)}</text>
    <text x="${x + 22}" y="474" fill="${BONE}" font-size="24" font-weight="bold">${esc(val)}</text>
    ${tag ? `<text x="${x + 488}" y="438" fill="${tagCol}" font-size="14" font-weight="bold" text-anchor="end">${esc(tag)}</text>` : ""}`;
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${BG}"/>
  ${cardTopRule()}
  <text x="60" y="54" fill="${FAINT}" font-size="15" letter-spacing="4">NEXUS TRADING LABS · FUNDING EDGE</text>
  <text x="1140" y="54" fill="${FAINT}" font-size="15" text-anchor="end">trade.nexustradinglabs.com/lab</text>
  <text x="60" y="150" fill="${BONE}" font-size="64" font-weight="bold">${esc(p.coin)}</text>
  <text x="${60 + String(p.coin).length * 42 + 20}" y="150" fill="${FOG}" font-size="30">$${esc(p.markPrice)}</text>
  <rect x="60" y="188" width="${16 + verdictLabel.length * 20}" height="46" rx="8" fill="${SURF}" stroke="${accent}" stroke-opacity="0.5"/>
  <text x="80" y="219" fill="${accent}" font-size="26" font-weight="bold" letter-spacing="1">${esc(verdictLabel)}</text>
  <text x="${96 + verdictLabel.length * 20}" y="219" fill="${MUT}" font-size="20">${esc(stanceLabel)}</text>
  <text x="60" y="290" fill="${MUT}" font-size="16" letter-spacing="4">FUNDING EDGE</text>
  <text x="60" y="340" fill="${BONE}" font-size="44" font-weight="bold">${esc(fundingTxt)}</text>
  ${p.hist ? `<text x="1140" y="340" fill="${FOG}" font-size="24" text-anchor="end">HIST ${esc(String(p.hist.pct))}% · n=${esc(String(p.hist.n))}</text>` : ""}
  <text x="60" y="376" fill="${FOG}" font-size="17">${esc(stretchSub)}</text>
  ${lensCell(60, "CROWD (FUNDING)", `paying to be ${crowdSide || "balanced"}`, isFade && fadeDir ? `FADE ${fadeDir}` : "", accent)}
  ${lensCell(630, "SMART $", smSide ? `${p.smartMoney.count} sharp${p.smartMoney.count === 1 ? "" : "s"} ${smSide}` : "no read", smWith == null ? "" : (smWith ? "WITH THE FADE" : "AGAINST"), smWith ? BONE : MUT)}
  <line x1="60" y1="560" x2="1140" y2="560" stroke="${BORD}" stroke-width="1"/>
  <text x="60" y="590" fill="${FAINT}" font-size="15">A positioning read from public funding, not graded yet. A stretched market can stay stretched. Not advice.</text>
</svg>`;
}

// ── The TRADING IDENTITY card ─────────────────────────────────────────────────
// The shareable poster of a trader's GRADED record. Every word comes from identityCardModel
// (app/lib/identityCard.mjs), the same module the /share/identity preview text and the profile's
// "Post on X" use, so the three can't disagree.
// ⚠️ No placeholder rank chip: the chip shows only when the grader gave a merit rank. A cold-start
// card says plainly how many graded calls there are and how many the caller board needs.
export function buildIdentitySvg({ profile, record, wallet, displayName, fontFamily = "'JetBrains Mono'" }) {
  const { bone: BONE, bright: BRIGHT, muted: MUTED, faint: FAINT, fog: FOG, win: POS, loss: NEG, border: BORDER, panel: PANEL, canvas: CANVAS, brand: MARK } = BRAND;
  const shortAddr = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const name = esc(displayName || shortAddr);
  const m = identityCardModel({ profile, record });

  const rankW = m.rank ? m.rank.length * 15 + 40 : 0;
  const rankSvg = m.rank ? `
  <rect x="${1152 - rankW}" y="60" width="${rankW}" height="40" fill="none" stroke="${BONE}" stroke-width="1.5" rx="6"/>
  <text x="${1152 - rankW / 2}" y="86" fill="${BONE}" font-size="17" font-weight="bold" letter-spacing="1" text-anchor="middle">${esc(m.rank)}</text>` : "";

  // Scale the headline down if long so it never overruns the 1104px content width.
  const hSize = Math.min(58, Math.floor(1090 / (Math.max(m.headline.length, 1) * 0.6)));
  const toneColor = (t) => (t === "pos" ? POS : t === "neg" ? NEG : BRIGHT);
  const colX = [96, 500, 872];
  const statSvg = m.stats.slice(0, 3).map((st, i) => `
  <text x="${colX[i]}" y="452" fill="${FAINT}" font-size="15" letter-spacing="2">${esc(st.label)}</text>
  <text x="${colX[i]}" y="500" fill="${st.value === "—" ? FAINT : toneColor(st.tone)}" font-size="40" font-weight="bold">${esc(st.value)}</text>
  <text x="${colX[i]}" y="524" fill="${MUTED}" font-size="14">${esc(st.sub)}</text>`).join("");

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${MARK}" rx="1"/>

  <!-- header -->
  <text x="48" y="86" fill="${BRIGHT}" font-size="24" font-weight="bold" letter-spacing="4">// THE LAB</text>
  <text x="48" y="112" fill="${MUTED}" font-size="15" letter-spacing="2">TRADING IDENTITY · NEXUS</text>${rankSvg}

  <line x1="48" y1="150" x2="1152" y2="150" stroke="${BORDER}" stroke-width="1"/>

  <!-- headline + the record in parts -->
  <text x="48" y="250" fill="${BRIGHT}" font-size="${hSize}" font-weight="bold">${esc(m.headline)}</text>
  <text x="48" y="304" fill="${BONE}" font-size="22">${esc(m.recordLine)}</text>
  ${m.readLine ? `<text x="48" y="340" fill="${FOG}" font-size="17">${esc(m.readLine.slice(0, 96))}</text>` : ""}

  <line x1="48" y1="372" x2="1152" y2="372" stroke="${BORDER}" stroke-width="1"/>

  <!-- stats -->${statSvg}

  <!-- footer -->
  <line x1="48" y1="556" x2="1152" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="590" fill="${MUTED}" font-size="15">${name} · verify → trade.nexustradinglabs.com</text>
  <text x="1152" y="590" fill="${FAINT}" font-size="14" text-anchor="end">graded from public price, not self-reported</text>
</svg>`;
}

// ── Ph22: Thesis OG SVG ───────────────────────────────────────────────────────
// This card is the most public brand surface we have — it's what unfurls when a call is
// shared to X. It was still on the RETIRED palette (#0a0e0a green-tinted black, #00ff88
// terminal green, #4a9fff blue, green-tinted greys). Now monochrome, matching the app:
// bone/greys for structure, and chroma ONLY where it carries meaning (green=profit/up,
// red=loss/down, amber=caution).
//
// `chartDataUri` is optional and already SSRF-gated + size-capped by fetchChartDataUri().
// With a chart we run a two-column layout; without one we keep the full-width layout so
// the card never has a dead half.
export function buildThesisOgSvg({ displayName, wallet, ticker, direction, entryPrice, stopLoss, takeProfit1, riskReward, status, gradedR = null, runnerStopped = false, notes, chartDataUri = null, fontFamily = "'Courier New', Courier, monospace" }) {
  const shortAddr = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  const name = esc(displayName || shortAddr);
  const { canvas, panel, border, bright, bone, fog, muted, faint, win, loss } = BRAND;
  // Direction, levels, R:R and an open status are a PLAN, not money → monochrome. Only the
  // graded outcome (WIN / LOSS, its R, HIT TP / STOPPED OUT) carries green / red.
  const dirColor = bright;
  const dirArrow = direction === "LONG" ? "↑" : "↓";
  const rrColor = bright;
  // NOT_GRADED = the grader can never grade this call (callMath.mjs callInvalidReason): no money, monochrome.
  const statusMap = { HIT_TP: "HIT TP ✓", STOPPED_OUT: "STOPPED OUT", ACTIVE: "ACTIVE", INVALIDATED: "INVALIDATED", NOT_GRADED: "NOT GRADED" };
  const statusColorMap = { HIT_TP: win, STOPPED_OUT: loss, ACTIVE: bone, INVALIDATED: muted, NOT_GRADED: muted };
  const statusLabel = statusMap[status] || status;
  const statusColor = statusColorMap[status] || fog;
  const notesLine = notes ? esc(String(notes).slice(0, chartDataUri ? 46 : 90)) : "";

  // Level block — positions differ between the one- and two-column layouts.
  const lvl = (x, y, label, value, color) => `
  <text x="${x}" y="${y}" fill="${faint}" font-size="12" letter-spacing="3">${label}</text>
  <text x="${x}" y="${y + 62}" fill="${color}" font-size="${chartDataUri ? 40 : 52}" font-weight="bold">${value}</text>`;

  const money = (v) => `$${parseFloat(v).toFixed(2)}`;

  const levels = chartDataUri
    // two-column: 2x2 on the left, chart panel on the right
    ? lvl(60, 312, "ENTRY", money(entryPrice), bright)
      + lvl(300, 312, "STOP", money(stopLoss), bright)
      + lvl(60, 430, "TP1", money(takeProfit1), bright)
      + lvl(300, 430, "R:R", `1:${parseFloat(riskReward).toFixed(2)}`, rrColor)
    // full-width: single row of four
    : lvl(60, 312, "ENTRY", money(entryPrice), bright)
      + lvl(360, 312, "STOP", money(stopLoss), bright)
      + lvl(660, 312, "TP1", money(takeProfit1), bright)
      + lvl(960, 312, "R:R", `1:${parseFloat(riskReward).toFixed(2)}`, rrColor);

  const chartPanel = chartDataUri ? `
  <rect x="596" y="286" width="556" height="330" fill="${panel}" stroke="${border}" stroke-width="1" rx="4"/>
  <image x="604" y="294" width="540" height="314" href="${chartDataUri}" preserveAspectRatio="xMidYMid meet"/>` : "";

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${canvas}"/>
  ${cardTopRule()}
  <rect y="627" width="1200" height="3" fill="${border}"/>
  <text x="48" y="54" fill="${muted}" font-size="13" letter-spacing="3">NEXUS TRADING LABS</text>
  <text x="1152" y="54" fill="${muted}" font-size="13" text-anchor="end">trade.nexustradinglabs.com</text>
  <text x="48" y="180" fill="${bright}" font-size="86" font-weight="bold">${esc(ticker)}</text>
  <text x="48" y="232" fill="${dirColor}" font-size="32" font-weight="bold">${dirArrow} ${esc(direction)}</text>
  ${(() => {
    // Resolved calls HERO the graded R result — the scroll-stopping proof ("+2R,
    // graded on-chain"), not a 22px corner label. Unresolved keep the calm status.
    const resolved = (status === "HIT_TP" || status === "STOPPED_OUT") && gradedR != null;
    if (resolved) {
      // A split whose runner was stopped (callMath.mjs splitRunnerStopped): half at TP1, half on the
      // stop. The headline keeps its WIN / LOSS and R; the line under it says how it closed.
      const won = status === "HIT_TP";
      const rTxt = `${gradedR >= 0 ? "+" : ""}${Math.round(gradedR * 100) / 100}R`;
      return `<text x="1152" y="162" fill="${won ? win : loss}" font-size="60" font-weight="bold" text-anchor="end">${won ? "✓ WIN" : "✗ LOSS"} ${rTxt}</text>
  <text x="1152" y="196" fill="${muted}" font-size="15" text-anchor="end">${runnerStopped ? "GRADED · TP1 HIT, RUNNER STOPPED" : "GRADED · first-touch vs public price"}</text>
  <text x="1152" y="228" fill="${fog}" font-size="14" text-anchor="end">${name}</text>
  <text x="1152" y="248" fill="${muted}" font-size="12" text-anchor="end">${esc(shortAddr)}</text>`;
    }
    return `<text x="1152" y="180" fill="${statusColor}" font-size="22" font-weight="bold" text-anchor="end">${statusLabel}</text>
  <text x="1152" y="214" fill="${fog}" font-size="14" text-anchor="end">${name}</text>
  <text x="1152" y="234" fill="${muted}" font-size="12" text-anchor="end">${esc(shortAddr)}</text>`;
  })()}
  <line x1="48" y1="270" x2="1152" y2="270" stroke="${border}" stroke-width="1"/>
  ${levels}
  ${chartPanel}
  ${notesLine ? `<text x="48" y="${chartDataUri ? 556 : 464}" fill="${fog}" font-size="16" font-style="italic">"${notesLine}"</text>` : ""}
  ${chartDataUri ? "" : `<line x1="48" y1="530" x2="1152" y2="530" stroke="${border}" stroke-width="1"/>`}
  <text x="48" y="592" fill="${muted}" font-size="13" letter-spacing="1">graded from public price · anchored on arbitrum</text>
  ${chartDataUri ? "" : `<text x="1152" y="592" fill="${faint}" font-size="13" text-anchor="end">${esc(wallet)}</text>`}
</svg>`;
}

// ── Arena agent card (/og/arena) ──────────────────────────────────────────────
// PAPER record only (the OG path never reads Supabase). Green/red = money (net P&L)
// only; trades, win rate, qualify and resets stay monochrome. Built ONLY for an
// agent with at least one graded paper close; the route 404s otherwise.
export function buildArenaAgentSvg({ name, builder = "", wallet, paper, operator = null, fontFamily = "'JetBrains Mono'" }) {
  const { bone: BONE, bright: BRIGHT, muted: MUTED, faint: FAINT, fog: FOG, win: POS, loss: NEG, border: BORDER, panel: PANEL, canvas: CANVAS, brand: MARK } = BRAND;
  const esc = (t) => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const shortAddr = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const trades = paper.trades;
  const net = paper.netPnl;
  const netTxt = `${net < 0 ? "-" : "+"}$${Math.abs(net).toFixed(2)}`;
  const crit = (paper.qualify?.criteria || []).find((c) => c.key === "trades");
  const qualifyTxt = paper.qualify?.eligible
    ? "QUALIFIED FOR THE BOARD"
    : crit && !crit.met
      ? `${crit.value} OF ${crit.target} TRADES TO QUALIFY`
      : "NEEDS 3+ ACTIVE DAYS OR NET-POSITIVE P&L";
  const resets = paper.resets ? `${paper.resets} RESET${paper.resets === 1 ? "" : "S"} ON RECORD` : "NO RESETS ON RECORD";
  // A wallet in an operator's group: name the whole slot so one winning wallet can't stand in for it.
  const op = operator && operator.walletCount > 1 && operator.paper ? operator.paper : null;
  const opLine = op
    ? `1 OF ${operator.walletCount} WALLETS · OPERATOR SLOT: ${op.trades} TRADES · NET ${op.netPnl < 0 ? "-" : "+"}$${Math.abs(op.netPnl).toFixed(2)}`
    : "";
  const cells = [
    ["CLOSED TRADES", String(trades), `${paper.wins} wins`, BRIGHT],
    ["WIN RATE", `${paper.winRate}%`, `profit factor ${paper.profitFactor}`, BRIGHT],
    ["NET P&L (PAPER)", netTxt, `${paper.daysActive} active day${paper.daysActive === 1 ? "" : "s"}`, net >= 0 ? POS : NEG],
  ];
  const colX = [96, 500, 872];
  const cellSvg = cells.map(([lab, val, sub, col], i) => `
  <text x="${colX[i]}" y="332" fill="${FAINT}" font-size="15" letter-spacing="2">${esc(lab)}</text>
  <text x="${colX[i]}" y="380" fill="${col}" font-size="40" font-weight="bold">${esc(val)}</text>
  <text x="${colX[i]}" y="404" fill="${MUTED}" font-size="14">${esc(sub)}</text>`).join("");
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${MARK}" rx="1"/>
  <text x="48" y="86" fill="${BRIGHT}" font-size="24" font-weight="bold" letter-spacing="4">// NEXUS ARENA</text>
  <text x="48" y="112" fill="${MUTED}" font-size="15" letter-spacing="2">AI TRADING AGENT · PAPER RECORD</text>
  <line x1="48" y1="150" x2="1152" y2="150" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="236" fill="${BRIGHT}" font-size="${Math.min(58, Math.floor(1000 / (Math.max(name.length, 1) * 0.6)))}" font-weight="bold">${esc(name)}</text>
  <text x="48" y="276" fill="${FOG}" font-size="18">${esc(builder ? `built by ${builder} · ${shortAddr}` : shortAddr)}</text>
  <line x1="48" y1="300" x2="1152" y2="300" stroke="${BORDER}" stroke-width="1"/>
  ${cellSvg}
  <text x="48" y="456" fill="${BONE}" font-size="20">${esc(qualifyTxt)}</text>
  <text x="48" y="488" fill="${MUTED}" font-size="15">${esc(resets)}</text>
  ${opLine ? `<text x="48" y="520" fill="${FOG}" font-size="15">${esc(opLine)}</text>` : ""}
  <line x1="48" y1="556" x2="1152" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="590" fill="${MUTED}" font-size="15">${esc(name)} · verify → trade.nexustradinglabs.com/arena</text>
  <text x="1152" y="590" fill="${FAINT}" font-size="14" text-anchor="end">fills graded by the exec engine, not self-reported</text>
</svg>`;
}
