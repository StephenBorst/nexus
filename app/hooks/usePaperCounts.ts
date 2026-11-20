// Every read's paper run as a trade COUNT (GET /signals/paper-counts, routes-paperrun.mjs), for the /proof board rows.
// One request through sharedJson. Counts only: no R, no sums, no dollars. Unread = absent = no line, never a guess.
import { useEffect, useState } from "react";
import { sharedJson } from "@/lib/sharedJson.mjs";

const API = "https://og.nexustradinglabs.com";
export type PaperCount = { wallet: string; house?: boolean; count?: number; target?: number; open?: boolean; unread?: boolean };

export function usePaperCounts(): Record<string, PaperCount> {
  const [runs, setRuns] = useState<Record<string, PaperCount>>({});
  useEffect(() => {
    let live = true;
    sharedJson(`${API}/signals/paper-counts`)
      .then((j: unknown) => {
        const r = (j as { runs?: Record<string, PaperCount> } | null)?.runs;
        if (live && r && typeof r === "object") setRuns(r);
      })
      .catch(() => { /* no lines */ });
    return () => { live = false; };
  }, []);
  return runs;
}
