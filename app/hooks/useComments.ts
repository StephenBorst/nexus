import { sendSigned, type LabWallet } from "@/hooks/useLabAuth";

const API_BASE = "https://og.nexustradinglabs.com";

export interface Comment {
  id: string;
  wallet: string;
  text: string;
  createdAt: number;
}

export async function fetchComments(thesisId: string): Promise<Comment[]> {
  const r = await fetch(`${API_BASE}/comments/${thesisId}`);
  if (!r.ok) throw new Error(`fetchComments: ${r.status}`);
  return r.json() as Promise<Comment[]>;
}

export async function fetchReactions(thesisId: string): Promise<Record<string, string[]>> {
  const r = await fetch(`${API_BASE}/reactions/${thesisId}`);
  if (!r.ok) throw new Error(`fetchReactions: ${r.status}`);
  return r.json() as Promise<Record<string, string[]>>;
}

// Where the server looks up the author to notify: the call's author wallet, or the take's token.
// The server reads the author, market and side from that stored call or take, not from here.
export type AuthorRef = { authorWallet?: string; take?: { chain: string; ca: string } };

// Every write below is signed with the wallet's Lab signature (sendSigned); without it nothing is sent.
export async function addComment(
  thesisId: string,
  wallet: string,
  labWallet: LabWallet,
  text: string,
  ref?: AuthorRef,
): Promise<void> {
  const r = await sendSigned(`${API_BASE}/comments/${thesisId}`, "POST", wallet, labWallet, { wallet, text, ...(ref ?? {}) });
  if (!r?.ok) throw new Error(`addComment: ${r?.status ?? "not sent"}`);
}

export async function deleteComment(
  thesisId: string,
  commentId: string,
  wallet: string,
  labWallet: LabWallet,
): Promise<void> {
  const r = await sendSigned(`${API_BASE}/comments/${thesisId}/${commentId}`, "DELETE", wallet, labWallet, { wallet });
  if (!r?.ok) throw new Error(`deleteComment: ${r?.status ?? "not sent"}`);
}

export async function toggleReaction(
  thesisId: string,
  emoji: string,
  wallet: string,
  labWallet: LabWallet,
  ref?: AuthorRef,
): Promise<void> {
  const r = await sendSigned(`${API_BASE}/reactions/${thesisId}/${encodeURIComponent(emoji)}`, "PUT", wallet, labWallet, { wallet, ...(ref ?? {}) });
  if (!r?.ok) throw new Error(`toggleReaction: ${r?.status ?? "not sent"}`);
}
