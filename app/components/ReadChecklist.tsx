// What a read still needs, in numbers (rules app/lib/readChecklist.mjs). On each read's Shelf card (compact: the head, the
// next open rows, the rest on a tap) and on its /proof/paper page (full). Ink only: marks are shapes (✓ ○ … ?), never a
// colour or a filling bar; CLEARED is the only passed state.
import { useState } from "react";
import { C } from "@/config/theme";
import { ROW_MARK } from "@/lib/readChecklist.mjs";

type Row = { key: string; title: string; state: "met" | "open" | "later" | "unread"; line: string; group: string };
export type Checklist = { cleared: boolean; unread?: boolean; head?: string; rows: Row[] };

const UI = "var(--nx-font-ui)";
const MONO = "var(--nx-font-mono)";
const ink = (s: Row["state"]) => (s === "open" ? C.text.bright : s === "met" ? C.text.muted : C.text.fog);

function RowLine({ r }: { r: Row }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "16px 1fr", gap: 6, padding: "4px 0", alignItems: "baseline" }}>
      <span aria-label={r.state} style={{ fontFamily: MONO, fontSize: 11, color: ink(r.state), textAlign: "center" }}>{ROW_MARK[r.state]}</span>
      <span style={{ minWidth: 0 }}>
        <span style={{ fontFamily: UI, fontSize: 12, color: ink(r.state) }}>{r.title}</span>
        <span style={{ display: "block", fontFamily: MONO, fontSize: 10.5, lineHeight: 1.5, color: C.text.fog, overflowWrap: "anywhere" }}>{r.line}</span>
      </span>
    </div>
  );
}

export function ReadChecklist({ list, compact = false }: { list: Checklist | null; compact?: boolean }) {
  const [open, setOpen] = useState(!compact);
  if (!list || list.unread) return null;
  const groups: [string, Row[]][] = [];
  for (const r of list.rows) {
    const g = groups.find(([name]) => name === r.group);
    if (g) g[1].push(r); else groups.push([r.group, [r]]);
  }
  const nextOpen = list.rows.filter((r) => r.state === "open" || r.state === "unread").slice(0, 2);

  return (
    <div aria-label="What it still needs" style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontFamily: MONO, fontSize: 9.5, letterSpacing: "0.14em", color: list.cleared ? C.text.bright : C.text.muted }}>
          {list.cleared ? "CLEARED" : "WHAT IT STILL NEEDS"}
        </span>
        {!list.cleared && list.head && <span style={{ fontFamily: MONO, fontSize: 10.5, color: C.text.fog }}>{list.head}</span>}
      </div>
      {!open && nextOpen.map((r) => <RowLine key={r.key} r={r} />)}
      {open && groups.map(([name, rows]) => (
        <div key={name} style={{ marginTop: 4 }}>
          <div style={{ fontFamily: UI, fontSize: 11, fontWeight: 600, color: C.text.fog }}>{name}</div>
          {rows.map((r) => <RowLine key={r.key} r={r} />)}
        </div>
      ))}
      {compact && list.rows.length > nextOpen.length && (
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          style={{ justifySelf: "start", background: "none", border: "none", padding: "2px 0", cursor: "pointer", fontFamily: UI, fontSize: 11.5, color: C.text.fog }}>
          {open ? "Show less" : `Show all ${list.rows.length}`}
        </button>
      )}
    </div>
  );
}
