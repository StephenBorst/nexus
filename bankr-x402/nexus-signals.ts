// Bankr x402 handler — the Nexus board's funding read, per market, as machine-readable data.
// This is the SAME verdict THE PLAY shows on the terminal (trade.nexustradinglabs.com) — the
// paid pull must match the board, not a stale agent tape.
// Bankr wraps the payment layer (priced in $NEXUS via bankr.x402.json); this runs after
// settlement. We DON'T settle or verify payment here — Bankr's facilitator does.
//
// HONEST LABEL (2026-09-25): our own scoreboard (/intel/axis-backtest → /proof) grades this read.
// Every response carries that LIVE grade in `grade` — read from the scoreboard on each call, never
// hardcoded, never upgraded. At label time it is NOISE (funding_fade, n≈3k). If the scoreboard
// can't be reached the grade says UNAVAILABLE — it never falls back to a flattering claim.
// Plan: swap this feed to the graded basis reads after the Oct-15 re-validation.
//
// Shape (one clean row per market): symbol · verdict (FADE|WATCH|NONE) · side (fade direction)
// · funding_annual_pct · stretched (is funding economically stretched — the FADE gate) ·
// edgeQuality (PROVEN|TRAP|MIXED|UNPROVEN, null when unproven) · n (reversion samples) · mark.
// verdict/side/funding/stretched/mark come straight from /signals (THE PLAY's source); edgeQuality
// + n are merged from /intel/mispriced (best-effort — null when a market has no reversion history).

const LAB_API = "https://og.nexustradinglabs.com";

export default async function handler(_req: Request): Promise<Response> {
  const hdr = { "content-type": "application/json" };
  try {
    const [sigR, mispR, gradeR] = await Promise.all([
      fetch(`${LAB_API}/signals`),
      fetch(`${LAB_API}/intel/mispriced`).catch(() => null),
      fetch(`${LAB_API}/intel/axis-backtest`).catch(() => null),
    ]);
    if (!sigR.ok) {
      return new Response(JSON.stringify({ error: "upstream_unavailable", status: sigR.status }), { status: 502, headers: hdr });
    }
    const sig = (await sigR.json()) as { generated_at?: string; signals?: Record<string, unknown>[] };

    // edgeQuality + n per coin from the mispriced board (best-effort).
    const edgeBy: Record<string, { edgeQuality: string | null; n: number | null }> = {};
    try {
      const m = mispR && mispR.ok ? ((await mispR.json()) as { markets?: Record<string, unknown>[] }) : null;
      for (const x of m?.markets || []) {
        const coin = String((x as { coin?: string }).coin || "").toUpperCase();
        if (!coin) continue;
        const eq = (x as { edgeQuality?: { tier?: string; samples?: number } }).edgeQuality || null;
        const rev = (x as { reversion?: { samples?: number } }).reversion || null;
        edgeBy[coin] = { edgeQuality: eq?.tier ?? null, n: eq?.samples ?? rev?.samples ?? null };
      }
    } catch { /* edgeQuality stays null */ }

    // The live scoreboard grade for this read (funding_fade). Best-effort; never invented.
    let grade: Record<string, unknown> = { axis: "funding_fade", verdict: "UNAVAILABLE", proof: "https://trade.nexustradinglabs.com/proof" };
    try {
      const g = gradeR && gradeR.ok ? ((await gradeR.json()) as { asOf?: string; axes?: Record<string, unknown>[] }) : null;
      const ax = (g?.axes || []).find((a) => (a as { name?: string }).name === "funding_fade") as
        | { verdict?: string; r?: { samples?: number; hitRate?: number; meanR?: number; stable?: boolean } }
        | undefined;
      if (ax?.verdict) {
        grade = {
          ...grade,
          verdict: ax.verdict,
          samples: ax.r?.samples ?? null,
          hitRate: ax.r?.hitRate ?? null,
          meanR: ax.r?.meanR ?? null,
          stable: ax.r?.stable ?? null,
          asOf: g?.asOf ?? null,
        };
      }
    } catch { /* grade stays UNAVAILABLE */ }

    const signals = (sig.signals || []).map((s) => {
      const sym = String((s as { symbol?: string }).symbol || "");
      const e = edgeBy[sym.toUpperCase()] || { edgeQuality: null, n: null };
      return {
        symbol: sym,
        verdict: (s as { verdict?: string }).verdict ?? null,
        side: (s as { fade_dir?: string }).fade_dir ?? null,
        funding_annual_pct: (s as { funding_annual_pct?: number }).funding_annual_pct ?? null,
        stretched: !!(s as { stretched?: boolean }).stretched,
        edgeQuality: e.edgeQuality,
        n: e.n,
        mark: (s as { mark_price?: number }).mark_price ?? null,
      };
    });

    return new Response(JSON.stringify({
      source: "Nexus Trading Labs. The board's funding read, per market. Same verdict as THE PLAY on trade.nexustradinglabs.com.",
      grade,
      note: "Our scoreboard grades this read in public. `grade` is its live verdict; a read is not an edge until it grades PREDICTIVE. Verify at /proof.",
      generated_at: sig.generated_at || new Date().toISOString(),
      signals,
    }), { headers: hdr });
  } catch (e) {
    return new Response(JSON.stringify({ error: "handler_error", detail: String((e as Error)?.message || e) }), { status: 500, headers: hdr });
  }
}
