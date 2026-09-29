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
 * The device copy is PER WALLET (app/lib/labCache.mjs). It used to be one copy for the whole
 * browser, so a second wallet's first save pushed the first wallet's calls into its record (the
 * double-count). "" = no wallet connected (the guest copy).
 *
 * Usage:
 *   const { theses, notes, saveTheses, saveNote, syncing, synced, authState, signToSync } = useLabStorage(walletAddress);
 */

import { useState, useEffect, useRef, useCallback } from "react";
import type { ThesisTrade } from "@/pages/lab/types";
import { mergeOnOpen, foldInBeforeSave, removedIds, withServerPublished } from "@/lib/labMerge.mjs";
import { readTheses, writeTheses, readNotes, writeNote } from "@/lib/labCache.mjs";
import { cachedLabAuth, clearLabAuth, getLabAuth, useLabWallet, useLabAuthState, type LabAuth, type LabAuthMode } from "@/hooks/useLabAuth";

const API_BASE = "https://og.nexustradinglabs.com";
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

// This wallet's device copy ("" = the guest copy). Reads never throw; a bad copy reads as empty.
function readLocalTheses(addr: string): ThesisTrade[] {
  try {
    return (readTheses(localStorage, addr) as ThesisTrade[]).map((t) => ({
      ...t,
      status: (t.status ?? "ACTIVE") as ThesisTrade["status"],
      actualPnl: t.actualPnl ?? null,
    }));
  } catch {
    return [];
  }
}

function readLocalNotes(addr: string): Record<string, string> {
  try {
    return readNotes(localStorage, addr) as Record<string, string>;
  } catch {
    return {};
  }
}

function writeLocalTheses(addr: string, theses: ThesisTrade[]) {
  writeTheses(localStorage, addr, theses);
}

function writeLocalNote(addr: string, dayKey: string, note: string) {
  writeNote(localStorage, addr, dayKey, note);
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
  const addr = walletAddress?.toLowerCase().trim() || "";
  const [theses, setTheses] = useState<ThesisTrade[]>(() => readLocalTheses(addr));
  const [notes, setNotes] = useState<Record<string, string>>(() => readLocalNotes(addr));
  const [syncing, setSyncing] = useState(false);
  const [synced, setSynced] = useState(false);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingModeRef = useRef<LabAuthMode>("cached");
  const fetchedForRef = useRef<string | null>(null);
  const addrRef = useRef(addr);
  addrRef.current = addr;
  const wallet = useLabWallet();
  const walletRef = useRef(wallet);
  walletRef.current = wallet;

  const authState = useLabAuthState(addr || undefined);

  // Write a wallet's device copy, and show it only if that wallet is still the one connected: a
  // read or save can finish after the user switched wallets, and must never land in the new one.
  const applyLocal = useCallback((forAddr: string, data: LabData) => {
    writeLocalTheses(forAddr, data.theses);
    Object.entries(data.notes).forEach(([k, v]) => writeLocalNote(forAddr, k, v));
    if (addrRef.current === forAddr) {
      setTheses(data.theses);
      setNotes(data.notes);
    }
  }, []);

  // ── Another wallet (or none): show THAT wallet's own copy at once. A save still pending for the
  // previous wallet is dropped here; its edits are already in its own copy and go up with its next save.
  useEffect(() => {
    setTheses(readLocalTheses(addr));
    setNotes(readLocalNotes(addr));
    setSynced(false);
    if (syncTimeoutRef.current) { clearTimeout(syncTimeoutRef.current); syncTimeoutRef.current = null; }
    pendingModeRef.current = "cached";
  }, [addr]);

  // ── Cross-instance re-sync: when ANY instance saves theses, every instance re-reads the
  // connected wallet's copy so the Board's live-call dots reflect a just-published call.
  useEffect(() => {
    // Notes too: a view that folded in the server's copy wrote both to the device copy.
    const resync = () => { const a = addrRef.current; setTheses(readLocalTheses(a)); setNotes(readLocalNotes(a)); };
    window.addEventListener(THESES_EVENT, resync);
    return () => window.removeEventListener(THESES_EVENT, resync);
  }, []);

  // ── On wallet connect: fetch from KV and merge ──────────
  // With a cached signature: the full record. Without: the public view (opening the Lab never
  // pops the wallet); private calls from other devices load once the user signs.
  useEffect(() => {
    if (!addr || fetchedForRef.current === addr) return;
    fetchedForRef.current = addr;
    const forAddr = addr;

    setSyncing(true);
    (async () => {
      const cached = cachedLabAuth(forAddr);
      let remote = cached ? await ownerRead(forAddr, cached) : null;
      const full = !!remote;
      if (!remote) {
        const r = await fetch(`${API_BASE}/lab/${forAddr}`);
        remote = r.ok ? ((await r.json()) as LabData) : null;
      }
      if (!remote) return;
      // Merge: remote takes priority, but keep any local items not in remote
      applyLocal(forAddr, mergeOnOpen({ theses: readLocalTheses(forAddr), notes: readLocalNotes(forAddr) }, remote) as LabData);
      if (full) { fullyMerged.add(forAddr); if (addrRef.current === forAddr) setSynced(true); }
    })()
      .catch(() => { /* Network error — fall back to localStorage silently */ })
      .finally(() => setSyncing(false));
  }, [addr, applyLocal]);

  // ── Push this device's copy to KV (signed) ───────────────
  // Reads the wallet's device copy at push time, not this instance's state: every view writes the
  // copy first, so it holds the newest calls AND notes (a view's own copy of the notes can be stale).
  // Everything here is for the wallet the push started with (forAddr), even if the user switches.
  const pushNow = useCallback(async (mode: LabAuthMode): Promise<boolean> => {
    if (!addr) return false;
    const forAddr = addr;
    const auth = await getLabAuth(forAddr, walletRef.current, mode, { fallbackSigner: walletAddress });
    if (!auth) return false;
    let data: LabData = { theses: readLocalTheses(forAddr), notes: readLocalNotes(forAddr) };
    if (!fullyMerged.has(forAddr)) {
      const remote = await ownerRead(forAddr, auth);
      if (!remote) return false;
      data = foldInBeforeSave(data, remote, tombsFor(forAddr)) as LabData;
      applyLocal(forAddr, data);
      broadcastTheses();
      fullyMerged.add(forAddr);
    }
    try {
      const res = await fetch(`${API_BASE}/lab/${forAddr}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ theses: data.theses, notes: data.notes, labAuth: auth }),
      });
      if (res.status === 401) { clearLabAuth(forAddr); return false; }
      if (!res.ok) return false;
      tombsFor(forAddr).clear();
      // Published calls are permanent: take them exactly as the server stored them (its post time,
      // the frozen levels, the grade), and un-publish locally any it refused (labMerge.mjs).
      const out = await res.json().catch(() => null);
      const merged = withServerPublished(readLocalTheses(forAddr), out);
      if (merged.changed) {
        const list = merged.theses as ThesisTrade[];
        writeLocalTheses(forAddr, list);
        if (addrRef.current === forAddr) setTheses(list);
        broadcastTheses();
      }
      if (addrRef.current === forAddr) setSynced(true);
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
        for (const id of removedIds(readLocalTheses(addr), updated)) tombs.add(id);
        for (const t of updated) if (t?.id) tombs.delete(t.id);
      }
      setTheses(updated);
      writeLocalTheses(addr, updated);
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
      writeLocalNote(addr, dayKey, note);
      schedulePush(false);
    },
    [addr, schedulePush]
  );

  // ── Sign now and sync (the header's "sign to sync") ──────
  const signToSync = useCallback(() => pushNow("explicit"), [pushNow]);

  return { theses, notes, saveTheses, saveNote, syncing, synced, authState, signToSync };
}
