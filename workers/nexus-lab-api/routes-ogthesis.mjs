// ── GET /og/thesis/:wallet/:id(.png) — the share card for ONE call ─────────────────────────────────
// SVG for most crawlers; .png for X/Farcaster (raster). The card shows the call's levels and notes,
// so it answers ONLY for calls the feed shows (isPublicCall: public, not holders-only, not a duplicate
// copy). It used to render whichever thesis matched the id, so a private or ◆ HOLDERS call's levels
// and notes were one guessed id away. Same rule as /verify (routes-verify.mjs).
// Card shows the OBJECTIVE grade, never the self-report. A stamp counts only if the current grader
// wrote it (grading.mjs GRADE_V); anything else is graded live from the call's window.
import { normalizeAddress } from "./shared.mjs";
import { gradeCall, callR } from "./logic.mjs";
import { gradedStatusOf, isCurrentStamp, fetchGradeHistory } from "./grading.mjs";
import { buildThesisOgSvg } from "./ogCards.mjs";
import { isPublicCall } from "./routes-verify.mjs";
import { callInvalidReason } from "../../app/lib/callMath.mjs";

const notFound = () => new Response("not found", { status: 404 });

/**
 * deps.renderPng(payload, thesis) → PNG bytes (index.js: resvg + font + first chart). A throw falls
 * back to the SVG card. deps.getCandles(symbol, createdAt) → candles (default fetchGradeHistory).
 */
export async function handleOgThesis(parts, request, env, deps = {}) {
  if (!(parts[0] === "og" && parts[1] === "thesis" && parts[2] && parts[3])) return null;
  if (request.method !== "GET") return new Response("method not allowed", { status: 405 });
  const isPng = parts[3].endsWith(".png");
  const thesisId = isPng ? parts[3].slice(0, -4) : parts[3];
  const wallet = normalizeAddress(parts[2]);
  const [raw, profileRaw] = await Promise.all([
    env.LAB_STORE.get(`lab:${wallet}`),
    env.LAB_STORE.get(`profile:${wallet}`),
  ]);
  if (!raw) return notFound();
  let data; try { data = JSON.parse(raw); } catch { return notFound(); }
  const thesis = (data.theses || []).find((t) => t && t.id === thesisId);
  if (!isPublicCall(thesis)) return notFound();
  let profile = {}; try { profile = profileRaw ? JSON.parse(profileRaw) : {}; } catch { /* no profile */ }
  const ticker = String(thesis.symbol || "").replace("PERP_", "").replace("_USDC", "");
  const stamped = isCurrentStamp(thesis);
  let ogStatus = stamped ? gradedStatusOf(thesis.gradedOutcome) : "ACTIVE";
  let ogGradedR = stamped && typeof thesis.gradedR === "number" ? thesis.gradedR : null;
  // A call the grader can never grade says so from its levels, never "ACTIVE" forever. (Not from
  // gradeCall's INVALID: that also means "no candles", a missing read.)
  if (!stamped && callInvalidReason(thesis)) ogStatus = "NOT_GRADED";
  else if (!stamped) {
    try {
      const getCandles = deps.getCandles || ((sym, at) => fetchGradeHistory(sym, at, env));
      const g = gradeCall(thesis, await getCandles(thesis.symbol, thesis.createdAt));
      if (g.outcome === "WIN" || g.outcome === "LOSS") { ogStatus = gradedStatusOf(g.outcome); ogGradedR = g.r; }
    } catch { /* keep ACTIVE */ }
  }
  const payload = {
    displayName: profile.displayName || null, wallet, ticker,
    direction: thesis.direction, entryPrice: thesis.entryPrice,
    stopLoss: thesis.stopLoss, takeProfit1: thesis.takeProfit1,
    riskReward: callR(thesis) ?? 0, status: ogStatus, gradedR: ogGradedR, notes: thesis.notes || "",
  };
  if (isPng && deps.renderPng) {
    try {
      const png = await deps.renderPng(payload, thesis);
      return new Response(png, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
    } catch (e) { console.error("[OG PNG thesis]", String(e)); }
  }
  const svg = buildThesisOgSvg(payload);
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" } });
}
