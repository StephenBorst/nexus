/**
 * useLabAuth — the wallet's signature that opens its Lab record (see app/lib/labAuth.mjs).
 *
 * Saves, deletes, profile edits and the full (private) read all carry `labAuth` in the body. The
 * wallet signs once and the signature is reused for ~a day, per wallet, across every Lab view:
 *   • "cached"   — never prompts (the page-load read uses it: opening the Lab doesn't pop a wallet)
 *   • "auto"     — may prompt, unless the user already declined this session (background saves)
 *   • "explicit" — always prompts (a button the user just pressed)
 * One prompt at a time per wallet, however many views ask at once. Signs through the CONNECTED
 * wallet's own provider (Orderly's wallet connector), so WalletConnect, embedded and Solana
 * wallets work, not just an injected window.ethereum.
 */
import { useEffect, useState } from "react";
import { useWalletConnector } from "@orderly.network/hooks";
import { signLabAuth, LAB_AUTH_REUSE_MS } from "@/lib/labAuth.mjs";

export type LabAuth = { ts: number; sig: string; signer?: string };
export type LabWallet = { provider?: unknown; address?: string | null } | null;
export type LabAuthMode = "cached" | "auto" | "explicit";
export type LabAuthState = "ok" | "needed";

export const LAB_AUTH_EVENT = "nexus:lab-auth";
const cacheKey = (addr: string) => `nx_lab_auth:${addr.toLowerCase()}`;
const inflight = new Map<string, Promise<LabAuth | null>>();
const declined = new Set<string>();

function announce(addr: string, state: LabAuthState) {
  try { window.dispatchEvent(new CustomEvent(LAB_AUTH_EVENT, { detail: { addr: addr.toLowerCase(), state } })); } catch { /* non-browser */ }
}

/** A still-fresh signature for this wallet, or null. Never prompts. */
export function cachedLabAuth(addr?: string | null): LabAuth | null {
  if (!addr) return null;
  try {
    const a = JSON.parse(localStorage.getItem(cacheKey(addr)) || "null");
    return a && typeof a.sig === "string" && Number.isFinite(a.ts) && Date.now() - a.ts < LAB_AUTH_REUSE_MS ? a : null;
  } catch { return null; }
}

/** Forget a signature the server refused (expired early, clock drift) so the next save re-signs. */
export function clearLabAuth(addr?: string | null) {
  if (!addr) return;
  try { localStorage.removeItem(cacheKey(addr)); } catch { /* ignore */ }
  announce(addr, "needed");
}

/**
 * The signature for `addr`, signing if the mode allows. null when it can't be had (no wallet,
 * declined, "cached" with nothing cached). `onError` gets the wallet's reason for UI copy.
 */
export async function getLabAuth(
  addr: string | null | undefined,
  wallet: LabWallet,
  mode: LabAuthMode,
  opts: { fallbackSigner?: string | null; onError?: (msg: string) => void } = {},
): Promise<LabAuth | null> {
  if (!addr) return null;
  const key = addr.toLowerCase();
  const cached = cachedLabAuth(key);
  if (cached) return cached;
  if (mode === "cached" || (mode === "auto" && declined.has(key))) { announce(key, "needed"); return null; }
  const running = inflight.get(key);
  if (running) return running;
  const p = (signLabAuth(addr, wallet, { fallbackSigner: opts.fallbackSigner }) as Promise<LabAuth>)
    .then((auth) => {
      try { localStorage.setItem(cacheKey(key), JSON.stringify(auth)); } catch { /* private mode: works for this page only */ }
      declined.delete(key);
      announce(key, "ok");
      return auth;
    })
    .catch((e: unknown) => {
      declined.add(key); // don't re-prompt on every keystroke; the explicit button still can
      announce(key, "needed");
      opts.onError?.(e instanceof Error ? e.message : String(e));
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** The connected wallet, as the signer needs it. Must render inside OrderlyProvider. */
export function useLabWallet(): LabWallet {
  const wc = useWalletConnector() as unknown as { wallet?: { provider?: unknown; accounts?: { address?: string }[] } | null };
  return { provider: wc?.wallet?.provider, address: wc?.wallet?.accounts?.[0]?.address ?? null };
}

/** "ok" once this wallet holds a fresh signature, else "needed". Follows every view's signing. */
export function useLabAuthState(addr?: string | null): LabAuthState {
  const key = addr?.toLowerCase() || "";
  const [state, setState] = useState<LabAuthState>(() => (cachedLabAuth(key) ? "ok" : "needed"));
  useEffect(() => {
    setState(cachedLabAuth(key) ? "ok" : "needed");
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ addr: string; state: LabAuthState }>).detail;
      if (d && d.addr === key) setState(d.state);
    };
    window.addEventListener(LAB_AUTH_EVENT, on);
    return () => window.removeEventListener(LAB_AUTH_EVENT, on);
  }, [key]);
  return state;
}

/**
 * Add one call to a wallet's Lab from outside the Lab (the Feed / trader-page COPY modals).
 * Signs if needed (the user just pressed Save), reads the FULL record, appends, writes back.
 * If the read fails nothing is written: a record we couldn't read must not be replaced by one
 * holding only the new call.
 */
export async function appendToLab(
  addr: string,
  wallet: LabWallet,
  thesis: { id: string },
  extra: Record<string, unknown> = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  let why = "";
  // `addr` as the account reports it: a Solana key signs under its real (mixed-case) address.
  const auth = await getLabAuth(addr, wallet, "explicit", { fallbackSigner: addr, onError: (m) => { why = m; } });
  if (!auth) return { ok: false, error: why || "Sign the Nexus Lab message to save." };
  const base = "https://og.nexustradinglabs.com";
  const read = await fetch(`${base}/lab/${addr}/read`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ labAuth: auth }),
  }).catch(() => null);
  if (read?.status === 401) { clearLabAuth(addr); return { ok: false, error: "Signature expired. Try again." }; }
  if (!read?.ok) return { ok: false, error: "Couldn't load your Lab. Nothing was changed. Try again." };
  const existing = (await read.json().catch(() => null)) as { theses?: unknown[]; notes?: Record<string, string> } | null;
  if (!existing || !Array.isArray(existing.theses)) return { ok: false, error: "Couldn't load your Lab. Nothing was changed. Try again." };
  const res = await fetch(`${base}/lab/${addr}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ theses: [thesis, ...existing.theses], notes: existing.notes ?? {}, ...extra, labAuth: auth }),
  }).catch(() => null);
  if (res?.status === 401) { clearLabAuth(addr); return { ok: false, error: "Signature expired. Try again." }; }
  return res?.ok ? { ok: true } : { ok: false, error: "Save failed. Check your connection." };
}
