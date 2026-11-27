// The recorded 30-trade paper verdicts the CLEARED badge needs (pipeline-if-then.md § "Board layout and the CLEARED
// badge"), read only for reads that could clear: served Tradeable or Paper, with a paper wallet or a house paper run. One request per read
// through sharedJson, so /proof's header and its board share them. Unread = absent = not cleared, never a guess.
import { useEffect, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";
import { HOUSE_PAPER_IDS } from "@/lib/housePaper.mjs";

const API = "https://og.nexustradinglabs.com";
export type Judgment = { recorded: boolean; verdict?: string; random?: string; randomPct?: number | null; randomUsable?: number | null; target?: number };
type ReadRow = { axis: string; stage: string; paperWallet?: string | null };

// What the badge needs from a served judgment: recorded, verdict and the v2 random check (app/lib/badgeBar.mjs).
const slim = (j: Record<string, unknown>): Judgment => {
  const rc = (j.randomCheck || null) as { verdict?: string; pctBeaten?: number | null; usable?: number | null } | null;
  return { recorded: j.recorded === true, verdict: j.verdict as string | undefined, random: rc?.verdict, randomPct: rc?.pctBeaten ?? null, randomUsable: rc?.usable ?? null, target: j.target as number | undefined };
};

// `anyStage`: every read with a paper run, whatever its served stage (the graveyard lists a recorded FAIL on a read
// that has since fallen back). The badge callers keep the default.
export function usePaperJudgments(reads: ReadRow[] | null | undefined, { anyStage = false }: { anyStage?: boolean } = {}): Record<string, Judgment> {
  const [judgments, setJudgments] = useState<Record<string, Judgment>>({});
  const key = (reads || []).filter((r) => (anyStage || r.stage === "PAPER" || r.stage === "TRADEABLE") && (r.paperWallet || r.axis in HOUSE_PAPER_IDS)).map((r) => r.axis).sort().join(",");
  useEffect(() => {
    if (!key) { setJudgments({}); return; }
    let live = true;
    Promise.all(key.split(",").map((ax) => sharedJson(`${API}/signals/paper-judge/${encodeURIComponent(ax)}`).catch(() => null).then((j) => [ax, j] as const)))
      .then((pairs) => {
        if (!live) return;
        setJudgments(Object.fromEntries(pairs.filter(([, j]) => j && typeof j === "object").map(([ax, j]) => [ax, slim(j as Record<string, unknown>)])));
      });
    return () => { live = false; };
  }, [key]);
  return judgments;
}
