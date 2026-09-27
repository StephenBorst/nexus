// ── STAGED for Oct-15 (off): the basis-stack read, per market, as the paid feed would sell it ──
//
// Today the x402 `nexus-signals` feed sells the funding+OI read, which our scoreboard grades
// NOISE. The plan (CEO pass, Sept 25) is to swap it to the graded basis read AFTER the Oct-15
// re-validation. This is the swap's data source, built now so Oct-15 is a flag flip, not a
// build. `GET /signals/basis` answers 404 `not_live` until the worker var
// BASIS_SIGNALS_LIVE = "true" (set in wrangler.toml [vars]; unset today).
//
// ONE rule, three surfaces: the read below builds the SAME raw fields the brain's
// evaluateSymbol builds (basisFadeFromHistory → the confirm gate) and asks the brain's own
// deriveSignal for the verdict — so what we'd sell is exactly what the agent trades, which is
// exactly what the scoreboard grades (parity test: basisSignals.test.mjs).
import { basisFadeFromHistory } from "../../app/lib/basisFade.mjs";
import { basisCvdConfirm, basisSmartConfirm, basisLiqConfirm } from "../../app/lib/basisStack.mjs";
import { deriveSignal } from "../nexus-agent-brain/logic.mjs";

export const BASIS_SIGNAL_COINS = ["BTC", "ETH", "SOL", "XRP", "DOGE", "BNB", "ARB", "AVAX", "LINK", "HYPE", "SUI", "WLD"];
export const BASIS_CONFIRMS = ["CVD", "SMART", "LIQ", "NONE"];

// One market's read. `hists` = the recorded series the brain reads from the same KV.
export function basisStackRead({ basisHist = [], cvdHist = [], oiHist = [], smHist = [], liqHist = [] } = {}, confirm = "CVD", now = Date.now()) {
  const basis = basisFadeFromHistory(basisHist, { now });
  const fired = basis && (basis.side === "LONG" || basis.side === "SHORT");
  let cf = null;
  if (fired && confirm === "CVD") cf = basisCvdConfirm({ basisT: basis.t, side: basis.side, cvdHist, oiHist });
  if (fired && confirm === "SMART") cf = basisSmartConfirm({ basisT: basis.t, side: basis.side, smHist });
  if (fired && confirm === "LIQ") cf = basisLiqConfirm({ basisT: basis.t, side: basis.side, liqHist });
  const raw = {
    ...(basis ? { basisSide: basis.side, basisPct: basis.basisPct, basisThr: basis.thr, basisReason: basis.reason } : {}),
    ...(cf && confirm === "CVD" ? { basisCvdConfirmed: cf.confirmed, basisCvdSide: cf.cvdSide, basisCvdReason: cf.reason } : {}),
    ...(cf && confirm === "SMART" ? { basisSmartConfirmed: cf.confirmed, basisSmartSide: cf.smartSide, basisSmartReason: cf.reason } : {}),
    ...(cf && confirm === "LIQ" ? { basisLiqConfirmed: cf.confirmed, basisLiqSide: cf.liqSide, basisLiqReason: cf.reason } : {}),
  };
  const sig = deriveSignal(raw, { signalMode: "BASIS_FADE", ...(confirm !== "NONE" ? { basisConfirm: confirm } : {}) });
  return {
    direction: sig.direction,
    reason: sig.direction === "NONE" ? (sig.reason || "no basis extreme") : sig.reason.split(" funding=")[0],
    basisPct: basis?.basisPct ?? null,
    threshold: basis?.thr ?? null,
    observedAt: basis?.t ? new Date(basis.t).toISOString() : null,
  };
}

// GET /signals/basis?confirm=CVD — every scoreboard market, one row each. Off until the flag.
export async function handleBasisSignals(request, env, json) {
  if (env.BASIS_SIGNALS_LIVE !== "true") {
    return json({ error: "not_live", note: "Staged for the Oct-15 basis re-validation. Not served until then." }, request, 404);
  }
  const url = new URL(request.url);
  const confirm = String(url.searchParams.get("confirm") || "CVD").toUpperCase();
  if (!BASIS_CONFIRMS.includes(confirm)) return json({ error: "bad_confirm", allowed: BASIS_CONFIRMS }, request, 400);
  const CACHE = `signals:basis:v1:${confirm}`;
  try { const c = await env.LAB_STORE.get(CACHE); if (c) return json(JSON.parse(c), request); } catch { /* ignore */ }
  const KV = env.NEXUS_AGENT || env.LAB_STORE;
  const read = async (key) => { try { const r = await KV.get(key); return r ? JSON.parse(r) : []; } catch { return []; } };
  const now = Date.now();
  const signals = await Promise.all(BASIS_SIGNAL_COINS.map(async (coin) => {
    const [basisHist, cvdHist, oiHist, smHist, liqHist] = await Promise.all([
      read(`basis:hist:${coin}`),
      confirm === "CVD" ? read(`cvd:hist:${coin}`) : [],
      confirm === "CVD" ? read(`oi:hist:PERP_${coin}_USDC`) : [],
      confirm === "SMART" ? read(`sm:hist:${coin}`) : [],
      confirm === "LIQ" ? read(`liq:hist:${coin}`) : [],
    ]);
    return { symbol: `PERP_${coin}_USDC`, ...basisStackRead({ basisHist, cvdHist, oiHist, smHist, liqHist }, confirm, now) };
  }));
  const body = {
    asOf: new Date(now).toISOString(),
    rule: { signalMode: "BASIS_FADE", basisConfirm: confirm === "NONE" ? null : confirm },
    sameAs: "The Nexus agent's BASIS_FADE gate (brain deriveSignal) on the same recorded series the scoreboard grades.",
    signals,
  };
  try { await env.LAB_STORE.put(CACHE, JSON.stringify(body), { expirationTtl: 120 }); } catch { /* best-effort */ }
  return json(body, request);
}
