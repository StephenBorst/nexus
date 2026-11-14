// The plain funding fade's live grade for the Lab's FADE label (THE BOARD + the Briefing).
// One fetch per page session, shared by every caller; a failed read is retried on the next mount
// and, meanwhile, the label just says "not graded yet" (fadeFamilyLine returns null).
import { useEffect, useState } from "react";
import type { FadeFamilyGrade } from "@/lib/fadeGrade.mjs";

// Just the grade (lab-api /intel/fade-grade, same rule server-side): this used to download the whole ~200 KB
// scoreboard on Lab home's first paint for one line.
const FADE_GRADE = "https://og.nexustradinglabs.com/intel/fade-grade";
let pending: Promise<FadeFamilyGrade | null> | null = null;

function load(): Promise<FadeFamilyGrade | null> {
  if (!pending) {
    pending = fetch(FADE_GRADE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => (j?.grade ?? null) as FadeFamilyGrade | null)
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
