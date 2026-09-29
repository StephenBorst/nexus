// SocialBar — the native, inline social layer for a call (thesis), used on the feed,
// trader profiles, and call permalinks so engagement looks/behaves identically. Real-
// feed behaviour (X / Instagram / Slack), no pop-ups:
//   • 🔥 Like is a ONE-TAP optimistic toggle. Extra reactions (💎 📉 ✅ ❌) live as
//     Slack-style inline chips + a 😀 add-picker — one tap each, no panel.
//   • Comments are INLINE — a "view N comments" expander + an "Add a comment…" line.
//     Your own comment appears INSTANTLY (optimistic) before the round-trip.
//   • A "· N new" nudge pulses on the Comment action when the count rises while you're
//     looking (live polling feeds it), so live actually feels live.
//   • Every action is LABELLED on every breakpoint — no hover-only meaning.
// Counts come from the feed's batched /comments/counts call (or a self-fetch when the
// host surface doesn't batch — `autoload`). Open threads poll for live updates.
import { useState, useEffect, useRef } from "react";
import { fetchComments, fetchReactions, addComment, deleteComment, toggleReaction, type Comment } from "@/hooks/useComments";

const LIKE = "🔥";
// Curated trading-flavoured palette for the 😀 add-picker (the 🔥 like has its own
// button). Any emoji that already has reactions still renders as a chip — including
// legacy ✅ ❌ — so nothing is lost when the palette changes.
const PALETTE = ["🚀", "📈", "📉", "💎", "🎯", "💀"];

function relTime(ts: number): string {
  const m = Math.floor((Date.now() - ts) / 60000);
  const h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d`;
  if (h > 0) return `${h}h`;
  if (m > 0) return `${m}m`;
  return "now";
}
const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`;

// Line icons for the action bar (same stroke as the top-nav envelope). The stored reaction
// behind Like is still 🔥; only the button's artwork is a line glyph.
const ICON_PATHS: Record<string, React.ReactNode> = {
  like: <path d="M12 21c-4 0-7-2.7-7-6.6 0-3.4 2.6-5.4 3.7-8.4.3 1.8 1.4 2.9 2.3 3.4C11.3 6.3 12.8 4 15 3c-.3 2.6.8 4.5 2 6 1.2 1.5 2 3 2 5.3C19 18.3 16 21 12 21z" />,
  comment: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.6A8 8 0 1 1 21 12z" />,
  share: <><path d="M7 17 17 7" /><path d="M8 7h9v9" /></>,
  copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
  message: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  react: <><circle cx="12" cy="12" r="9" /><path d="M8.5 14.5c.9 1.1 2.1 1.7 3.5 1.7s2.6-.6 3.5-1.7" /><path d="M9 9.5h.01M15 9.5h.01" /></>,
};

function Action({ icon, label, onClick, active, href }: {
  icon: keyof typeof ICON_PATHS; label: string; onClick?: () => void; active?: boolean; href?: string;
}) {
  const style: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none",
    color: active ? "#ededf0" : "#71717a", fontFamily: "var(--nx-font-ui)", fontSize: 13, fontWeight: 500,
    cursor: "pointer", padding: "6px 8px", borderRadius: 6, textTransform: "none", letterSpacing: 0,
    textDecoration: "none", whiteSpace: "nowrap",
  };
  const body = (
    <>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {ICON_PATHS[icon]}
      </svg>
      {label}
    </>
  );
  return href
    ? <a className="nx-btn" href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={style}>{body}</a>
    : <button className="nx-btn" onClick={(e) => { e.stopPropagation(); onClick?.(); }} style={style}>{body}</button>;
}

export function SocialBar({
  thesisId, walletAddress, authorWallet, symbol, direction,
  initialReactions, initialYouReacted, initialCommentCount = 0,
  shareHref, onCopy, canCopy, onMessage, canMessage, autoload = false, defaultOpen = false,
}: {
  thesisId: string;
  walletAddress: string | null;
  authorWallet?: string;
  symbol?: string;
  direction?: string;
  initialReactions?: Record<string, number>;
  initialYouReacted?: string[];
  initialCommentCount?: number;
  shareHref?: string;
  onCopy?: () => void;
  canCopy?: boolean;
  onMessage?: () => void;
  canMessage?: boolean;
  // Surfaces without a batched social fetch (trader profiles) set this so the bar fetches
  // its own reactions + comments on mount. The feed leaves it off and seeds from the
  // batched /comments/counts call instead (no per-card requests).
  autoload?: boolean;
  // Dedicated pages (a call's permalink) show the thread expanded from the start.
  defaultOpen?: boolean;
}) {
  const [reactions, setReactions] = useState<Record<string, number>>(initialReactions ?? {});
  const [youReacted, setYouReacted] = useState<string[]>(initialYouReacted ?? []);
  const [count, setCount] = useState(initialCommentCount);
  const [open, setOpen] = useState(defaultOpen);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [palette, setPalette] = useState(false);
  const [seen, setSeen] = useState(initialCommentCount);

  const walletLower = walletAddress?.toLowerCase() ?? "";

  // Once you tap a reaction, your local state is authoritative — a live poll landing
  // mid-flight must not stomp the optimistic toggle back. Comment count syncs live
  // regardless (it isn't affected by the reaction race).
  const interacted = useRef(false);
  useEffect(() => {
    if (!interacted.current) { setReactions(initialReactions ?? {}); setYouReacted(initialYouReacted ?? []); }
  }, [initialReactions, initialYouReacted]);
  useEffect(() => { setCount(initialCommentCount); }, [initialCommentCount]);

  // While the thread is open you've "seen" everything, so the nudge tracks the count;
  // once closed, new comments arriving (via polling) push count past `seen` → "· N new".
  useEffect(() => { if (open) setSeen(count); }, [open, count]);
  const newN = !open ? Math.max(0, count - seen) : 0;

  // Self-fetch reactions + comments when the host surface doesn't batch them.
  useEffect(() => {
    if (!autoload) return;
    let dead = false;
    Promise.all([fetchComments(thesisId), fetchReactions(thesisId)]).then(([c, r]) => {
      if (dead) return;
      setComments(c); setCount(c.length); setSeen(c.length); setLoaded(true);
      if (interacted.current) return;
      const counts: Record<string, number> = {}; const you: string[] = [];
      for (const [emoji, list] of Object.entries(r)) {
        const arr = Array.isArray(list) ? list : [];
        if (arr.length) counts[emoji] = arr.length;
        if (walletLower && arr.some((w) => String(w).toLowerCase() === walletLower)) you.push(emoji);
      }
      setReactions(counts); setYouReacted(you);
    }).catch(() => { /* ignore */ });
    return () => { dead = true; };
  }, [autoload, thesisId, walletLower]);

  // Live thread — while comments are open, poll for new ones so the discussion updates
  // in place with no manual refresh. Pauses while the tab is hidden.
  useEffect(() => {
    if (!open) return;
    const iv = setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      fetchComments(thesisId).then((c) => { setComments(c); setCount(c.length); }).catch(() => { /* ignore */ });
    }, 12000);
    return () => clearInterval(iv);
  }, [open, thesisId]);

  async function react(emoji: string) {
    if (!walletAddress) return;
    interacted.current = true;
    setPalette(false);
    const has = youReacted.includes(emoji);
    setYouReacted((y) => (has ? y.filter((e) => e !== emoji) : [...y, emoji]));       // optimistic
    setReactions((r) => ({ ...r, [emoji]: Math.max(0, (r[emoji] || 0) + (has ? -1 : 1)) }));
    try { await toggleReaction(thesisId, emoji, walletAddress, { authorWallet, symbol, direction }); }
    catch {
      setYouReacted((y) => (has ? [...y, emoji] : y.filter((e) => e !== emoji)));
      setReactions((r) => ({ ...r, [emoji]: Math.max(0, (r[emoji] || 0) + (has ? 1 : -1)) }));
    }
  }

  async function loadThread() {
    if (loaded) return;
    setLoading(true);
    try { const c = await fetchComments(thesisId); setComments(c); setCount(c.length); setLoaded(true); }
    catch { /* ignore */ } finally { setLoading(false); }
  }
  function toggleThread() { const next = !open; setOpen(next); if (next && !loaded) void loadThread(); }

  async function submit() {
    if (!walletAddress || !text.trim() || busy) return;
    const bodyText = text.trim();
    const temp: Comment = { id: `temp_${Date.now()}`, wallet: walletLower, text: bodyText, createdAt: Date.now() };
    setComments((cs) => [temp, ...cs]);   // optimistic — your comment appears instantly (newest-first)
    setCount((n) => n + 1);
    setText(""); setOpen(true); setLoaded(true); setBusy(true);
    try {
      await addComment(thesisId, walletAddress, bodyText, { authorWallet, symbol, direction });
      const c = await fetchComments(thesisId); setComments(c); setCount(c.length);   // reconcile
    } catch {
      setComments((cs) => cs.filter((x) => x.id !== temp.id)); setCount((n) => Math.max(0, n - 1)); setText(bodyText);
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    if (!walletAddress) return;
    try { await deleteComment(thesisId, id, walletAddress); const c = comments.filter((x) => x.id !== id); setComments(c); setCount(c.length); }
    catch { /* ignore */ }
  }

  const likeCount = reactions[LIKE] || 0;
  // Any reacted emoji except the primary 🔥 renders as a chip (legacy emojis included).
  const chips = Object.keys(reactions).filter((e) => e !== LIKE && (reactions[e] || 0) > 0);

  return (
    <div style={{ borderTop: "1px solid #232327", marginTop: 8 }}>
      {/* Action bar — labelled, native, always visible */}
      <div style={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", padding: "6px 2px" }}>
        <Action icon="like" label={`Like${likeCount ? ` ${likeCount}` : ""}`} onClick={() => react(LIKE)} active={youReacted.includes(LIKE)} />
        <Action icon="comment" label={`Comment${count ? ` ${count}` : ""}${newN ? ` · ${newN} new` : ""}`} onClick={toggleThread} active={open || newN > 0} />
        {shareHref && <Action icon="share" label="Share" href={shareHref} />}
        {canCopy && onCopy && <Action icon="copy" label="Copy" onClick={onCopy} />}
        {canMessage && onMessage && <Action icon="message" label="Message" onClick={onMessage} />}
        {walletAddress && <Action icon="react" label="React" onClick={() => setPalette((p) => !p)} active={palette} />}
      </div>

      {/* Reaction chips (Slack-style) + the add-a-reaction palette */}
      {(chips.length > 0 || palette) && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", padding: "0 4px 6px" }}>
          {chips.map((e) => {
            const mine = youReacted.includes(e);
            return (
              <button key={e} onClick={(ev) => { ev.stopPropagation(); react(e); }} title={mine ? "Remove reaction" : "React"}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, background: mine ? "#1a1a1e" : "#0a0a0b", border: `1px solid ${mine ? "#ededf0" : "#232327"}`, borderRadius: 20, color: mine ? "#ededf0" : "#a1a1aa", fontFamily: "var(--nx-font-mono)", fontSize: 12, padding: "3px 9px", cursor: "pointer" }}>
                {e}<span style={{ fontSize: 10 }}>{reactions[e]}</span>
              </button>
            );
          })}
          {palette && PALETTE.map((e) => (
            <button key={e} onClick={(ev) => { ev.stopPropagation(); react(e); }} title="React"
              style={{ background: "none", border: "1px dashed #33333a", borderRadius: 20, fontSize: 14, padding: "2px 8px", cursor: "pointer", opacity: youReacted.includes(e) ? 1 : 0.7 }}>
              {e}
            </button>
          ))}
        </div>
      )}

      {/* Inline thread — loads in place when expanded, no pop-up */}
      {open && (
        <div style={{ padding: "2px 2px 8px", display: "flex", flexDirection: "column", gap: 6 }}>
          {loading && <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#52525b" }}>loading…</div>}
          {!loading && comments.length === 0 && (
            <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 10, color: "#52525b" }}>No comments yet — start the discussion.</div>
          )}
          {comments.map((c) => {
            const pending = c.id.startsWith("temp_");
            return (
              <div key={c.id} style={{ background: "#0a0a0b", border: "1px solid #232327", borderRadius: 5, padding: "7px 10px", opacity: pending ? 0.6 : 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}>
                  <span style={{ fontFamily: "var(--nx-font-mono)", fontSize: 9, color: "#52525b" }}>
                    {short(c.wallet)}<span style={{ marginLeft: 8, color: "#33333a" }}>{pending ? "sending…" : relTime(c.createdAt)}</span>
                  </span>
                  {!pending && c.wallet === walletLower && (
                    <button onClick={() => remove(c.id)} title="Delete" style={{ background: "none", border: "none", color: "#52525b", cursor: "pointer", fontFamily: "var(--nx-font-mono)", fontSize: 10, padding: 0 }}>✕</button>
                  )}
                </div>
                <div style={{ fontFamily: "var(--nx-font-mono)", fontSize: 11, color: "#a1a1aa", lineHeight: 1.5, wordBreak: "break-word" }}>{c.text}</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Compose — inline when comments are open (keeps a dense feed clean), not a pop-up */}
      {walletAddress && open && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", padding: "0 2px 8px" }}>
          <input
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, 280))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(); } }}
            placeholder="Add a comment…"
            style={{ flex: 1, minWidth: 0, background: "#0a0a0b", border: "1px solid #232327", borderRadius: 20, color: "#ededf0", fontFamily: "var(--nx-font-mono)", fontSize: 11, padding: "7px 12px", outline: "none" }}
          />
          {text.trim() && (
            <button onClick={submit} disabled={busy} style={{ flexShrink: 0, background: "#1a1a1e", border: "1px solid #ededf0", color: "#ededf0", fontFamily: "var(--nx-font-mono)", fontSize: 10, padding: "6px 12px", borderRadius: 20, cursor: busy ? "wait" : "pointer", letterSpacing: "0.04em" }}>{busy ? "…" : "Post"}</button>
          )}
        </div>
      )}
    </div>
  );
}
