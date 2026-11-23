// One hand-off from any market surface to the Thesis Engine (2026-11-21): the trader picked the side, the draft names
// the coin and that side, and the Thesis Engine builds the levels from live price on arrival (marketCallDraft.mjs), so
// Post is the next tap. Same localStorage contract every board uses (nexus_thesis_draft); the events cover a Thesis
// tab that is already open. Used by the coin drawer / dock, the market table and Forecast Divergence.
import { THESIS_DRAFT_KEY } from "@/config/assistantTools";
import { marketCallDraft } from "@/lib/marketCallDraft.mjs";

export type CallSource = "market-drawer" | "market-table" | "forecast-divergence";

/** Writes the draft and opens the Thesis Engine. false = a bad coin or side (nothing written). */
export function handOffCall(coin: string, side: "LONG" | "SHORT", navigate: (to: string) => void, source: CallSource = "market-drawer"): boolean {
  const d = marketCallDraft(coin, side, source);
  if (!d) return false;
  try { localStorage.setItem(THESIS_DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
  navigate("/lab?tab=thesis");
  try {
    window.dispatchEvent(new CustomEvent("nexus:lab-tab", { detail: { tab: "thesis" } }));
    window.dispatchEvent(new CustomEvent("nexus:thesis-draft"));
  } catch { /* non-browser */ }
  return true;
}
