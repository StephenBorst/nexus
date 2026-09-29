import { useEffect, useRef } from "react";
import { C, SIGNAL, LINE } from "@/config/theme";
import type { TabId } from "./types";
import { CountUp } from "./components";
import { SimCreditsBadge } from "./SimCreditsBadge";

// ── The Lab's header: title, account read, and the tab bar ─────────────────────
// One title row (what this page is + account status), the connected account's numbers, then
// the tabs grouped by the loop's phase. Colour follows docs/brand.md: the bone brand mark marks the active
// tab only, green/red appear on money alone (P&L), counts and rates stay monochrome.

const MONO = "var(--nx-font-mono)";
const UI = "var(--nx-font-ui)";

export type LabTab = { id: TabId; label: string; short: string; phase: string };

type SyncState = { connected: boolean; authOk: boolean; syncing: boolean; synced: boolean; onSign: () => void };

function openPalette() {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true }));
}

// Where the Lab record lives right now, in words. A dot alone never said which state it was.
function SyncStatus({ connected, authOk, syncing, synced, onSign, isMobile }: SyncState & { isMobile: boolean }) {
  if (!connected) return null;
  if (!authOk) {
    return (
      <button type="button" onClick={onSign}
        title="Sign a message (no funds move) so your calls and notes save to your record. Once a day."
        style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: "0.04em", color: SIGNAL.watch, background: SIGNAL.watchBg, border: `1px solid ${LINE.watch}`, borderRadius: 6, padding: "0 10px", height: isMobile ? 32 : 28, cursor: "pointer", whiteSpace: "nowrap" }}>
        Sign to sync
      </button>
    );
  }
  const label = syncing ? "Saving" : synced ? "Synced" : "Local only";
  return (
    <span title={synced ? "Your calls and notes are saved to your record." : "Saved on this device; syncs on the next save."}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontFamily: MONO, fontSize: 11, color: C.text.muted, whiteSpace: "nowrap" }}>
      <span aria-hidden style={{ width: 6, height: 6, borderRadius: 3, background: syncing ? C.text.muted : synced ? C.text.fog : C.text.disabled }} />
      {label}
    </span>
  );
}

export function LabTitleBar({ isMobile, sync }: { isMobile: boolean; sync: SyncState }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: isMobile ? "14px 14px 10px" : "18px 20px 12px" }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", color: C.brand, marginBottom: 4 }}>THE LAB</div>
        <h1 style={{ margin: 0, fontFamily: UI, fontSize: isMobile ? 20 : 24, fontWeight: 600, letterSpacing: "-0.02em", color: C.text.bright, lineHeight: 1.15 }}>
          Plan it. Run it. Prove it.
        </h1>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
        {!isMobile && <SimCreditsBadge />}
        <SyncStatus {...sync} isMobile={isMobile} />
        {!isMobile && (
          <button type="button" onClick={openPalette} aria-label="Open command palette" title="Command palette"
            style={{ fontFamily: MONO, fontSize: 11, color: C.text.muted, background: "transparent", border: `1px solid ${C.border}`, borderRadius: 6, height: 28, padding: "0 9px", cursor: "pointer" }}>
            ⌘K
          </button>
        )}
      </div>
    </div>
  );
}

type StatRow = { label: string; num: number | null; fmt: (v: number) => string; money?: boolean };

// The connected account in six numbers. Only money (realized, unrealized) takes a colour.
export function LabStats({ isMobile, stats }: { isMobile: boolean; stats: StatRow[] }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: isMobile ? "repeat(3, 1fr)" : `repeat(${stats.length}, minmax(0, max-content))`,
      columnGap: isMobile ? 8 : 32, rowGap: 12, padding: isMobile ? "4px 14px 14px" : "2px 20px 16px",
    }}>
      {stats.map(({ label, num, fmt, money }) => {
        const color = num == null ? C.text.faint : money ? (num >= 0 ? C.pos : C.neg) : C.text.bright;
        return (
          <div key={label} style={{ minWidth: 0 }}>
            <div style={{ fontFamily: UI, fontSize: isMobile ? 15 : 17, fontWeight: 600, color, letterSpacing: "-0.01em", fontVariantNumeric: "tabular-nums", lineHeight: 1.2 }}>
              {num == null ? "—" : <CountUp value={num} format={fmt} />}
            </div>
            <div style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.12em", color: C.text.muted, marginTop: 3, whiteSpace: "nowrap" }}>{label}</div>
          </div>
        );
      })}
    </div>
  );
}

// Tabs. Desktop: underline tabs grouped under a readable phase label (the loop: observe →
// plan → run → prove). Phone: one row of pills that scrolls sideways, the active one kept in
// view. "More" opens the rest and "Less" puts them back.
export function LabTabs({ isMobile, tabs, activeTab, onSelect, canCondense, condensed, onToggleMore }: {
  isMobile: boolean; tabs: LabTab[]; activeTab: TabId; onSelect: (t: TabId) => void;
  canCondense: boolean; condensed: boolean; onToggleMore: (showAll: boolean) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isMobile) return;
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-tab="${activeTab}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [activeTab, isMobile, tabs.length]);

  const moreLabel = condensed ? "More" : "Less";
  const moreTitle = condensed ? "Show all Lab tools" : "Show fewer tabs";

  if (isMobile) {
    const pill = (active: boolean) => ({
      flexShrink: 0, height: 34, padding: "0 13px", borderRadius: 17, cursor: "pointer", whiteSpace: "nowrap" as const,
      fontFamily: UI, fontSize: 13, fontWeight: active ? 600 : 500,
      color: active ? C.text.bright : C.text.muted,
      background: active ? C.surface : "transparent",
      border: `1px solid ${active ? C.borderStrong : C.border}`,
    });
    return (
      <div ref={rowRef} role="tablist" aria-label="Lab sections" className="nx-noscrollbar"
        style={{ display: "flex", gap: 6, overflowX: "auto", padding: "0 14px 12px", scrollbarWidth: "none" }}>
        {tabs.map((t) => {
          const active = activeTab === t.id;
          return (
            <button key={t.id} data-tab={t.id} role="tab" aria-selected={active} onClick={() => onSelect(t.id)} style={pill(active)}>
              {t.short}
            </button>
          );
        })}
        {canCondense && (
          <button type="button" onClick={() => onToggleMore(condensed)} title={moreTitle} style={{ ...pill(false), color: C.text.fog }}>
            {moreLabel} {condensed ? "+" : "−"}
          </button>
        )}
      </div>
    );
  }

  // Group in declaration order: the tab array IS the loop's order.
  const groups = tabs.reduce<{ phase: string; items: LabTab[] }[]>((acc, t) => {
    const last = acc[acc.length - 1];
    if (last && last.phase === t.phase) last.items.push(t);
    else acc.push({ phase: t.phase, items: [t] });
    return acc;
  }, []);

  const tabStyle = (active: boolean) => ({
    background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap" as const,
    borderBottom: `2px solid ${active ? C.brand : "transparent"}`,
    color: active ? C.text.bright : C.text.muted,
    fontFamily: UI, fontSize: 13.5, fontWeight: active ? 600 : 500,
    padding: "8px 0 11px", marginBottom: -1, transition: "color 140ms ease",
  });

  return (
    <div role="tablist" aria-label="Lab sections" style={{ display: "flex", alignItems: "flex-end", gap: 28, padding: "0 20px", overflowX: "auto" }}>
      {groups.map((g, gi) => (
        <div key={g.phase || `g${gi}`} style={{ display: "flex", flexDirection: "column", gap: 2, flexShrink: 0 }}>
          <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", color: C.text.faint, height: 12 }}>{g.phase}</span>
          <div style={{ display: "flex", gap: 20 }}>
            {g.items.map((t) => {
              const active = activeTab === t.id;
              return (
                <button key={t.id} role="tab" aria-selected={active} onClick={() => onSelect(t.id)} style={tabStyle(active)}
                  onMouseEnter={(e) => { if (!active) e.currentTarget.style.color = C.text.fog; }}
                  onMouseLeave={(e) => { if (!active) e.currentTarget.style.color = C.text.muted; }}>
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {canCondense && (
        <button type="button" onClick={() => onToggleMore(condensed)} title={moreTitle}
          style={{ ...tabStyle(false), flexShrink: 0, color: C.text.fog }}>
          {moreLabel} {condensed ? "+" : "−"}
        </button>
      )}
    </div>
  );
}
