// ── /proof, written into the HTML before the app boots ─────────────────────────────────────────────
// The app takes seconds to boot on a phone (the Orderly SDK); until then the HTML's boot screen is all anyone
// sees. The page's Function (functions/proof/index.js → seoGate.mjs gateProofPage) reads GET /calls/pulse
// (routes-pulse.mjs: the scoreboard's own headline, the cleared reads' paper counts, the week's call counts)
// and swaps the boot screen for this static copy of the page's header. React replaces it on mount.
//
// Same rules as the live header (FeaturedLead.tsx): the headline is the COMPUTED claim (proofHeadline, served
// by the pulse; an unread or stale board = `headline: null` = the no-claim default), paper = a COUNT, never a
// P&L. People and our engine callers counted apart, never blended. No green or red: nothing here is money.
// Pure: no fetch, no DOM.

import { BRAND } from "./brand.mjs";
import { HEADLINE_DEFAULT, PROOF_BAR_LINE, paperGateLine } from "./proofCopy.mjs";
import { paperLine } from "./signalProgress.mjs";

const escH = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const count = (n) => (Number.isInteger(n) && n >= 0 ? n : null);
const calls = (n) => `${n} ${n === 1 ? "call" : "calls"}`;

/** The week's call counts in one line, people and engines apart; null when either side is unread. */
export function pulseCountsLine(pulse) {
  const pg = count(pulse?.gradedWeek), po = count(pulse?.open);
  const eg = count(pulse?.engines?.gradedWeek), eo = count(pulse?.engines?.open);
  if (pg == null || po == null || eg == null || eo == null) return null;
  const days = count(pulse?.windowDays) || 7;
  return `Last ${days} days: ${calls(pg)} graded from people, ${eg} from our engine callers. Open now: ${po} from people, ${eo} from engines.`;
}

/** The static header, or null for an unreadable pulse (the boot screen stays). */
export function proofSnapshotHtml(pulse) {
  if (!pulse || pulse.ok !== true) return null;
  const B = BRAND;
  const h = pulse.headline && typeof pulse.headline.title === "string" ? pulse.headline : HEADLINE_DEFAULT;
  // Paper progress only beside a claim the headline makes (FeaturedLead shows it only for a cleared headline).
  const signals = h.cleared && Array.isArray(pulse.signals) ? pulse.signals.filter((p) => p && typeof p.axis === "string") : [];
  const link = `color:${B.bright};text-decoration:underline;text-underline-offset:3px;text-decoration-color:${B.muted}`;
  const progress = signals.map((p) => `<p style="margin:12px 0 0;font-size:14px;line-height:1.5;max-width:640px">${escH(paperLine(p))} `
    + `<span style="color:${B.fog}">${escH(paperGateLine(count(p.paper?.target) || 30))}</span>`
    + (p.paper ? ` <a href="/proof/paper/${encodeURIComponent(p.axis)}" style="${link}">Every trade, in R →</a>` : "")
    + `</p>`).join("");
  const counts = pulseCountsLine(pulse);
  return `<div class="nx-proof-snapshot" style="min-height:100vh;background:${B.canvas};color:${B.bright};font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">`
    + `<main style="max-width:920px;margin:0 auto;padding:28px 16px 48px">`
    + `<div style="font:500 10px/1.4 ui-monospace,Menlo,monospace;letter-spacing:.2em;text-transform:uppercase;color:${B.fog};margin-bottom:12px">The proof</div>`
    + `<h1 style="margin:0;font-size:28px;font-weight:600;letter-spacing:-.02em;line-height:1.15;max-width:760px">${escH(h.title)}<span style="display:block;color:${B.fog}">${escH(h.sub)}</span></h1>`
    + progress
    + `<p style="margin:14px 0 0;font-size:15px;line-height:1.55;color:${B.fog};max-width:640px">${escH(PROOF_BAR_LINE)}</p>`
    + (counts ? `<p style="margin:18px 0 0;padding-top:14px;border-top:1px solid ${B.border};font:12.5px/1.6 ui-monospace,Menlo,monospace;color:${B.fog};max-width:640px">${escH(counts)}</p>` : "")
    + `<p style="margin:16px 0 0;font-size:12.5px;color:${B.muted}">Graded from public Orderly price. Loading the full record…</p>`
    + `</main></div>`;
}
