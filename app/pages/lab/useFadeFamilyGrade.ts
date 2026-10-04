// The plain funding fade's live grade for the Lab's FADE label (THE BOARD + the Briefing).
// One fetch per page session, shared by every caller; a failed read is retried on the next mount
// and, meanwhile, the label just says "not graded yet" (fadeFamilyLine returns null).
import { useEffect, useState } from "react";
import { fadeFamilyGrade, type FadeFamilyGrade } from "@/lib/fadeGrade.mjs";

const SCOREBOARD = "https://og.nexustradinglabs.com/intel/axis-backtest";
let pending: Promise<FadeFamilyGrade | null> | null = null;

function load(): Promise<FadeFamilyGrade | null> {
  if (!pending) {
    pending = fetch(SCOREBOARD)
      .then((r) => (r.ok ? r.json() : null))
      .then(fadeFamilyGrade)
      .catch(() => null)
      .then((g) => { if (!g) pending = null; return g; });
  }
  return pending;
}

export function useFadeFamilyGrade(): FadeFamilyGrade | null {
  const [grade, setGrade] = useState<FadeFamilyGrade | null>(null);
  useEffect(() => {
    let alive = true;
    load().then((g) => { if (alive) setGrade(g); });
    return () => { alive = false; };
  }, []);
  return grade;
}
