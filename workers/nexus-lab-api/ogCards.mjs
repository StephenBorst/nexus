// ── Share cards (1200×630 SVG → PNG via resvg in index.js) ──────────────────────────────
// Moved out of index.js unchanged in shape so the brand test can render every card with
// fixtures and fail any colour that isn't the brand's (brand.test.mjs). Colours come from
// app/lib/brand.mjs — the rule is in docs/brand.md: black surfaces, bone type, a bone
// accent mark, and green/red ONLY on money (P&L, WIN/LOSS, price moves, Buy/Sell).
import { BRAND, cardTopRule } from "../../app/lib/brand.mjs";
import { identityCardModel } from "../../app/lib/identityCard.mjs";
import { MARK_PNG, MARK_W, MARK_H } from "./ogMark.mjs";

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

// ── The hero look (thesis + Arena cards, borst 2026-11-23) ────────────────────
// The two cards people share most now match the brand hero (public/embed-mini.png, tools/brand/previews.html):
// black canvas, the silk-light streak top right drawn with SVG gradients only (no grain: it bloats the PNG),
// the Nexus mark + "NEXUS TRADING LABS" on top, a serif headline (Libre Baskerville, bundled into the worker
// and passed to resvg beside JetBrains Mono), numbers in mono. Every stop colour is a brand colour; light is
// opacity only. Green/red stay on money: the graded WIN/LOSS and the Arena net P&L.
// The board and record cards keep the mono data look (borst: "stay mono for now").
const SERIF = "'Libre Baskerville', Georgia, serif";

// The streak: a soft sheen, a brighter core and a thin hairline, rotated like the landing's ribbon, kept in
// the top-right corner so no text sits on it, plus a faint low glow bottom left.
function heroLight() {
  const { bright, bone } = BRAND;
  const glow = (id, stops) => `<radialGradient id="${id}">${stops.map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`;
  return {
    defs: [
      `<radialGradient id="atmos" cx="0.86" cy="0.06" r="0.6">${[[0, bone, 0.07], [0.7, bone, 0]].map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`).join("")}</radialGradient>`,
      glow("sheen", [[0, bone, 0.085], [0.52, bone, 0.025], [0.74, bone, 0]]),
      glow("core", [[0, bright, 0.2], [0.48, bright, 0.055], [0.76, bright, 0]]),
      glow("edge", [[0, bright, 0.34], [0.55, bright, 0.06], [0.8, bright, 0]]),
      glow("low", [[0, bone, 0.05], [0.72, bone, 0]]),
    ].join(""),
    body: `<rect width="1200" height="630" fill="url(#atmos)"/>
  <ellipse cx="300" cy="660" rx="1100" ry="170" fill="url(#low)" transform="rotate(-17 300 660)"/>
  <ellipse cx="930" cy="10" rx="1100" ry="230" fill="url(#sheen)" transform="rotate(-17 930 10)"/>
  <ellipse cx="960" cy="34" rx="760" ry="44" fill="url(#core)" transform="rotate(-16 960 34)"/>
  <ellipse cx="940" cy="44" rx="440" ry="6.5" fill="url(#edge)" transform="rotate(-17 940 44)"/>`,
  };
}

// The mark + wordmark, as on the hero.
function heroBrandRow() {
  const h = 26, w = Math.round((h * MARK_W) / MARK_H);
  return `<image x="64" y="52" width="${w}" height="${h}" href="${MARK_PNG}"/>
  <text x="${64 + w + 14}" y="72" fill="${BRAND.fog}" font-size="14" letter-spacing="3.4">NEXUS TRADING LABS</text>`;
}

function heroSvg({ fontFamily, body }) {
  const light = heroLight();
  return `<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg">
  <defs><style>text { font-family: ${fontFamily}; } .serif { font-family: ${SERIF}; }</style>${light.defs}</defs>
  <rect width="1200" height="630" fill="${BRAND.canvas}"/>
  ${light.body}
  ${cardTopRule()}
  ${heroBrandRow()}
  ${body}
</svg>`;
}

// Size a serif headline to fit `width`. Libre Baskerville, measured in resvg: ~0.62em a lowercase glyph,
// ~0.78em a capital or digit, ~0.3em a space; 4% kept spare so a wide name never runs off the card.
export function serifSize(text, width, max) {
  const s = String(text);
  const ems = [...s].reduce((a, ch) => a + (/[A-Z0-9]/.test(ch) ? 0.78 : /\s/.test(ch) ? 0.3 : 0.62), 0);
  return Math.max(28, Math.min(max, Math.floor((width * 0.96) / Math.max(ems, 1))));
}

/**
 * A call's notes as at most `maxLines` lines of at most `maxChars` characters, broken between words, inside
 * curly quotes. Text that doesn't fit ends in "…" on the last line, at a word boundary (a single word longer
 * than a line is cut). Returns [] for empty notes.
 */
export function quoteLines(notes, maxChars, maxLines = 2) {
  const words = String(notes ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let cur = "";
  let i = 0;
  // Budget: the opening quote rides on line 1, the closing quote on the last line.
  for (; i < words.length; i++) {
    const room = maxChars - (lines.length === 0 ? 1 : 0) - 1;
    const w = words[i].length > room ? words[i].slice(0, room) : words[i];
    const next = cur ? `${cur} ${w}` : w;
    if (next.length <= room) { cur = next; continue; }
    if (lines.length + 1 >= maxLines) break;
    lines.push(cur);
    cur = w;
  }
  if (i < words.length) {
    // Doesn't fit: drop whole words from the end of the last line until "…" fits, then trim dangling punctuation.
    const room = maxChars - (lines.length === 0 ? 1 : 0) - 2;
    let parts = cur.split(" ");
    while (parts.length > 1 && parts.join(" ").length > room) parts.pop();
    let last = parts.join(" ");
    if (last.length > room) last = last.slice(0, room);
    cur = `${last.replace(/[\s,;:.\-–—]+$/, "")}…`;
  }
  lines.push(cur);
  lines[0] = `“${lines[0]}`;
  lines[lines.length - 1] = `${lines[lines.length - 1]}”`;
  return lines;
}

// A level on the card. Two decimals from $1 up (as before); under $1, four significant figures, so a
// 0.02-ish coin's entry, stop and target don't all print "$0.02".
export function cardPrice(v) {
  const n = parseFloat(v);
  if (!Number.isFinite(n)) return "$—";
  if (Math.abs(n) >= 1 || n === 0) return `$${n.toFixed(2)}`;
  return `$${String(Number(n.toPrecision(4)))}`;
}

// ── Ph22: Thesis OG SVG ───────────────────────────────────────────────────────
// The card that unfurls when a call is shared to X. Hero look since 2026-11-23 (above); before that a mono
// data card. Direction, levels, R:R and an open status are a PLAN, not money → monochrome. Only the graded
// outcome (WIN / LOSS, its R, HIT TP / STOPPED OUT) carries green / red.
//
// `chartDataUri` is optional and already SSRF-gated + size-capped by fetchChartDataUri(). With a chart the
// levels sit 2×2 on the left and the chart panel on the right; without one the levels run in one row.
export function buildThesisOgSvg({ displayName, wallet, ticker, direction, entryPrice, stopLoss, takeProfit1, riskReward, status, gradedR = null, runnerStopped = false, notes, chartDataUri = null, fontFamily = "'Courier New', Courier, monospace" }) {
  const shortAddr = `${wallet.slice(0, 6)}...${wallet.slice(-4)}`;
  const { panel, border, bright, bone, fog, muted, faint, win, loss } = BRAND;
  // NOT_GRADED = the grader can never grade this call (callMath.mjs callInvalidReason): no money, monochrome.
  const statusMap = { HIT_TP: "HIT TP ✓", STOPPED_OUT: "STOPPED OUT", ACTIVE: "ACTIVE", INVALIDATED: "INVALIDATED", NOT_GRADED: "NOT GRADED" };
  const statusColorMap = { HIT_TP: win, STOPPED_OUT: loss, ACTIVE: bone, INVALIDATED: muted, NOT_GRADED: muted };
  const statusLabel = statusMap[status] || status;
  const statusColor = statusColorMap[status] || fog;
  const chart = !!chartDataUri;
  const dirWord = direction === "LONG" ? "Long" : direction === "SHORT" ? "Short" : String(direction || "");
  const dirArrow = direction === "LONG" ? "↑" : "↓";

  const headline = `${dirWord} ${ticker}`;
  const hSize = serifSize(headline, 1072, 92);

  // The outcome row under the headline. Resolved calls hero the graded R; open ones keep the calm status.
  const resolved = (status === "HIT_TP" || status === "STOPPED_OUT") && gradedR != null;
  let outcome;
  if (resolved) {
    // A split whose runner was stopped (callMath.mjs splitRunnerStopped): half at TP1, half on the stop. The
    // result keeps its WIN / LOSS and R; the line beside it says how it closed.
    const won = status === "HIT_TP";
    const rTxt = `${gradedR >= 0 ? "+" : ""}${Math.round(gradedR * 100) / 100}R`;
    const big = `${won ? "✓ WIN" : "✗ LOSS"} ${rTxt}`;
    const how = runnerStopped ? "GRADED · TP1 HIT, RUNNER STOPPED" : "GRADED · first-touch vs public price";
    // Full width: the line sits beside the result. With a chart the panel is on the right, so it goes under.
    outcome = `<text x="64" y="306" fill="${won ? win : loss}" font-size="40" font-weight="bold">${esc(big)}</text>
  ${chart
    ? `<text x="64" y="332" fill="${muted}" font-size="13" letter-spacing="1.3">${how}</text>`
    : `<text x="${64 + Math.ceil(big.length * 24) + 22}" y="300" fill="${muted}" font-size="14" letter-spacing="1.4">${how}</text>`}`;
  } else {
    outcome = `<text x="64" y="300" fill="${statusColor}" font-size="22" font-weight="bold" letter-spacing="2.2">${esc(statusLabel)}</text>`;
  }

  const money = cardPrice;
  const rr = `1:${parseFloat(riskReward).toFixed(2)}`;
  const lvl = (x, y, label, value, size) => `
  <text x="${x}" y="${y}" fill="${faint}" font-size="12" letter-spacing="3">${label}</text>
  <text x="${x}" y="${y + size + 6}" fill="${bright}" font-size="${size}">${esc(value)}</text>`;
  // Columns sit ~266px apart: shrink the mono size so the longest value (0.6em a glyph) keeps a 24px gap,
  // e.g. a $100k BTC level ("$104250.00").
  const longest = Math.max(...[money(entryPrice), money(stopLoss), money(takeProfit1), rr].map((v) => v.length));
  const fit = (base) => Math.min(base, Math.floor(242 / (longest * 0.6)));
  const levels = chart
    ? lvl(64, 374, "ENTRY", money(entryPrice), fit(32)) + lvl(330, 374, "STOP", money(stopLoss), fit(32))
      + lvl(64, 444, "TP1", money(takeProfit1), fit(32)) + lvl(330, 444, "R:R", rr, fit(32))
    : lvl(64, 360, "ENTRY", money(entryPrice), fit(44)) + lvl(332, 360, "STOP", money(stopLoss), fit(44))
      + lvl(600, 360, "TP1", money(takeProfit1), fit(44)) + lvl(868, 360, "R:R", rr, fit(44));

  const chartPanel = chart ? `
  <rect x="640" y="266" width="496" height="292" fill="${panel}" stroke="${border}" stroke-width="1" rx="6"/>
  <image x="648" y="274" width="480" height="276" href="${chartDataUri}" preserveAspectRatio="xMidYMid meet"/>` : "";

  // Notes: up to 2 lines of serif, broken between words, "…" when they don't fit.
  const qSize = chart ? 18 : 20;
  const qLines = quoteLines(notes, chart ? 54 : 94, 2);
  const qTop = chart ? 530 : 478;
  const quote = qLines.map((l, i) => `<text class="serif" x="64" y="${qTop + i * Math.round(qSize * 1.5)}" fill="${fog}" font-size="${qSize}">${esc(l)}</text>`).join("\n  ");

  // No display name (or one that is just the address) = the address once, not twice.
  const nm = String(displayName || "").trim();
  const kicker = nm && nm.toLowerCase() !== shortAddr.toLowerCase() && !/^0x[0-9a-f]{4}\s*(…|\.\.\.)/i.test(nm)
    ? `PUBLIC CALL · ${nm} · ${shortAddr}`
    : `PUBLIC CALL · ${shortAddr}`;
  return heroSvg({
    fontFamily,
    body: `<text x="64" y="150" fill="${muted}" font-size="13" letter-spacing="2.6">${esc(kicker)}</text>
  <text class="serif" x="60" y="242" fill="${bright}" font-size="${hSize}" letter-spacing="-1"><tspan fill="${fog}">${esc(dirWord)} </tspan>${esc(ticker)}</text>
  <text x="1136" y="150" fill="${muted}" font-size="13" text-anchor="end" letter-spacing="2.6">${dirArrow} ${esc(direction)}</text>
  ${outcome}
  ${levels}
  ${chartPanel}
  ${quote}
  <text x="64" y="594" fill="${faint}" font-size="14" letter-spacing="0.6">Graded from public price · anchored on Arbitrum</text>
  <text x="1136" y="594" fill="${faint}" font-size="14" text-anchor="end">trade.nexustradinglabs.com</text>`,
  });
}

// ── Arena agent card (/og/arena) ──────────────────────────────────────────────
// PAPER record only (the OG path never reads Supabase). Green/red = money (net P&L) only; trades, win rate,
// qualify and resets stay monochrome. Built ONLY for an agent with at least one graded paper close; the route
// 404s otherwise. Hero look since 2026-11-23: the agent's name in serif, every number in mono.
export function buildArenaAgentSvg({ name, builder = "", wallet, paper, operator = null, fontFamily = "'JetBrains Mono'" }) {
  const { bone: BONE, bright: BRIGHT, muted: MUTED, faint: FAINT, fog: FOG, win: POS, loss: NEG } = BRAND;
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
  const colX = [64, 468, 860];
  const cellSvg = cells.map(([lab, val, sub, col], i) => `
  <text x="${colX[i]}" y="356" fill="${FAINT}" font-size="13" letter-spacing="2.6">${esc(lab)}</text>
  <text x="${colX[i]}" y="404" fill="${col}" font-size="42">${esc(val)}</text>
  <text x="${colX[i]}" y="432" fill="${MUTED}" font-size="15">${esc(sub)}</text>`).join("");
  return heroSvg({
    fontFamily,
    body: `<text x="64" y="150" fill="${MUTED}" font-size="13" letter-spacing="2.6">NEXUS ARENA · AI TRADING AGENT · PAPER RECORD</text>
  <text class="serif" x="60" y="236" fill="${BRIGHT}" font-size="${serifSize(name, 1072, 84)}" letter-spacing="-1">${esc(name)}</text>
  <text x="64" y="280" fill="${FOG}" font-size="18">${esc(builder ? `built by ${builder} · ${shortAddr}` : shortAddr)}</text>
  ${cellSvg}
  <text x="64" y="488" fill="${BONE}" font-size="19" letter-spacing="1">${esc(qualifyTxt)}</text>
  <text x="64" y="516" fill="${MUTED}" font-size="15">${esc(resets)}</text>
  ${opLine ? `<text x="64" y="544" fill="${FOG}" font-size="15">${esc(opLine)}</text>` : ""}
  <text x="64" y="594" fill="${FAINT}" font-size="13">${esc(name)} · verify → trade.nexustradinglabs.com/arena</text>
  <text x="1136" y="594" fill="${FAINT}" font-size="13" text-anchor="end">fills graded by the exec engine, not self-reported</text>`,
  });
}
