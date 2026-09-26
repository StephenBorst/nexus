// STAGED for Oct-15 — NOT DEPLOYED. The basis-stack version of the paid `nexus-signals` feed.
//
// Today `nexus-signals` (nexus-signals.ts) sells the funding+OI read, which our scoreboard grades
// NOISE, and says so in every response. The plan is to swap to the graded basis read AFTER the
// Oct-15 re-validation — and only if it holds. This file is that swap, pre-built. bankr.x402.json
// does not list it, so `bankr x402 deploy` can't ship it by accident. Swap runbook: README.md
// ("Oct-15 basis swap").
//
// Same honesty rules as the live handler: every response carries the LIVE scoreboard grade of
// the read it sells (basis_x_cvd), read on each call, never hardcoded, never upgraded; if the
// scoreboard can't be reached the grade says UNAVAILABLE.
//
// Data: GET /signals/basis?confirm=CVD — per market, the brain's own deriveSignal on the same
// recorded series the scoreboard grades (lab-api basisSignals.mjs, parity-tested). It answers
// 404 not_live until BASIS_SIGNALS_LIVE is set, so this handler 502s until then.

const LAB_API = "https://og.nexustradinglabs.com";
const AXIS = "basis_x_cvd";

export default async function handler(_req: Request): Promise<Response> {
  const hdr = { "content-type": "application/json" };
  try {
    const [sigR, gradeR] = await Promise.all([
      fetch(`${LAB_API}/signals/basis?confirm=CVD`),
      fetch(`${LAB_API}/intel/axis-backtest`).catch(() => null),
    ]);
    if (!sigR.ok) {
      return new Response(JSON.stringify({ error: "upstream_unavailable", status: sigR.status }), { status: 502, headers: hdr });
    }
    const sig = (await sigR.json()) as {
      asOf?: string;
      rule?: unknown;
      signals?: { symbol: string; direction: string; reason: string; basisPct: number | null; threshold: number | null; observedAt: string | null }[];
    };

    let grade: Record<string, unknown> = { axis: AXIS, verdict: "UNAVAILABLE", proof: "https://trade.nexustradinglabs.com/proof" };
    try {
      const g = gradeR && gradeR.ok ? ((await gradeR.json()) as { asOf?: string; axes?: Record<string, unknown>[] }) : null;
      const ax = (g?.axes || []).find((a) => (a as { name?: string }).name === AXIS) as
        | { verdict?: string; r?: { samples?: number; hitRate?: number; meanR?: number; stable?: boolean }; random?: { pooled?: { verdict?: string; pctBeaten?: number } } }
        | undefined;
      if (ax?.verdict) {
        grade = {
          ...grade,
          verdict: ax.verdict,
          samples: ax.r?.samples ?? null,
          hitRate: ax.r?.hitRate ?? null,
          meanR: ax.r?.meanR ?? null,
          stable: ax.r?.stable ?? null,
          vsRandom: ax.random?.pooled ? { verdict: ax.random.pooled.verdict ?? null, pctBeaten: ax.random.pooled.pctBeaten ?? null } : null,
          asOf: g?.asOf ?? null,
        };
      }
    } catch { /* grade stays UNAVAILABLE */ }

    return new Response(JSON.stringify({
      source: "Nexus Trading Labs. The graded basis × CVD read, per market. The same rule the Nexus agent trades.",
      rule: sig.rule ?? null,
      grade,
      note: "Our scoreboard grades this read in public. `grade` is its live verdict; `vsRandom` says whether its timing beats random entries. Verify at /proof.",
      generated_at: sig.asOf || new Date().toISOString(),
      signals: (sig.signals || []).map((s) => ({
        symbol: s.symbol,
        direction: s.direction,
        reason: s.reason,
        basis_pct: s.basisPct,
        threshold: s.threshold,
        observed_at: s.observedAt,
      })),
    }), { headers: hdr });
  } catch (e) {
    return new Response(JSON.stringify({ error: "handler_error", detail: String((e as Error)?.message || e) }), { status: 500, headers: hdr });
  }
}
