/**
 * useLabStorage
 *
 * Persists LAB data (theses + calendar notes) to Cloudflare KV via nexus-lab-api,
 * with localStorage as instant local cache.
 *
 * Only the wallet can write its record (or read the private part of it): every save carries the
 * wallet's Lab signature (useLabAuth — signed once, reused ~a day). Without one, the page shows the
 * PUBLIC view from the server plus this device's cache, and nothing is written back until the user
 * signs. Local data is never lost either way: localStorage is written first, the server second.
 *
 * Usage:
 *   const { theses, notes, saveTheses, saveNote, syncing, synced, authState, signToSync } = useLabStorage(walletAddress);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { ThesisTrade } from "@/pages/lab/types";
import { mergeOnOpen, foldInBeforeSave, removedIds } from "@/lib/labMerge.mjs";
import { cachedLabAuth, clearLabAuth, getLabAuth, useLabWallet, useLabAuthState, type LabAuth, type LabAuthMode } from "@/hooks/useLabAuth";

const API_BASE = "https://og.nexustradinglabs.com";
const LOCAL_THESIS_KEY = "lab_thesis_trades";
const LOCAL_NOTES_PREFIX = "lab_note_";
// Cross-instance sync (the return leg, Grok): the Lab mounts MULTIPLE useLabStorage instances
// — the orchestrator one feeds The Board's live-call ● dots; ThesisView has its own and is
// where a call is published. Plain per-instance useState meant a freshly published call never
// reached the orchestrator's list, so it never appeared as a ● on The Board (draft→publish→
// observe looked fake). On every theses save we broadcast this event; every instance re-reads
// the shared localStorage cache, so all views — Board included — agree immediately.
const THESES_EVENT = "nexus:lab-theses-updated";

type LabData = {
  theses: ThesisTrade[];
  notes: Record<string, string>;
};

// Wallets whose local state was merged with their FULL record this page-session. Until then the
// only server copy seen is the public view, and that must never be written back over the full
// record (it would drop private calls saved from another device) — see app/lib/labMerge.mjs.
const fullyMerged = new Set<string>();
// Calls deleted on this device since the last successful save, per wallet: never folded back in.
const tombstones = new Map<string, Set<string>>();
const tombsFor = (addr: string) => {
  let s = tombstones.get(addr);
  if (!s) { s = new Set(); tombstones.set(addr, s); }
  return s;
};

function readLocalTheses(): ThesisTrade[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_THESIS_KEY) || "[]");
    return raw.map((t: ThesisTrade) => ({
      ...t,
      status: (t.status ?? "ACTIVE") as ThesisTrade["status"],
      actualPnl: t.actualPnl ?? null,
    }));
  } catch {
    return [];
  }
}

function readLocalNotes(): Record<string, string> {
  const notes: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(LOCAL_NOTES_PREFIX)) {
      const dayKey = key.slice(LOCAL_NOTES_PREFIX.length);
      notes[dayKey] = localStorage.getItem(key) || "";
    }
  }
  return notes;
}

function writeLocalTheses(theses: ThesisTrade[]) {
  localStorage.setItem(LOCAL_THESIS_KEY, JSON.stringify(theses));
}

function writeLocalNote(dayKey: string, note: string) {
  localStorage.setItem(`${LOCAL_NOTES_PREFIX}${dayKey}`, note);
}

function broadcastTheses() {
  try { window.dispatchEvent(new Event(THESES_EVENT)); } catch { /* non-browser */ }
}

// The full record (private calls + notes), owner only. null on any failure — and a caller that
// gets null must NOT write: a record we couldn't read can't be safely replaced.
async function ownerRead(addr: string, auth: LabAuth): Promise<LabData | null> {
  try {
    const r = await fetch(`${API_BASE}/lab/${addr}/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ labAuth: auth }),
    });
    if (r.status === 401) { clearLabAuth(addr); return null; }
    if (!r.ok) return null;
    const d = await r.json();
    return d && Array.isArray(d.theses) ? { theses: d.theses, notes: d.notes && typeof d.notes === "object" ? d.notes : {} } : null;
  } catch {
    return null;
  }
}

export function useLabStorage(walletAddress?: string | null) {
  const [theses, setTheses] = useState<ThesisTrade[]>(readLocalTheses);
  const [notes, setNotes] = useState<Record<string, string>>(readLocalNotes);
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingModeRef = useRef<LabAuthMode>("cached");
  const hasFetchedRef = useRef(false);
  const wallet = useLabWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const addr = walletAddress?.toLowerCase().trim();
  const authState = useLabAuthState(addr);

  const applyLocal = useCallback((data: LabData) => {
    setTheses(data.theses);
    setNotes(data.notes);
    writeLocalTheses(data.theses);
    Object.entries(data.notes).forEach(([k, v]) => writeLocalNote(k, v));
  }, []);

  // ── Cross-instance re-sync: when ANY instance saves theses, every instance re-reads the
  // shared localStorage cache so the Board's live-call dots reflect a just-published call.
  useEffect(() => {
    // Notes too: a view that folded in the server's copy wrote both to the shared cache.
    const resync = () => { setTheses(readLocalTheses()); setNotes(readLocalNotes()); };
    window.addEventListener(THESES_EVENT, resync);
    return () => window.removeEventListener(THESES_EVENT, resync);
  }, []);

  // ── On wallet connect: fetch from KV and merge ──────────
  // With a cached signature: the full record. Without: the public view (opening the Lab never
  // pops the wallet); private calls from other devices load once the user signs.
  useEffect(() => {
    if (!addr || hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    setSyncing(true);
    (async () => {
      const cached = cachedLabAuth(addr);
      let remote = cached ? await ownerRead(addr, cached) : null;
      const full = !!remote;
      if (!remote) {
        const r = await fetch(`${API_BASE}/lab/${addr}`);
        remote = r.ok ? ((await r.json()) as LabData) : null;
      }
      if (!remote) return;
      // Merge: remote takes priority, but keep any local items not in remote
      applyLocal(mergeOnOpen({ theses: readLocalTheses(), notes: readLocalNotes() }, remote) as LabData);
      if (full) { fullyMerged.add(addr); setSynced(true); }
    })()
      .catch(() => { /* Network error — fall back to localStorage silently */ })
      .finally(() => setSyncing(false));
  }, [addr, applyLocal]);

  // ── Push this device's copy to KV (signed) ───────────────
  // Reads localStorage at push time, not this instance's state: every view writes the shared cache
  // first, so it holds the newest calls AND notes (a view's own copy of the notes can be stale).
  const pushNow = useCallback(async (mode: LabAuthMode): Promise<boolean> => {
    if (!addr) return false;
    const auth = await getLabAuth(addr, walletRef.current, mode, { fallbackSigner: walletAddress });
    if (!auth) return false;
    let data: LabData = { theses: readLocalTheses(), notes: readLocalNotes() };
    if (!fullyMerged.has(addr)) {
      const remote = await ownerRead(addr, auth);
      if (!remote) return false;
      data = foldInBeforeSave(data, remote, tombsFor(addr)) as LabData;
      applyLocal(data);
      broadcastTheses();
      fullyMerged.add(addr);
    }
    try {
      const res = await fetch(`${API_BASE}/lab/${addr}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theses: data.theses, notes: data.notes, labAuth: auth }),
      });
      if (res.status === 401) { clearLabAuth(addr); return false; }
      if (!res.ok) return false;
      tombsFor(addr).clear();
      setSynced(true);
      return true;
    } catch {
      return false; // localStorage already has the data
    }
  }, [addr, walletAddress, applyLocal]);

  // ── Debounced push to KV ─────────────────────────────────
  // A quiet save (background bookkeeping) never pops the wallet: it goes up only if a signature is
  // already cached, else it rides along with the next save the user makes.
  const schedulePush = useCallback((quiet: boolean) => {
    if (!addr) return;
    if (!quiet) pendingModeRef.current = "auto";
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      const mode = pendingModeRef.current;
      pendingModeRef.current = "cached";
      void pushNow(mode);
    }, 1000); // 1s debounce
  }, [addr, pushNow]);

  // ── Save theses ──────────────────────────────────────────
  const saveTheses = useCallback(
    (updated: ThesisTrade[], opts?: { quiet?: boolean }) => {
      if (addr) {
        const tombs = tombsFor(addr);
        for (const id of removedIds(readLocalTheses(), updated)) tombs.add(id);
        for (const t of updated) if (t?.id) tombs.delete(t.id);
      }
      setTheses(updated);
      writeLocalTheses(updated);
      // Tell every other useLabStorage instance (The Board's, above all) to re-read now.
      broadcastTheses();
      schedulePush(!!opts?.quiet);
    },
    [addr, schedulePush]
  );

  // ── Save a single calendar note ──────────────────────────
  const saveNote = useCallback(
    (dayKey: string, note: string) => {
      setNotes((prev) => ({ ...prev, [dayKey]: note }));
      writeLocalNote(dayKey, note);
      schedulePush(false);
    },
    [schedulePush]
  );

  // ── Sign now and sync (the header's "sign to sync") ──────
  const signToSync = useCallback(() => pushNow("explicit"), [pushNow]);

  return { theses, notes, saveTheses, saveNote, syncing, synced, authState, signToSync };
}
