// Shown right where a PRO-locked preset or strategy was clicked (2026-11-22: they used to do nothing visible). Words:
// app/lib/proLock.mjs. "See PRO" scrolls to the PRO card the Lab mounts at its foot (#nexus-pro).
import { C, MONO, UI } from "@/config/theme";
import { proLockCopy } from "@/lib/proLock.mjs";
import { TIER_THRESHOLDS } from "@/hooks/useNexusTier";
import { PRO_HOLDER_TIER, PRO_MONTHLY_USDC, nexusDiscountedPrice } from "@/config/subscription";

export function ProLockNote({ name, loading, onClose }: { name: string; loading: boolean; onClose: () => void }) {
  const c = proLockCopy({
    name, loading,
    holderMin: TIER_THRESHOLDS.find((t) => t.tier === PRO_HOLDER_TIER)?.min ?? 0,
    holderTier: PRO_HOLDER_TIER, usdc: PRO_MONTHLY_USDC, nexusPrice: nexusDiscountedPrice(),
  });
  const seePro = () => document.getElementById("nexus-pro")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div role="status" className="nx-fade-in" style={{ marginTop: 10, padding: "12px 14px", border: `1px solid ${C.borderStrong}`, borderRadius: 8, background: C.surfaceAlt }}>
      <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.14em", color: C.text.muted }}>◆ PRO</div>
      <div style={{ fontFamily: UI, fontSize: 14, fontWeight: 600, color: C.text.bright, marginTop: 4 }}>{c.title}</div>
      <div style={{ fontFamily: UI, fontSize: 12.5, color: C.text.fog, marginTop: 4, lineHeight: 1.55 }}>{c.body}</div>
      {!c.checking && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 10, flexWrap: "wrap" }}>
          <button type="button" className="nx-btn" onClick={seePro} style={{ padding: "7px 14px" }}>See PRO ↓</button>
          <button type="button" onClick={onClose} style={{ background: "none", border: "none", color: C.text.muted, fontFamily: UI, fontSize: 12.5, cursor: "pointer", minHeight: 32 }}>Not now</button>
        </div>
      )}
    </div>
  );
}
