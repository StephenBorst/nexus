// The recorded 30-trade paper verdicts the CLEARED badge needs (pipeline-if-then.md § "Board layout and the CLEARED
// badge"), read only for reads that could clear: served Tradeable or Paper, with a paper wallet. One request per read
// through sharedJson, so /proof's header and its board share them. Unread = absent = not cleared, never a guess.
import { useEffect, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";

const API = "https://og.nexustradinglabs.com";
export type Judgment = { recorded: boolean; verdict?: string };
type ReadRow = { axis: string; stage: string; paperWallet?: string | null };

export function usePaperJudgments(reads: ReadRow[] | null | undefined): Record<string, Judgment> {
  const [judgments, setJudgments] = useState<Record<string, Judgment>>({});
  const key = (reads || []).filter((r) => (r.stage === "PAPER" || r.stage === "TRADEABLE") && r.paperWallet).map((r) => r.axis).sort().join(",");
  useEffect(() => {
    if (!key) { setJudgments({}); return; }
    let live = true;
    Promise.all(key.split(",").map((ax) => sharedJson(`${API}/signals/paper-judge/${encodeURIComponent(ax)}`).catch(() => null).then((j) => [ax, j] as const)))
      .then((pairs) => {
        if (!live) return;
        setJudgments(Object.fromEntries(pairs.filter(([, j]) => j && typeof j === "object").map(([ax, j]) => [ax, { recorded: (j as { recorded?: boolean }).recorded === true, verdict: (j as { verdict?: string }).verdict }])));
      });
    return () => { live = false; };
  }, [key]);
  return judgments;
}
