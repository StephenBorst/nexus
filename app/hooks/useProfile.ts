/**
 * useProfile
 *
 * Fetches and saves wallet profile data { pfp, displayName } from
 * nexus-lab-api /profile/:address endpoint (backed by KV).
 *
 * Usage:
 *   const { pfp, displayName, saveProfile, loading } = useProfile(walletAddress);
 */

import { useState, useEffect, useCallback } from "react";
import { getLabAuth, clearLabAuth, useLabWallet } from "@/hooks/useLabAuth";

const API_BASE = "https://og.nexustradinglabs.com";

export type Profile = {
  pfp: string | null;
  displayName: string | null;
};

const profileCache: Record<string, Profile> = {};

export function useProfile(walletAddress?: string | null) {
  const addr = walletAddress?.toLowerCase().trim() || null;

  const [profile, setProfile] = useState<Profile>(() => {
    if (!addr) return { pfp: null, displayName: null };
    return profileCache[addr] ?? { pfp: null, displayName: null };
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const labWallet = useLabWallet();

  // ── Fetch profile on wallet connect ──────────────────────
  useEffect(() => {
    if (!addr) return;
    if (profileCache[addr]) {
      setProfile(profileCache[addr]);
      return;
    }

    setLoading(true);
    fetch(`${API_BASE}/profile/${addr}`)
      .then((r) => r.json())
      .then((data: Profile) => {
        profileCache[addr] = data;
        setProfile(data);
      })
      .catch(() => {
        // Network error — keep defaults
      })
      .finally(() => setLoading(false));
  }, [addr]);

  // ── Save profile ──────────────────────────────────────────
  // Only the wallet can change its name/pfp: the save carries its Lab signature (the same one that
  // saves Lab calls, ~a day). If it can't be had, the change is rolled back rather than shown as saved.
  const saveProfile = useCallback(
    async (updates: Partial<Profile>): Promise<boolean> => {
      if (!addr) return false;
      const prev = profile;
      const next: Profile = { ...profile, ...updates };
      // Optimistic update
      setProfile(next);
      profileCache[addr] = next;

      setSaving(true);
      setSaveError(null);
      const rollback = (msg: string) => { setProfile(prev); profileCache[addr] = prev; setSaveError(msg); };
      try {
        let why = "";
        const auth = await getLabAuth(addr, labWallet, "explicit", { fallbackSigner: walletAddress, onError: (m) => { why = m; } });
        if (!auth) { rollback(why || "Sign the Nexus Lab message to save your profile."); return false; }
        const res = await fetch(`${API_BASE}/profile/${addr}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...next, labAuth: auth }),
        });
        if (res.status === 401) { clearLabAuth(addr); rollback("Signature expired. Try again."); return false; }
        if (!res.ok) { rollback("Profile didn't save. Try again."); return false; }
        return true;
      } catch {
        rollback("Profile didn't save. Check your connection.");
        return false;
      } finally {
        setSaving(false);
      }
    },
    [addr, profile, labWallet, walletAddress]
  );

  return {
    pfp: profile.pfp,
    displayName: profile.displayName,
    saveProfile,
    loading,
    saving,
    saveError,
  };
}

// Utility: fetch a profile for any wallet (for feed display, no hook needed)
export async function fetchProfile(address: string): Promise<Profile> {
  const addr = address.toLowerCase().trim();
  if (profileCache[addr]) return profileCache[addr];
  try {
    const r = await fetch(`${API_BASE}/profile/${addr}`);
    const data: Profile = await r.json();
    profileCache[addr] = data;
    return data;
  } catch {
    return { pfp: null, displayName: null };
  }
}
