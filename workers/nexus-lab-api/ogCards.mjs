// ── Share cards (1200×630 SVG → PNG via resvg in index.js) ──────────────────────────────
// Moved out of index.js unchanged in shape so the brand test can render every card with
// fixtures and fail any colour that isn't the brand's (brand.test.mjs). Colours come from
// app/lib/brand.mjs — the rule is in docs/brand.md: black surfaces, bone type, a blue
// accent mark, and green/red ONLY on money (P&L, WIN/LOSS, price moves, Buy/Sell).
import { BRAND, cardTopRule } from "../../app/lib/brand.mjs";

function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildOgSvg({ displayName, wallet, wins, losses, active, total, avgRR, winRate, rep, fontFamily = "'Courier New', Courier, monospace" }) {
  const { canvas, border, bright, muted, faint, win, loss } = BRAND;
  const shortAddr = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  const name = esc(displayName || shortAddr);
  const closed = wins + losses;
  // Rep score, win rate, R:R and the active count are grades and counts, not money → bone.
  // The W / L tally is the one win/loss number on the card, so it carries green / red.
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <style>text { font-family: ${fontFamily}; }</style>
  </defs>
  <rect width="1200" height="630" fill="${canvas}"/>
  ${cardTopRule()}

  <!-- Branding -->
  <text x="48" y="54" fill="${faint}" font-size="13" letter-spacing="3">NEXUS TRADING LABS</text>
  <text x="1152" y="54" fill="${faint}" font-size="13" letter-spacing="1" text-anchor="end">trade.nexustradinglabs.com</text>

  <!-- Trader identity -->
  <text x="48" y="170" fill="${bright}" font-size="54" font-weight="bold">${name}</text>
  <text x="48" y="210" fill="${muted}" font-size="18">${esc(shortAddr)}</text>
  <text x="48" y="240" fill="${faint}" font-size="14">${total} thesis${total !== 1 ? "es" : ""} published on-chain</text>

  <!-- REP Score (right column) -->
  <text x="980" y="130" fill="${muted}" font-size="13" letter-spacing="4" text-anchor="middle">REP SCORE</text>
  <text x="980" y="265" fill="${bright}" font-size="148" font-weight="bold" text-anchor="middle">${closed > 0 ? rep : "-"}</text>

  <!-- Divider -->
  <line x1="48" y1="310" x2="1152" y2="310" stroke="${border}" stroke-width="1"/>

  <!-- Stats row -->
  <text x="60" y="358" fill="${muted}" font-size="12" letter-spacing="3">WIN RATE</text>
  <text x="60" y="412" fill="${bright}" font-size="48" font-weight="bold">${winRate !== null ? winRate + "%" : "-"}</text>

  <text x="310" y="358" fill="${muted}" font-size="12" letter-spacing="3">W / L</text>
  <text x="310" y="412" font-size="48" font-weight="bold"><tspan fill="${win}">${wins}</tspan><tspan fill="${faint}"> / </tspan><tspan fill="${loss}">${losses}</tspan></text>

  <text x="570" y="358" fill="${muted}" font-size="12" letter-spacing="3">AVG R:R</text>
  <text x="570" y="412" fill="${bright}" font-size="48" font-weight="bold">1:${avgRR.toFixed(1)}</text>

  <text x="830" y="358" fill="${muted}" font-size="12" letter-spacing="3">ACTIVE</text>
  <text x="830" y="412" fill="${active > 0 ? bright : faint}" font-size="48" font-weight="bold">${active}</text>

  <!-- Bottom tag -->
  <line x1="48" y1="468" x2="1152" y2="468" stroke="${border}" stroke-width="1"/>
  <text x="48" y="512" fill="${muted}" font-size="13" letter-spacing="1">on-chain verified · arbitrum</text>
  <text x="1152" y="512" fill="${faint}" font-size="13" text-anchor="end">${esc(wallet)}</text>
</svg>`;
}

// ── THE BOARD share card — the live confluence read, as a branded OG image ────
// The distribution flywheel: turn the Lab's flagship read into a beautiful, verifiable,
// shareable card that unfurls on X/Farcaster and links back. Monochrome-editorial to match
// the brand (bone type, blue accent mark; plays read in words, not green/red). Each row = a market's mechanical PLAY +
// how many independent lenses (smart · catalysts · forecasters) confirm it. Rows already
// ranked by boardCardRows; a strong confluence (agree≥2) gets a brand-blue left mark.
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
  <text x="60" y="610" fill="${FAINT}" font-size="14">Public facts. The play is mechanical, graded from the tape after — not advice.</text>
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
  <text x="60" y="590" fill="${FAINT}" font-size="15">A positioning read from public funding — graded on Nexus. A stretched market can stay stretched. Not advice.</text>
</svg>`;
}

// ── The TRADING IDENTITY card ─────────────────────────────────────────────────
// The shareable artifact: a poster of the Operator Profile. Everything on it is
// GRADED from public price, so the share itself markets the moat — a self-reported
// card can't make the same claim. Composed from buildOperatorProfile so the poster
// can never disagree with the profile page it depicts.
//
// ⚠️ Cold-start dignity is a REQUIREMENT, not a nicety. Most early cards have <5
// graded calls, so instead of showing dashes it pivots to a "building a provable
// record" framing — which is itself a hook ("watch me build it in public") rather
// than an empty template. A card that looks broken at cold start would be worse than
// none, because this is the thing people post.
export function buildIdentitySvg({ profile, wallet, displayName, fontFamily = "'JetBrains Mono'" }) {
  const { bone: BONE, bright: BRIGHT, muted: MUTED, faint: FAINT, fog: FOG, win: POS, loss: NEG, border: BORDER, panel: PANEL, canvas: CANVAS, brand: MARK } = BRAND;
  const shortAddr = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
  const name = esc(displayName || shortAddr);
  const established = profile.tier !== "UNKNOWN" && !!profile.archetype;
  const merit = profile.meritRank; // { glyph, title } | null

  // Merit pill (top-right). Earned rank when present, else an honest "building" chip.
  const rankText = merit ? `${merit.glyph} ${String(merit.title).toUpperCase()}` : "▪ BUILDING";
  const rankW = rankText.length * 15 + 40;

  // The headline line: archetype when we have one, else the cold-start framing.
  const headline = established
    ? profile.archetype.label.toUpperCase()
    : "BUILDING A PROVABLE RECORD";
  // Scale the headline down if long so it never overruns the 1104px content width.
  const hSize = Math.min(58, Math.floor(1090 / (Math.max(headline.length, 1) * 0.6)));

  // One-liner under the headline.
  const re = profile.reads?.find((r) => r.kind === "REGIME");
  const subline = established
    ? (re ? esc(re.text.charAt(0).toUpperCase() + re.text.slice(1)).slice(0, 92)
          : `${profile.gradedCalls} calls graded from public price`)
    : `${profile.gradedCalls} graded call${profile.gradedCalls === 1 ? "" : "s"} in · every one scored from public price, not self-reported`;

  // Three stats. Established → the real numbers; cold-start → a progress framing so
  // the row never shows a wall of em-dashes.
  const stats = established
    ? profile.headline.filter((h) => h.key !== "leak").map((h) => ({
        label: h.label.toUpperCase(),
        value: h.value ?? "—",
        color: h.tone === "pos" ? POS : h.tone === "neg" ? NEG : BRIGHT,
        sub: h.sub,
      }))
    : [
        { label: "GRADED CALLS", value: String(profile.gradedCalls), color: BRIGHT, sub: "resolved vs public price" },
        { label: "TO RANK UP", value: `${Math.max(0, 5 - profile.gradedCalls)}`, color: BONE, sub: "calls to Signal tier" },
        { label: "SELF-REPORTED", value: "0", color: BRIGHT, sub: "nothing here is claimed" },
      ];
  const colX = [96, 500, 872];
  const statSvg = stats.map((st, i) => `
  <text x="${colX[i]}" y="452" fill="${FAINT}" font-size="15" letter-spacing="2">${esc(st.label)}</text>
  <text x="${colX[i]}" y="500" fill="${st.color}" font-size="40" font-weight="bold">${esc(st.value)}</text>
  <text x="${colX[i]}" y="524" fill="${MUTED}" font-size="14">${esc(st.sub)}</text>`).join("");

  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; }</style></defs>
  <rect width="1200" height="630" fill="${CANVAS}"/>
  <rect x="16" y="16" width="1168" height="598" fill="${PANEL}" stroke="${BORDER}" stroke-width="1" rx="10"/>
  <rect x="16" y="16" width="1168" height="3" fill="${MARK}" rx="1"/>

  <!-- header -->
  <text x="48" y="86" fill="${BRIGHT}" font-size="24" font-weight="bold" letter-spacing="4">// THE LAB</text>
  <text x="48" y="112" fill="${MUTED}" font-size="15" letter-spacing="2">TRADING IDENTITY · NEXUS</text>
  <rect x="${1152 - rankW}" y="60" width="${rankW}" height="40" fill="none" stroke="${BONE}" stroke-width="1.5" rx="6"/>
  <text x="${1152 - rankW / 2}" y="86" fill="${BONE}" font-size="17" font-weight="bold" letter-spacing="1" text-anchor="middle">${esc(rankText)}</text>

  <line x1="48" y1="150" x2="1152" y2="150" stroke="${BORDER}" stroke-width="1"/>

  <!-- headline -->
  <text x="48" y="256" fill="${BRIGHT}" font-size="${hSize}" font-weight="bold">${esc(headline)}</text>
  <text x="48" y="312" fill="${FOG}" font-size="20">${subline}</text>

  <line x1="48" y1="372" x2="1152" y2="372" stroke="${BORDER}" stroke-width="1"/>

  <!-- stats -->${statSvg}

  <!-- footer -->
  <line x1="48" y1="556" x2="1152" y2="556" stroke="${BORDER}" stroke-width="1"/>
  <text x="48" y="590" fill="${MUTED}" font-size="15">${name} · verify → trade.nexustradinglabs.com</text>
  <text x="1152" y="590" fill="${FAINT}" font-size="14" text-anchor="end">every number graded from public price</text>
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
export function buildThesisOgSvg({ displayName, wallet, ticker, direction, entryPrice, stopLoss, takeProfit1, riskReward, status, gradedR = null, notes, chartDataUri = null, fontFamily = "'Courier New', Courier, monospace" }) {
  const shortAddr = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  const name = esc(displayName || shortAddr);
  const { canvas, panel, border, bright, bone, fog, muted, faint, win, loss } = BRAND;
  // Direction, levels, R:R and an open status are a PLAN, not money → monochrome. Only the
  // graded outcome (WIN / LOSS, its R, HIT TP / STOPPED OUT) carries green / red.
  const dirColor = bright;
  const dirArrow = direction === "LONG" ? "↑" : "↓";
  const rrColor = bright;
  const statusMap = { HIT_TP: "HIT TP ✓", STOPPED_OUT: "STOPPED OUT", ACTIVE: "ACTIVE", INVALIDATED: "INVALIDATED" };
  const statusColorMap = { HIT_TP: win, STOPPED_OUT: loss, ACTIVE: bone, INVALIDATED: muted };
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
      const won = status === "HIT_TP";
      const rTxt = `${gradedR >= 0 ? "+" : ""}${Math.round(gradedR * 100) / 100}R`;
      return `<text x="1152" y="162" fill="${won ? win : loss}" font-size="60" font-weight="bold" text-anchor="end">${won ? "✓ WIN" : "✗ LOSS"} ${rTxt}</text>
  <text x="1152" y="196" fill="${muted}" font-size="15" text-anchor="end">GRADED · first-touch vs public price</text>
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
